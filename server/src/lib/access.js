'use strict';
const db = require('./db');
const { has } = require('../middleware/auth');
const { forbidden, notFound } = require('./errors');

/**
 * Object-level authorization for a student record (prevents IDOR/BOLA).
 * Returns { publishedOnly } or throws 403/404. Never trust the id from the client.
 */
async function assertCanViewStudent(req, studentId) {
  const { rows } = await db.query('SELECT id, user_id FROM students WHERE id = $1', [studentId]);
  if (!rows.length) throw notFound();
  const st = rows[0];
  if (has(req, 'students.read') || has(req, 'grades.read_all')) return { publishedOnly: false, student: st };
  if (has(req, 'self.grades') && st.user_id === req.user.id) return { publishedOnly: true, student: st };
  if (has(req, 'self.children')) {
    const r = await db.query(
      `SELECT 1 FROM guardian_student_relationships g JOIN parents p ON p.id = g.parent_id
        WHERE p.user_id = $1 AND g.student_id = $2 AND g.verified_at IS NOT NULL`, [req.user.id, studentId]);
    if (r.rowCount) return { publishedOnly: true, student: st };
  }
  if (has(req, 'grades.enter')) {
    const r = await db.query(
      `SELECT 1 FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id
         JOIN enrollments e ON e.section_id = ta.section_id
        WHERE t.user_id = $1 AND e.student_id = $2 LIMIT 1`, [req.user.id, studentId]);
    if (r.rowCount) return { publishedOnly: false, teacherScoped: true, student: st };
  }
  // Same response as "not found" so ids cannot be enumerated.
  throw notFound();
}

async function teacherIdFor(userId) {
  const { rows } = await db.query('SELECT id FROM teachers WHERE user_id = $1', [userId]);
  return rows[0]?.id ?? null;
}

/** Can the user edit/see the grade sheet (assessment)? */
async function assertAssessmentAccess(req, assessment, { write = false } = {}) {
  if (has(req, 'grades.manage_all')) return { manager: true };
  if (!write && has(req, 'grades.read_all')) return { manager: false };
  if (has(req, 'grades.enter')) {
    const r = await db.query(
      `SELECT 1 FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id
        WHERE t.user_id = $1 AND ta.section_id = $2 AND ta.subject_id = $3`,
      [req.user.id, assessment.section_id, assessment.subject_id]);
    if (r.rowCount) return { manager: false, teacher: true };
  }
  throw notFound();
}

module.exports = { assertCanViewStudent, assertAssessmentAccess, teacherIdFor, forbidden };
