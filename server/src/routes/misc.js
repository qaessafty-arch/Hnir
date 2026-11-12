'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const { z, parse, id, page, date } = require('../lib/validate');
const { ah, badRequest, notFound } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm, has } = require('../middleware/auth');
const { getSettings, invalidateSettings } = require('../lib/settings');

const router = express.Router();

// ---------- Portal (students / parents) ----------
router.get('/portal/me', requirePerm('self.grades', 'self.children'), ah(async (req, res) => {
  const children = [];
  if (has(req, 'self.grades')) {
    const r = await db.query('SELECT id, student_no, full_name_ckb, full_name_en FROM students WHERE user_id = $1', [req.user.id]);
    children.push(...r.rows.map((x) => ({ ...x, self: true })));
  }
  if (has(req, 'self.children')) {
    const r = await db.query(
      `SELECT s.id, s.student_no, s.full_name_ckb, s.full_name_en, g.relationship
         FROM guardian_student_relationships g JOIN parents p ON p.id = g.parent_id JOIN students s ON s.id = g.student_id
        WHERE p.user_id = $1 AND g.verified_at IS NOT NULL ORDER BY s.full_name_ckb`, [req.user.id]);
    children.push(...r.rows);
  }
  res.json({ students: children });
}));

// Terms visible to the portal user for one student (years the student was enrolled in).
router.get('/portal/students/:id/terms', ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  await require('../lib/access').assertCanViewStudent(req, sid);
  const { rows } = await db.query(
    `SELECT t.id, t.name_en, t.name_ckb, t.ordinal, y.id AS year_id, y.name AS year_name, y.is_current
       FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
      WHERE y.id IN (SELECT academic_year_id FROM enrollments WHERE student_id = $1)
      ORDER BY y.starts_on DESC, t.ordinal`, [sid]);
  res.json({ items: rows });
}));

// ---------- Dashboard ----------
router.get('/dashboard', requirePerm('dashboard.school'), ah(async (req, res) => {
  const year = (await db.query('SELECT * FROM academic_years WHERE is_current')).rows[0] || null;
  const yid = year?.id ?? null;
  const [students, teachers, sections, statuses, completion, pending, byGrade] = await Promise.all([
    db.query(`SELECT count(*) FILTER (WHERE status='active')::int AS active, count(*)::int AS total FROM students`),
    db.query(`SELECT count(*)::int AS n FROM teachers WHERE status='active'`),
    db.query(`SELECT count(*)::int AS n FROM sections WHERE academic_year_id = $1`, [yid]),
    db.query(`SELECT a.status, count(*)::int n FROM assessments a JOIN terms t ON t.id = a.term_id WHERE t.academic_year_id = $1 GROUP BY a.status`, [yid]),
    db.query(`SELECT
        (SELECT count(*) FROM grade_records g JOIN assessments a ON a.id = g.assessment_id JOIN terms t ON t.id = a.term_id WHERE t.academic_year_id = $1)::int AS entered,
        (SELECT count(*) FROM assessments a JOIN terms t ON t.id = a.term_id JOIN enrollments e ON e.section_id = a.section_id AND e.status='active'
          WHERE t.academic_year_id = $1)::int AS expected`, [yid]),
    db.query(`SELECT a.id, a.title, a.updated_at, c.grade_level, sec.name AS section_name, sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb
                FROM assessments a JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id JOIN subjects sj ON sj.id = a.subject_id
               WHERE a.status = 'submitted' ORDER BY a.updated_at LIMIT 10`),
    db.query(`SELECT c.grade_level, count(*)::int n FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN classes c ON c.id = s.class_id
               WHERE e.academic_year_id = $1 AND e.status = 'active' GROUP BY c.grade_level ORDER BY c.grade_level`, [yid]),
  ]);
  let activity = [];
  if (has(req, 'audit.read')) {
    activity = (await db.query(
      `SELECT l.id, l.action, l.entity_type, l.entity_id, l.created_at, u.full_name AS actor_name
         FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
        WHERE l.action NOT LIKE 'report.%' ORDER BY l.created_at DESC LIMIT 10`)).rows;
  }
  res.json({
    year,
    students: students.rows[0], teachers: teachers.rows[0].n, sections: sections.rows[0].n,
    assessments: Object.fromEntries(statuses.rows.map((r) => [r.status, r.n])),
    completion: completion.rows[0], pending_approvals: pending.rows, students_by_grade: byGrade.rows, activity,
  });
}));

