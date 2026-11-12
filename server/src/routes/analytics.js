'use strict';
/**
 * Analysis for administrators and teachers: "how is the school / my class doing, and who needs help?"
 * All percentages use the documented grading engine (lib/grading.js), so numbers match report cards.
 */
const express = require('express');
const db = require('../lib/db');
const { z, parse, id } = require('../lib/validate');
const { ah } = require('../lib/errors');
const { requirePerm, has } = require('../middleware/auth');
const { buildReport, round, bandFor } = require('../lib/grading');
const { getSettings } = require('../lib/settings');

const router = express.Router();

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

router.get('/', requirePerm('reports.school', 'reports.class'), ah(async (req, res) => {
  const q = parse(z.object({
    yearId: id.optional(), termId: id.optional(), sectionId: id.optional(), classId: id.optional(),
    publishedOnly: z.enum(['0', '1']).default('0'),
  }), req.query);
  const policy = (await getSettings()).grading;
  const year = q.yearId
    ? (await db.query('SELECT id, name FROM academic_years WHERE id = $1', [q.yearId])).rows[0]
    : (await db.query('SELECT id, name FROM academic_years WHERE is_current')).rows[0];
  if (!year) return res.json({ year: null, empty: true });

  // Teachers (no school-wide reports) only see the sections + subjects they teach.
  const teacherScope = !has(req, 'reports.school');
  const scopeParams = [req.user.id];
  const pairs = teacherScope ? (await db.query(
    `SELECT ta.section_id, ta.subject_id FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id
      WHERE t.user_id = $1`, scopeParams)).rows : null;
  const scopeSections = pairs ? [...new Set(pairs.map((p) => p.section_id))] : null;

  const students = (await db.query(
    `SELECT s.id, s.student_no, s.full_name_ckb, s.full_name_en, s.photo_path IS NOT NULL AS has_photo,
            sec.id AS section_id, sec.name AS section_name, c.grade_level
       FROM enrollments e JOIN students s ON s.id = e.student_id
       JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
      WHERE e.academic_year_id = $1 AND e.status = 'active' AND s.status = 'active'
        AND ($2::int IS NULL OR sec.id = $2) AND ($3::int IS NULL OR c.id = $3)
        AND ($4::int[] IS NULL OR sec.id = ANY($4))`,
    [year.id, q.sectionId ?? null, q.classId ?? null, scopeSections])).rows;

  const rows = (await db.query(
    `SELECT g.student_id, a.subject_id, a.section_id, g.score, g.status, a.max_score, a.category_id, cat.weight AS category_weight
       FROM grade_records g JOIN assessments a ON a.id = g.assessment_id JOIN terms t ON t.id = a.term_id
       JOIN assessment_categories cat ON cat.id = a.category_id
      WHERE t.academic_year_id = $1 AND ($2::int IS NULL OR a.term_id = $2)
        AND (NOT $3 OR a.status = 'published')
        AND ($4::int[] IS NULL OR a.section_id = ANY($4))`,
    [year.id, q.termId ?? null, q.publishedOnly === '1', scopeSections])).rows
    .filter((r) => !pairs || pairs.some((p) => p.section_id === r.section_id && p.subject_id === r.subject_id));

  const subjects = (await db.query('SELECT id, name_en, name_ckb, pass_mark_percent FROM subjects ORDER BY sort_order, id')).rows;
  const byStudent = new Map();
  for (const r of rows) { if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []); byStudent.get(r.student_id).push(r); }

  const places = policy.display_decimals ?? 1;
  const reports = students.map((s) => ({ s, rep: buildReport(subjects, byStudent.get(s.id) || [], policy) }));
  const graded = reports.filter((x) => x.rep.overall_percent !== null);

  // Subject view: average and pass rate across students who have grades in that subject.
  const subjectStats = subjects.map((sj) => {
    const vals = graded.map((x) => x.rep.subjects.find((r) => r.subject_id === sj.id)).filter((r) => r && r.percent !== null);
    if (!vals.length) return null;
    return {
      id: sj.id, name_en: sj.name_en, name_ckb: sj.name_ckb, pass_mark_percent: Number(sj.pass_mark_percent), students: vals.length,
      average: round(mean(vals.map((v) => v.percent)), places), pass_rate: round((vals.filter((v) => v.passed).length / vals.length) * 100, 0),
      failing: vals.filter((v) => !v.passed).length,
    };
  }).filter(Boolean);

  // Class (section) view.
  const sectionMap = new Map();
  for (const x of reports) {
    const k = x.s.section_id;
    if (!sectionMap.has(k)) sectionMap.set(k, { id: k, grade_level: x.s.grade_level, name: x.s.section_name, students: 0, items: [] });
    const e = sectionMap.get(k); e.students++;
    if (x.rep.overall_percent !== null) e.items.push(x.rep);
  }
  const sectionStats = [...sectionMap.values()].map((e) => ({
    id: e.id, grade_level: e.grade_level, name: e.name, students: e.students, graded: e.items.length,
    average: round(mean(e.items.map((r) => r.overall_percent)), places),
    pass_rate: e.items.length ? round((e.items.filter((r) => r.subjects_failed === 0).length / e.items.length) * 100, 0) : null,
    at_risk: e.items.filter((r) => r.subjects_failed > 0).length,
  })).sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name));

  // Performance bands (how many students in each level).
  const bandKeys = [...policy.bands].sort((a, b) => b.min - a.min).map((b) => b.key);
  const bands = bandKeys.map((key) => ({ key, min: policy.bands.find((b) => b.key === key).min, count: graded.filter((x) => x.rep.overall_band === key).length }));

  const person = (x) => ({
    id: x.s.id, student_no: x.s.student_no, full_name_ckb: x.s.full_name_ckb, full_name_en: x.s.full_name_en, has_photo: x.s.has_photo,
    grade_level: x.s.grade_level, section_name: x.s.section_name, overall_percent: x.rep.overall_percent, overall_band: x.rep.overall_band,
    subjects_failed: x.rep.subjects_failed,
    failed_subjects: x.rep.subjects.filter((r) => r.passed === false).map((r) => ({ id: r.subject_id, name_en: r.name_en, name_ckb: r.name_ckb, percent: r.percent })),
  });
  const atRisk = graded.filter((x) => x.rep.subjects_failed > 0)
    .sort((a, b) => b.rep.subjects_failed - a.rep.subjects_failed || a.rep.overall_percent - b.rep.overall_percent).map(person);
  const top = [...graded].sort((a, b) => b.rep.overall_percent - a.rep.overall_percent).slice(0, 10).map(person);

  const avg = mean(graded.map((x) => x.rep.overall_percent));
  res.json({
    year, scope: { teacher: teacherScope, publishedOnly: q.publishedOnly === '1' },
    kpis: {
      students: students.length, graded: graded.length, average: round(avg, places), average_band: bandFor(avg, policy.bands),
      pass_rate: graded.length ? round((graded.filter((x) => x.rep.subjects_failed === 0).length / graded.length) * 100, 0) : null,
      at_risk: atRisk.length,
    },
    subjects: subjectStats, sections: sectionStats, bands, at_risk: atRisk.slice(0, 200), at_risk_total: atRisk.length, top,
  });
}));

