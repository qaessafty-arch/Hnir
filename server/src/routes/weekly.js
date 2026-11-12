'use strict';
/**
 * Weekly Student Grade Card — everything the student report screen needs for one academic week,
 * computed from the database (never sample values).
 *
 *   GET /api/weekly/students/:id?yearId=&termId=&week=
 *
 * Students see only their own PUBLISHED records (object-level check in assertCanViewStudent).
 * Teachers see only the subjects they teach. Weeks are never mixed: the table and the weekly
 * statistics use exactly the assessments whose week_no equals the selected week.
 */
const express = require('express');
const db = require('../lib/db');
const { z, parse, id } = require('../lib/validate');
const { ah } = require('../lib/errors');
const { assertCanViewStudent } = require('../lib/access');
const { buildReport, round, bandFor } = require('../lib/grading');
const { getSettings } = require('../lib/settings');
const { has } = require('../middleware/auth');

const router = express.Router();
const pct = (s, m) => (m > 0 ? (s / m) * 100 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

router.get('/students/:id', ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const q = parse(z.object({ yearId: id.optional(), termId: id.optional(), week: z.coerce.number().int().min(1).max(60).optional() }), req.query);
  const access = await assertCanViewStudent(req, sid);
  const policy = (await getSettings()).grading;
  const places = policy.display_decimals ?? 1;

  // Years the student was enrolled in (newest first) and the chosen one.
  const years = (await db.query(
    `SELECT y.id, y.name, y.is_current, sec.name AS section_name, c.grade_level
       FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
       JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
      WHERE e.student_id = $1 ORDER BY y.starts_on DESC`, [sid])).rows;
  const year = years.find((y) => y.id === q.yearId) || years.find((y) => y.is_current) || years[0] || null;

  const student = (await db.query(
    `SELECT s.id, s.student_no, s.full_name_ckb, s.full_name_en, s.gender, s.date_of_birth, s.photo_path IS NOT NULL AS has_photo
       FROM students s WHERE s.id = $1`, [sid])).rows[0];
  const school = (await getSettings()).school;
  if (!year) return res.json({ school, student, years: [], terms: [], weeks: [], rows: [], empty: true });

  const terms = (await db.query('SELECT id, name_en, name_ckb, ordinal FROM terms WHERE academic_year_id = $1 ORDER BY ordinal', [year.id])).rows;

  // Teachers only see their own subjects for this student's section.
  let subjectIds = null;
  if (access.teacherScoped) {
    subjectIds = (await db.query(
      `SELECT DISTINCT ta.subject_id FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id
         JOIN enrollments e ON e.section_id = ta.section_id AND e.student_id = $2 AND e.academic_year_id = $3
        WHERE t.user_id = $1`, [req.user.id, sid, year.id])).rows.map((r) => r.subject_id);
  }

  // All visible records for the year (published only for students).
  const all = (await db.query(
    `SELECT a.id AS assessment_id, a.title, a.week_no, a.term_id, a.max_score, a.status AS sheet_status,
            a.subject_id, a.category_id, cat.weight AS category_weight,
            sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb, sj.sort_order, sj.pass_mark_percent,
            g.score, g.status, g.comment, g.updated_at
       FROM grade_records g JOIN assessments a ON a.id = g.assessment_id JOIN terms t ON t.id = a.term_id
       JOIN subjects sj ON sj.id = a.subject_id JOIN assessment_categories cat ON cat.id = a.category_id
      WHERE g.student_id = $1 AND t.academic_year_id = $2
        AND (NOT $3 OR a.status = 'published') AND ($4::int[] IS NULL OR a.subject_id = ANY($4))
      ORDER BY t.ordinal, a.week_no NULLS LAST, sj.sort_order, a.id`,
    [sid, year.id, !!access.publishedOnly, subjectIds])).rows;

  // Term: requested, else the term of the newest weekly record, else the first term.
  const weekly = all.filter((r) => r.week_no != null);
  const term = terms.find((t) => t.id === q.termId) || terms.find((t) => t.id === weekly[weekly.length - 1]?.term_id) || terms[0] || null;
  const termRows = weekly.filter((r) => r.term_id === term?.id);
  const weekNos = [...new Set(termRows.map((r) => r.week_no))].sort((a, b) => a - b);
  const week = weekNos.includes(q.week) ? q.week : weekNos[weekNos.length - 1] ?? null;

  const asRow = (r) => ({
    assessment_id: r.assessment_id, subject_id: r.subject_id, subject_name_en: r.subject_name_en, subject_name_ckb: r.subject_name_ckb,
    title: r.title, week_no: r.week_no, score: r.status === 'graded' ? r.score : null, max_score: r.max_score, status: r.status,
    percent: r.status === 'graded' ? round(pct(r.score, r.max_score), places) : r.status === 'missing' && policy.missing_counts_as_zero ? 0 : null,
    pass_mark_percent: Number(r.pass_mark_percent), comment: r.comment, sheet_status: r.sheet_status,
  });

  // Weekly statistics — only this week's assessments.
  const weekRows = termRows.filter((r) => r.week_no === week).map(asRow);
  const counted = weekRows.filter((r) => r.percent !== null);
  const maxes = [...new Set(counted.map((r) => Number(r.max_score)))];
  const weekAvg = mean(counted.map((r) => r.percent));
  const weekSummary = {
    average_percent: round(weekAvg, places),
    band: bandFor(weekAvg, policy.bands),
    // When every subject uses the same maximum, also express the average on that scale (e.g. 6.9 / 10).
    scale_max: maxes.length === 1 ? maxes[0] : null,
    average_on_scale: maxes.length === 1 && weekAvg !== null ? round((weekAvg / 100) * maxes[0], 1) : null,
    subjects: counted.length,
    below_pass: counted.filter((r) => r.percent < r.pass_mark_percent).length,
  };

  // Overall performance for the year (same engine as report cards) and per term.
  const subjects = (await db.query('SELECT id, name_en, name_ckb, pass_mark_percent FROM subjects ORDER BY sort_order, id')).rows;
  const overall = buildReport(subjects, all, policy);
  const termAverages = terms.map((t) => {
    const r = buildReport(subjects, all.filter((x) => x.term_id === t.id), policy);
    return { term_id: t.id, name_en: t.name_en, name_ckb: t.name_ckb, average_percent: r.overall_percent };
  }).filter((t) => t.average_percent !== null);

  // History: weekly averages and subject-by-subject progress across the term's weeks.
  const history = weekNos.map((w) => {
    const rs = termRows.filter((r) => r.week_no === w).map(asRow).filter((r) => r.percent !== null);
    return { week_no: w, average_percent: round(mean(rs.map((r) => r.percent)), places) };
  });
  const bySubject = [];
  for (const sj of subjects) {
    const cells = Object.fromEntries(weekNos.map((w) => {
      const rs = termRows.filter((r) => r.week_no === w && r.subject_id === sj.id).map(asRow).filter((r) => r.percent !== null);
      return [w, rs.length ? round(mean(rs.map((r) => r.percent)), places) : null];
    }));
    if (Object.values(cells).some((v) => v !== null)) bySubject.push({ subject_id: sj.id, name_en: sj.name_en, name_ckb: sj.name_ckb, pass_mark_percent: Number(sj.pass_mark_percent), weeks: cells });
  }

  // Behavior evaluation for the selected week (published only for students).
  const beh = term && week ? (await db.query(
    `SELECT rating, comment, status, updated_at FROM behavior_evaluations
      WHERE student_id = $1 AND term_id = $2 AND week_no = $3 AND (NOT $4 OR status = 'published')`,
    [sid, term.id, week, !!access.publishedOnly])).rows[0] || null : null;

  const placement = years.find((y) => y.id === year.id);
  res.json({
    school, student: { ...student, grade_level: placement.grade_level, section_name: placement.section_name },
    years: years.map((y) => ({ id: y.id, name: y.name, is_current: y.is_current })), year: { id: year.id, name: year.name },
    terms, term, weeks: weekNos, week, rows: weekRows, week_summary: weekSummary, behavior: beh,
    overall: { percent: overall.overall_percent, band: overall.overall_band, subjects_passed: overall.subjects_passed, subjects_failed: overall.subjects_failed },
    term_averages: termAverages, history, by_subject: bySubject,
    scope: { publishedOnly: !!access.publishedOnly, teacherScoped: !!access.teacherScoped, canPrint: true },
    generated_at: new Date().toISOString(),
    can_manage_behavior: has(req, 'grades.manage_all'),
  });
}));

module.exports = router;