router.get('/dashboard/teacher', requirePerm('grades.enter'), ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ta.id, ta.section_id, ta.subject_id, s.name AS section_name, c.grade_level, sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb,
            (SELECT count(*) FROM enrollments e WHERE e.section_id = ta.section_id AND e.status = 'active')::int AS students,
            (SELECT count(*) FROM assessments a WHERE a.section_id = ta.section_id AND a.subject_id = ta.subject_id AND a.status IN ('draft','returned'))::int AS open_sheets,
            (SELECT count(*) FROM assessments a WHERE a.section_id = ta.section_id AND a.subject_id = ta.subject_id AND a.status = 'returned')::int AS returned_sheets
       FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id JOIN sections s ON s.id = ta.section_id
       JOIN classes c ON c.id = s.class_id JOIN subjects sj ON sj.id = ta.subject_id
      WHERE t.user_id = $1 AND ta.academic_year_id IN (SELECT id FROM academic_years WHERE is_current)
      ORDER BY c.grade_level, s.name, sj.sort_order`, [req.user.id]);
  res.json({ assignments: rows });
}));

// ---------- Audit log ----------
router.get('/audit', requirePerm('audit.read'), ah(async (req, res) => {
  const q = parse(page.extend({ action: z.string().trim().max(60).optional(), actorId: id.optional(),
    entityType: z.string().trim().max(40).optional(), entityId: z.string().trim().max(40).optional(),
    from: date.optional(), to: date.optional() }), req.query);
  const params = [q.action ? `${q.action.replace(/[\\%_]/g, (m) => '\\' + m)}%` : null, q.actorId ?? null, q.entityType ?? null, q.entityId ?? null, q.from ?? null, q.to ?? null];
  const where = `WHERE ($1::text IS NULL OR l.action LIKE $1) AND ($2::bigint IS NULL OR l.actor_user_id = $2)
     AND ($3::text IS NULL OR l.entity_type = $3) AND ($4::text IS NULL OR l.entity_id = $4)
     AND ($5::date IS NULL OR l.created_at >= $5::date) AND ($6::date IS NULL OR l.created_at < $6::date + 1)`;
  const total = (await db.query(`SELECT count(*)::int n FROM audit_logs l ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT l.*, u.full_name AS actor_name, u.username AS actor_username FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
      ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT $7 OFFSET $8`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows, total, page: q.page, pageSize: q.pageSize });
}));

// ---------- Settings ----------
const SETTING_SCHEMAS = {
  school: z.object({ name_en: z.string().trim().min(1).max(120), name_ckb: z.string().trim().min(1).max(120), founded: z.number().int().min(1900).max(2100) }),
  grading: z.object({
    mode: z.enum(['weighted', 'unweighted']), allow_decimals: z.boolean(), decimal_places: z.number().int().min(0).max(2),
    display_decimals: z.number().int().min(0).max(2), rounding: z.enum(['half_up', 'half_even', 'floor']),
    missing_counts_as_zero: z.boolean(),
    bands: z.array(z.object({ min: z.number().min(0).max(100), key: z.enum(['excellent', 'very_good', 'good', 'pass', 'needs_improvement']) })).min(1).max(5),
  }),
  security: z.object({
    mfa_required_roles: z.array(z.enum(['super_admin', 'principal', 'registrar', 'auditor', 'teacher'])).refine((r) => r.includes('super_admin'), 'super_admin must require MFA'),
    session_idle_minutes: z.number().int().min(5).max(240), session_absolute_hours: z.number().int().min(1).max(24),
    max_failed_logins: z.number().int().min(3).max(20), lockout_minutes: z.number().int().min(1).max(1440),
  }),
};
router.get('/settings', ah(async (req, res) => {
  const s = await getSettings();
  // Everyone signed in may read school + grading policy (shown on report cards); security settings only for admins.
  res.json(has(req, 'system.settings') ? s : { school: s.school, grading: s.grading });
}));
router.put('/settings/:key', requirePerm('system.settings'), ah(async (req, res) => {
  const schema = SETTING_SCHEMAS[req.params.key];
  if (!schema) throw notFound();
  const value = parse(schema, req.body);
  const before = (await getSettings())[req.params.key];
  await db.query('UPDATE system_settings SET value=$2, updated_by=$3, updated_at=now() WHERE key=$1', [req.params.key, value, req.user.id]);
  invalidateSettings();
  await audit(req, 'settings.update', { entityType: 'setting', entityId: req.params.key, details: { before, after: value } });
  res.json(value);
}));

// ---------- Notifications ----------
router.get('/notifications', ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, kind, payload, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.user.id]);
  const unread = (await db.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].n;
  res.json({ items: rows, unread });
}));
router.post('/notifications/read', ah(async (req, res) => {
  const b = parse(z.object({ ids: z.array(id).max(100).optional() }), req.body);
  await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`,
    [req.user.id, b.ids ?? null]);
  res.json({ ok: true });
}));

// ---------- Backups (status only; backups are produced by scripts/backup.sh) ----------
router.get('/system/backups', requirePerm('backups.manage'), ah(async (_req, res) => {
  const dir = process.env.BACKUP_DIR || path.resolve(__dirname, '../../../backups');
  let items = [];
  try {
    items = fs.readdirSync(dir).filter((f) => f.endsWith('.enc')).map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, created_at: st.mtime };
    }).sort((a, b) => b.created_at - a.created_at).slice(0, 50);
  } catch { /* directory absent */ }
  res.json({ dir_configured: !!process.env.BACKUP_DIR, items });
}));

module.exports = router;
