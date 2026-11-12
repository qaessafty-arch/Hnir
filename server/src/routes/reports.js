'use strict';
const express = require('express');
const db = require('../lib/db');
const { z, parse, id, page } = require('../lib/validate');
const { ah, notFound, badRequest, forbidden } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm, has } = require('../middleware/auth');
const { assertCanViewStudent } = require('../lib/access');
const { studentReport } = require('../lib/reports');
const { buildReport } = require('../lib/grading');
const { getSettings } = require('../lib/settings');
const { sendCsv } = require('../lib/csv');

const router = express.Router();

async function teacherSubjectIds(userId, sectionId) {
  const r = await db.query(
    `SELECT DISTINCT ta.subject_id FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id
      WHERE t.user_id = $1 AND ($2::int IS NULL OR ta.section_id = $2)`, [userId, sectionId ?? null]);
  return r.rows.map((x) => x.subject_id);
}

async function studentHeader(studentId, yearId) {
  const r = await db.query(
    `SELECT s.id, s.student_no, s.full_name_ckb, s.full_name_en, s.photo_path IS NOT NULL AS has_photo,
            y.id AS year_id, y.name AS year_name, sec.id AS section_id, sec.name AS section_name, c.grade_level
       FROM students s
       LEFT JOIN academic_years y ON y.id = coalesce($2, (SELECT id FROM academic_years WHERE is_current))
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.academic_year_id = y.id
       LEFT JOIN sections sec ON sec.id = e.section_id LEFT JOIN classes c ON c.id = sec.class_id
      WHERE s.id = $1`, [studentId, yearId ?? null]);
  return r.rows[0];
}

// Student report card (also used by the student and parent portals)
router.get('/student/:id', ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const q = parse(z.object({ termId: id.optional(), yearId: id.optional(), format: z.enum(['json', 'csv']).default('json') }), req.query);
  const access = await assertCanViewStudent(req, sid);
  let yearId = q.yearId;
  if (q.termId && !yearId) yearId = (await db.query('SELECT academic_year_id FROM terms WHERE id = $1', [q.termId])).rows[0]?.academic_year_id;
  const header = await studentHeader(sid, yearId);
  const subjectIds = access.teacherScoped ? await teacherSubjectIds(req.user.id, header.section_id) : null;
  const report = await studentReport(sid, { termId: q.termId, yearId: q.termId ? null : yearId ?? header.year_id, publishedOnly: access.publishedOnly, subjectIds });
  const term = q.termId ? (await db.query('SELECT id, name_en, name_ckb FROM terms WHERE id = $1', [q.termId])).rows[0] : null;
  const school = (await getSettings()).school;
  await audit(req, q.format === 'csv' ? 'export.student_report_csv' : 'report.student_view', { entityType: 'student', entityId: sid, details: { termId: q.termId ?? null } });
  if (q.format === 'csv') {
    return sendCsv(res, `report-${header.student_no}.csv`,
      ['student_no', 'student', 'subject_en', 'subject_ckb', 'total_score', 'total_max', 'percent', 'passed', 'band'],
      report.subjects.map((s) => [header.student_no, header.full_name_ckb, s.name_en, s.name_ckb, s.total_score, s.total_max, s.percent, s.passed, s.band]));
  }
  res.json({ school, student: header, term, scope: { publishedOnly: access.publishedOnly, teacherScoped: !!access.teacherScoped }, generated_at: new Date().toISOString(), ...report });
}));