// "Needs your attention" — concrete, actionable items for the dashboard.
router.get('/attention', requirePerm('dashboard.school', 'grades.enter'), ah(async (req, res) => {
  const school = has(req, 'dashboard.school');
  const yearRow = (await db.query('SELECT id FROM academic_years WHERE is_current')).rows[0];
  const yid = yearRow?.id ?? null;
  const mine = `EXISTS (SELECT 1 FROM teacher_assignments ta JOIN teachers tt ON tt.id = ta.teacher_id
                 WHERE ta.section_id = a.section_id AND ta.subject_id = a.subject_id AND tt.user_id = $2)`;
  const scope = school ? '($2::bigint IS NOT NULL)' : mine; // $2 must always be referenced
  const one = async (sql) => (await db.query(sql, [yid, req.user.id])).rows[0].n;
  const items = {
    awaiting_approval: has(req, 'grades.approve') ? await one(
      `SELECT count(*)::int n FROM assessments a JOIN terms t ON t.id = a.term_id WHERE a.status = 'submitted' AND t.academic_year_id = $1 AND ($2::bigint IS NOT NULL)`) : 0,
    approved_not_published: has(req, 'grades.publish') ? await one(
      `SELECT count(*)::int n FROM assessments a JOIN terms t ON t.id = a.term_id WHERE a.status = 'approved' AND t.academic_year_id = $1 AND ($2::bigint IS NOT NULL)`) : 0,
    returned: await one(
      `SELECT count(*)::int n FROM assessments a JOIN terms t ON t.id = a.term_id WHERE a.status = 'returned' AND t.academic_year_id = $1 AND ${scope}`),
    sheets_missing_grades: await one(
      `SELECT count(DISTINCT a.id)::int n FROM assessments a JOIN terms t ON t.id = a.term_id
         JOIN enrollments e ON e.section_id = a.section_id AND e.status = 'active'
        WHERE t.academic_year_id = $1 AND a.status IN ('draft','returned') AND ${scope}
          AND NOT EXISTS (SELECT 1 FROM grade_records g WHERE g.assessment_id = a.id AND g.student_id = e.student_id)`),
    students_without_class: school ? await one(
      `SELECT count(*)::int n FROM students s WHERE s.status = 'active' AND ($2::bigint IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.academic_year_id = $1)`) : 0,
    teachers_without_classes: school ? await one(
      `SELECT count(*)::int n FROM teachers t WHERE t.status = 'active' AND ($2::bigint IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.academic_year_id = $1)`) : 0,
  };
  res.json({ has_current_year: !!yid, items });
}));

module.exports = router;
