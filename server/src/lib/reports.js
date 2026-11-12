'use strict';
const db = require('./db');
const { buildReport } = require('./grading');
const { getSettings } = require('./settings');

/** Collect grade rows for one student. Filters: termId | yearId, publishedOnly, subjectIds (teacher scope). */
async function studentReport(studentId, { termId, yearId, publishedOnly, subjectIds }) {
  const policy = (await getSettings()).grading;
  const rows = (await db.query(
    `SELECT a.id AS assessment_id, a.title, a.week_no, a.max_score, a.assessed_on, a.status AS assessment_status,
            a.subject_id, a.category_id, cat.weight AS category_weight, cat.name_en AS category_name_en, cat.name_ckb AS category_name_ckb,
            t.id AS term_id, t.name_en AS term_name_en, t.name_ckb AS term_name_ckb,
            g.score, g.status, g.comment, g.updated_at
       FROM grade_records g JOIN assessments a ON a.id = g.assessment_id JOIN terms t ON t.id = a.term_id
       JOIN assessment_categories cat ON cat.id = a.category_id
      WHERE g.student_id = $1
        AND ($2::int IS NULL OR a.term_id = $2) AND ($3::int IS NULL OR t.academic_year_id = $3)
        AND (NOT $4 OR a.status = 'published')
        AND ($5::int[] IS NULL OR a.subject_id = ANY($5))
      ORDER BY t.ordinal, a.subject_id, a.week_no NULLS LAST, a.assessed_on NULLS LAST, a.id`,
    [studentId, termId ?? null, yearId ?? null, !!publishedOnly, subjectIds ?? null])).rows;
  const subjects = (await db.query('SELECT id, name_en, name_ckb, pass_mark_percent, sort_order FROM subjects ORDER BY sort_order, id')).rows;
  const report = buildReport(subjects, rows, policy);
  return { ...report, assessments: rows, policy: { mode: policy.mode, missing_counts_as_zero: policy.missing_counts_as_zero, bands: policy.bands } };
}

module.exports = { studentReport };