// Section (class) summary: one row per student with per-subject percentages
router.get('/section/:id', requirePerm('reports.school', 'reports.class'), ah(async (req, res) => {
  const secId = parse(id, req.params.id);
  const q = parse(z.object({ termId: id.optional(), format: z.enum(['json', 'csv']).default('json') }), req.query);
  const sec = (await db.query(
    `SELECT s.id, s.name, s.academic_year_id, c.grade_level, y.name AS year_name FROM sections s
       JOIN classes c ON c.id = s.class_id JOIN academic_years y ON y.id = s.academic_year_id WHERE s.id = $1`, [secId])).rows[0];
  if (!sec) throw notFound();
  let subjectFilter = null;
  if (!has(req, 'reports.school')) {
    subjectFilter = await teacherSubjectIds(req.user.id, secId);
    if (!subjectFilter.length) throw notFound();
  }
  if (q.format === 'csv' && !has(req, 'exports.csv') && !has(req, 'reports.class')) throw forbidden();
  const policy = (await getSettings()).grading;
  const subjects = (await db.query(
    `SELECT id, name_en, name_ckb, pass_mark_percent FROM subjects WHERE ($1::int[] IS NULL OR id = ANY($1)) ORDER BY sort_order, id`,
    [subjectFilter])).rows;
  const students = (await db.query(
    `SELECT s.id, s.student_no, s.full_name_ckb, s.full_name_en FROM enrollments e JOIN students s ON s.id = e.student_id
      WHERE e.section_id = $1 AND e.status = 'active' ORDER BY lower(s.full_name_ckb)`, [secId])).rows;
  const rows = (await db.query(
    `SELECT g.student_id, g.score, g.status, a.max_score, a.subject_id, a.category_id, cat.weight AS category_weight
       FROM grade_records g JOIN assessments a ON a.id = g.assessment_id JOIN assessment_categories cat ON cat.id = a.category_id
       JOIN terms t ON t.id = a.term_id
      WHERE a.section_id = $1 AND ($2::int IS NULL OR a.term_id = $2) AND t.academic_year_id = $3
        AND ($4::int[] IS NULL OR a.subject_id = ANY($4))`, [secId, q.termId ?? null, sec.academic_year_id, subjectFilter])).rows;
  const byStudent = new Map();
  rows.forEach((r) => { if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []); byStudent.get(r.student_id).push(r); });
  const items = students.map((s) => {
    const rep = buildReport(subjects, byStudent.get(s.id) || [], policy);
    return { ...s, overall_percent: rep.overall_percent, overall_band: rep.overall_band, subjects_failed: rep.subjects_failed,
      by_subject: Object.fromEntries(rep.subjects.map((x) => [x.subject_id, x.percent])) };
  });
  const usedSubjects = subjects.filter((sj) => items.some((i) => i.by_subject[sj.id] !== undefined));
  await audit(req, q.format === 'csv' ? 'export.section_report_csv' : 'report.section_view', { entityType: 'section', entityId: secId, details: { termId: q.termId ?? null } });
  if (q.format === 'csv') {
    return sendCsv(res, `section-${sec.grade_level}-${sec.name}.csv`,
      ['student_no', 'name_ckb', 'name_en', ...usedSubjects.map((s) => s.name_en), 'overall_percent', 'subjects_failed'],
      items.map((i) => [i.student_no, i.full_name_ckb, i.full_name_en, ...usedSubjects.map((s) => i.by_subject[s.id] ?? ''), i.overall_percent, i.subjects_failed]));
  }
  res.json({ section: sec, subjects: usedSubjects, items });
}));

// School-wide grade overview (server-side pagination / filtering / sorting)
const SORTS = { student: 'lower(s.full_name_ckb)', subject: 'sj.sort_order', score: 'g.score', percent: '(g.score / a.max_score)',
  updated: 'g.updated_at', status: 'a.status', grade: 'c.grade_level' };
router.get('/grades', requirePerm('grades.read_all', 'grades.enter'), ah(async (req, res) => {
  const q = parse(page.extend({
    yearId: id.optional(), termId: id.optional(), sectionId: id.optional(), subjectId: id.optional(), classId: id.optional(),
    status: z.enum(['draft', 'submitted', 'approved', 'published', 'returned']).optional(), q: z.string().trim().max(100).optional(),
    sort: z.enum(Object.keys(SORTS)).default('updated'), dir: z.enum(['asc', 'desc']).default('desc'),
    format: z.enum(['json', 'csv']).default('json'), failingOnly: z.enum(['0', '1']).default('0'),
  }), req.query);
  const all = has(req, 'grades.read_all');
  if (q.format === 'csv' && !(has(req, 'exports.csv') || has(req, 'reports.class'))) throw forbidden();
  const params = [q.yearId ?? null, q.termId ?? null, q.sectionId ?? null, q.subjectId ?? null, q.status ?? null,
    q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m)}%` : null, !all, req.user.id, q.classId ?? null, q.failingOnly === '1'];
  const from = `FROM grade_records g JOIN assessments a ON a.id = g.assessment_id JOIN students s ON s.id = g.student_id
      JOIN terms t ON t.id = a.term_id JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
      JOIN subjects sj ON sj.id = a.subject_id LEFT JOIN users eu ON eu.id = g.entered_by`;
  const where = `WHERE ($1::int IS NULL OR t.academic_year_id = $1) AND ($2::int IS NULL OR a.term_id = $2)
      AND ($3::int IS NULL OR a.section_id = $3) AND ($4::int IS NULL OR a.subject_id = $4) AND ($5::text IS NULL OR a.status = $5)
      AND ($6::text IS NULL OR lower(s.full_name_ckb) LIKE $6 OR lower(coalesce(s.full_name_en,'')) LIKE $6 OR lower(s.student_no) LIKE $6)
      AND (NOT $7 OR EXISTS (SELECT 1 FROM teacher_assignments ta JOIN teachers tt ON tt.id = ta.teacher_id
             WHERE ta.section_id = a.section_id AND ta.subject_id = a.subject_id AND tt.user_id = $8))
      AND ($9::int IS NULL OR c.id = $9)
      AND (NOT $10 OR (g.status = 'graded' AND g.score * 100 / a.max_score < sj.pass_mark_percent) OR g.status = 'missing')`;
  const select = `SELECT g.id, s.id AS student_id, s.student_no, s.full_name_ckb, s.full_name_en, c.grade_level, sec.name AS section_name,
            sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb, sj.pass_mark_percent, a.id AS assessment_id, a.title, a.week_no,
            t.name_en AS term_name_en, t.name_ckb AS term_name_ckb, g.score, a.max_score, g.status AS record_status,
            CASE WHEN g.status = 'graded' THEN round(g.score * 100 / a.max_score, 1) END AS percent,
            a.status, eu.full_name AS entered_by_name, g.updated_at`;
  const order = `ORDER BY ${SORTS[q.sort]} ${q.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, g.id`;
  if (q.format === 'csv') {
    const { rows } = await db.query(`${select} ${from} ${where} ${order} LIMIT 50000`, params);
    await audit(req, 'export.grades_csv', { entityType: 'grades', details: { filters: { ...q, format: undefined }, rows: rows.length } });
    return sendCsv(res, 'grades.csv',
      ['student_no', 'student_ckb', 'student_en', 'grade', 'section', 'subject', 'term', 'assessment', 'week', 'score', 'max', 'percent', 'record_status', 'workflow_status', 'entered_by', 'updated_at'],
      rows.map((r) => [r.student_no, r.full_name_ckb, r.full_name_en, r.grade_level, r.section_name, r.subject_name_en, r.term_name_en, r.title, r.week_no,
        r.score, r.max_score, r.percent, r.record_status, r.status, r.entered_by_name, r.updated_at.toISOString()]));
  }
  const total = (await db.query(`SELECT count(*)::int n ${from} ${where}`, params)).rows[0].n;
  const { rows } = await db.query(`${select} ${from} ${where} ${order} LIMIT $11 OFFSET $12`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows, total, page: q.page, pageSize: q.pageSize });
}));

// Missing-grade tracker: active students with no record on non-published assessments
router.get('/missing', requirePerm('grades.read_all', 'grades.enter'), ah(async (req, res) => {
  const q = parse(z.object({ termId: id.optional() }), req.query);
  const all = has(req, 'grades.read_all');
  const { rows } = await db.query(
    `SELECT a.id AS assessment_id, a.title, a.status, c.grade_level, sec.name AS section_name, sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb,
            count(e.student_id)::int AS missing
       FROM assessments a JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id JOIN subjects sj ON sj.id = a.subject_id
       JOIN enrollments e ON e.section_id = a.section_id AND e.status = 'active'
      WHERE NOT EXISTS (SELECT 1 FROM grade_records g WHERE g.assessment_id = a.id AND g.student_id = e.student_id)
        AND ($1::int IS NULL OR a.term_id = $1)
        AND ($2 OR EXISTS (SELECT 1 FROM teacher_assignments ta JOIN teachers tt ON tt.id = ta.teacher_id
               WHERE ta.section_id = a.section_id AND ta.subject_id = a.subject_id AND tt.user_id = $3))
      GROUP BY a.id, c.grade_level, sec.name, sj.name_en, sj.name_ckb ORDER BY missing DESC LIMIT 200`, [q.termId ?? null, all, req.user.id]);
  res.json({ items: rows });
}));

module.exports = router;
