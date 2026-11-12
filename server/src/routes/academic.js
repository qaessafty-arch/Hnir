'use strict';
const express = require('express');
const db = require('../lib/db');
const { z, parse, id, text, optText, date } = require('../lib/validate');
const { ah, notFound, conflict, badRequest } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm, has } = require('../middleware/auth');

const router = express.Router();
const manage = requirePerm('academic.manage');
// Reference lists are readable by any staff member (needed for dropdowns).
const staffRead = requirePerm('academic.manage', 'students.read', 'grades.enter', 'grades.read_all', 'teachers.read');

function pgConflict(err) {
  if (err.code === '23505') throw conflict('duplicate', 'A record with these values already exists');
  if (err.code === '23503') throw conflict('in_use', 'Record is referenced by other data');
  if (err.code === '23514') throw badRequest('constraint_failed', err.constraint);
  throw err;
}

// ---------- Academic years ----------
router.get('/years', staffRead, ah(async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM academic_years ORDER BY starts_on DESC');
  res.json({ items: rows });
}));
const yearSchema = z.object({ name: text(40), starts_on: date, ends_on: date, status: z.enum(['planned', 'active', 'closed']).default('active') });
router.post('/years', manage, ah(async (req, res) => {
  const b = parse(yearSchema, req.body);
  const r = await db.query('INSERT INTO academic_years (name, starts_on, ends_on, status) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.name, b.starts_on, b.ends_on, b.status]).catch(pgConflict);
  await audit(req, 'academic_year.create', { entityType: 'academic_year', entityId: r.rows[0].id, details: b });
  res.status(201).json(r.rows[0]);
}));
router.put('/years/:id', manage, ah(async (req, res) => {
  const yid = parse(id, req.params.id);
  const b = parse(yearSchema, req.body);
  const r = await db.query('UPDATE academic_years SET name=$2, starts_on=$3, ends_on=$4, status=$5 WHERE id=$1 RETURNING *',
    [yid, b.name, b.starts_on, b.ends_on, b.status]).catch(pgConflict);
  if (!r.rowCount) throw notFound();
  await audit(req, 'academic_year.update', { entityType: 'academic_year', entityId: yid, details: b });
  res.json(r.rows[0]);
}));
router.post('/years/:id/set-current', manage, ah(async (req, res) => {
  const yid = parse(id, req.params.id);
  await db.tx(async (c) => {
    await c.query('UPDATE academic_years SET is_current = false WHERE is_current');
    const r = await c.query('UPDATE academic_years SET is_current = true WHERE id = $1', [yid]);
    if (!r.rowCount) throw notFound();
    await audit(req, 'academic_year.set_current', { entityType: 'academic_year', entityId: yid, client: c });
  });
  res.json({ ok: true });
}));

// ---------- Terms ----------
router.get('/terms', staffRead, ah(async (req, res) => {
  const q = parse(z.object({ yearId: id.optional() }), req.query);
  const { rows } = await db.query(
    `SELECT t.*, y.name AS year_name FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
      WHERE ($1::int IS NULL OR t.academic_year_id = $1) ORDER BY y.starts_on DESC, t.ordinal`, [q.yearId ?? null]);
  res.json({ items: rows });
}));
const termSchema = z.object({
  academic_year_id: id, name_en: text(60), name_ckb: text(60), ordinal: z.coerce.number().int().min(1).max(12),
  starts_on: date, ends_on: date, grade_entry_open: z.boolean().default(true),
});
router.post('/terms', manage, ah(async (req, res) => {
  const b = parse(termSchema, req.body);
  const r = await db.query(
    `INSERT INTO terms (academic_year_id, name_en, name_ckb, ordinal, starts_on, ends_on, grade_entry_open)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.academic_year_id, b.name_en, b.name_ckb, b.ordinal, b.starts_on, b.ends_on, b.grade_entry_open]).catch(pgConflict);
  await audit(req, 'term.create', { entityType: 'term', entityId: r.rows[0].id, details: b });
  res.status(201).json(r.rows[0]);
}));
router.put('/terms/:id', manage, ah(async (req, res) => {
  const tid = parse(id, req.params.id);
  const b = parse(termSchema, req.body);
  const r = await db.query(
    `UPDATE terms SET academic_year_id=$2, name_en=$3, name_ckb=$4, ordinal=$5, starts_on=$6, ends_on=$7, grade_entry_open=$8
      WHERE id=$1 RETURNING *`,
    [tid, b.academic_year_id, b.name_en, b.name_ckb, b.ordinal, b.starts_on, b.ends_on, b.grade_entry_open]).catch(pgConflict);
  if (!r.rowCount) throw notFound();
  await audit(req, 'term.update', { entityType: 'term', entityId: tid, details: b });
  res.json(r.rows[0]);
}));

// ---------- Classes (grade levels) ----------
router.get('/classes', staffRead, ah(async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM classes ORDER BY grade_level');
  res.json({ items: rows });
}));

// ---------- Sections ----------
router.get('/sections', staffRead, ah(async (req, res) => {
  const q = parse(z.object({ yearId: id.optional(), mine: z.enum(['1']).optional() }), req.query);
  // Teachers without school-wide rights only see their own sections.
  const onlyMine = q.mine === '1' || !(has(req, 'students.read') || has(req, 'grades.read_all') || has(req, 'academic.manage'));
  const { rows } = await db.query(
    `SELECT s.*, c.grade_level, c.name_en AS class_name_en, c.name_ckb AS class_name_ckb, y.name AS year_name,
            u.full_name AS homeroom_teacher_name,
            (SELECT count(*) FROM enrollments e WHERE e.section_id = s.id AND e.status = 'active')::int AS student_count
       FROM sections s JOIN classes c ON c.id = s.class_id JOIN academic_years y ON y.id = s.academic_year_id
       LEFT JOIN teachers t ON t.id = s.homeroom_teacher_id LEFT JOIN users u ON u.id = t.user_id
      WHERE ($1::int IS NULL OR s.academic_year_id = $1)
        AND (NOT $2 OR EXISTS (SELECT 1 FROM teacher_assignments ta JOIN teachers tt ON tt.id = ta.teacher_id
                                WHERE ta.section_id = s.id AND tt.user_id = $3))
      ORDER BY y.starts_on DESC, c.grade_level, s.name`, [q.yearId ?? null, onlyMine, req.user.id]);
  res.json({ items: rows });
}));
const sectionSchema = z.object({
  class_id: id, academic_year_id: id, name: text(20), homeroom_teacher_id: id.nullable().optional(),
  capacity: z.coerce.number().int().min(1).max(200).nullable().optional(),
});
router.post('/sections', manage, ah(async (req, res) => {
  const b = parse(sectionSchema, req.body);
  const r = await db.query(
    `INSERT INTO sections (class_id, academic_year_id, name, homeroom_teacher_id, capacity) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [b.class_id, b.academic_year_id, b.name, b.homeroom_teacher_id ?? null, b.capacity ?? null]).catch(pgConflict);
  await audit(req, 'section.create', { entityType: 'section', entityId: r.rows[0].id, details: b });
  res.status(201).json(r.rows[0]);
}));
router.put('/sections/:id', manage, ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const b = parse(sectionSchema, req.body);
  const r = await db.query(
    `UPDATE sections SET class_id=$2, academic_year_id=$3, name=$4, homeroom_teacher_id=$5, capacity=$6 WHERE id=$1 RETURNING *`,
    [sid, b.class_id, b.academic_year_id, b.name, b.homeroom_teacher_id ?? null, b.capacity ?? null]).catch(pgConflict);
  if (!r.rowCount) throw notFound();
  await audit(req, 'section.update', { entityType: 'section', entityId: sid, details: b });
  res.json(r.rows[0]);
}));
router.delete('/sections/:id', manage, ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const r = await db.query('DELETE FROM sections WHERE id = $1', [sid]).catch(pgConflict);
  if (!r.rowCount) throw notFound();
  await audit(req, 'section.delete', { entityType: 'section', entityId: sid });
  res.json({ ok: true });
}));

// ---------- Subjects ----------
router.get('/subjects', staffRead, ah(async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM subjects ORDER BY sort_order, id');
  res.json({ items: rows });
}));
const subjectSchema = z.object({
  code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/).transform((s) => s.toUpperCase()),
  name_en: text(80), name_ckb: text(80),
  default_max_score: z.coerce.number().positive().max(1000),
  pass_mark_percent: z.coerce.number().min(0).max(100),
  sort_order: z.coerce.number().int().min(0).max(1000).default(0),
  is_active: z.boolean().default(true),
});
router.post('/subjects', manage, ah(async (req, res) => {
  const b = parse(subjectSchema, req.body);
  const r = await db.query(
    `INSERT INTO subjects (code, name_en, name_ckb, default_max_score, pass_mark_percent, sort_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.code, b.name_en, b.name_ckb, b.default_max_score, b.pass_mark_percent, b.sort_order, b.is_active]).catch(pgConflict);
  await audit(req, 'subject.create', { entityType: 'subject', entityId: r.rows[0].id, details: b });
  res.status(201).json(r.rows[0]);
}));
router.put('/subjects/:id', manage, ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const b = parse(subjectSchema, req.body);
  const r = await db.query(
    `UPDATE subjects SET code=$2, name_en=$3, name_ckb=$4, default_max_score=$5, pass_mark_percent=$6, sort_order=$7, is_active=$8
      WHERE id=$1 RETURNING *`,
    [sid, b.code, b.name_en, b.name_ckb, b.default_max_score, b.pass_mark_percent, b.sort_order, b.is_active]).catch(pgConflict);
  if (!r.rowCount) throw notFound();
  await audit(req, 'subject.update', { entityType: 'subject', entityId: sid, details: b });
  res.json(r.rows[0]);
}));

// ---------- Assessment categories ----------
router.get('/categories', staffRead, ah(async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM assessment_categories ORDER BY id');
  res.json({ items: rows });
}));
router.put('/categories/:id', manage, ah(async (req, res) => {
  const cid = parse(id, req.params.id);
  const b = parse(z.object({ name_en: text(60), name_ckb: text(60), weight: z.coerce.number().min(0).max(100) }), req.body);
  const r = await db.query('UPDATE assessment_categories SET name_en=$2, name_ckb=$3, weight=$4 WHERE id=$1 RETURNING *',
    [cid, b.name_en, b.name_ckb, b.weight]);
  if (!r.rowCount) throw notFound();
  await audit(req, 'category.update', { entityType: 'assessment_category', entityId: cid, details: b });
  res.json(r.rows[0]);
}));

// ---------- Teacher assignments ----------
router.get('/assignments', requirePerm('assignments.manage', 'grades.enter', 'grades.read_all'), ah(async (req, res) => {
  const q = parse(z.object({ yearId: id.optional(), teacherId: id.optional() }), req.query);
  const mineOnly = !has(req, 'assignments.manage') && !has(req, 'grades.read_all');
  const { rows } = await db.query(
    `SELECT ta.*, u.full_name AS teacher_name, s.name AS section_name, c.grade_level,
            sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb, y.name AS year_name
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id JOIN users u ON u.id = t.user_id
       JOIN sections s ON s.id = ta.section_id JOIN classes c ON c.id = s.class_id
       JOIN subjects sj ON sj.id = ta.subject_id JOIN academic_years y ON y.id = ta.academic_year_id
      WHERE ($1::int IS NULL OR ta.academic_year_id = $1) AND ($2::bigint IS NULL OR ta.teacher_id = $2)
        AND (NOT $3 OR t.user_id = $4)
      ORDER BY c.grade_level, s.name, sj.sort_order`, [q.yearId ?? null, q.teacherId ?? null, mineOnly, req.user.id]);
  res.json({ items: rows });
}));
router.post('/assignments', requirePerm('assignments.manage'), ah(async (req, res) => {
  const b = parse(z.object({ teacher_id: id, section_id: id, subject_id: id }), req.body);
  const sec = await db.query('SELECT academic_year_id FROM sections WHERE id = $1', [b.section_id]);
  if (!sec.rowCount) throw notFound();
  const r = await db.query(
    `INSERT INTO teacher_assignments (teacher_id, section_id, subject_id, academic_year_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [b.teacher_id, b.section_id, b.subject_id, sec.rows[0].academic_year_id]).catch(pgConflict);
  await audit(req, 'assignment.create', { entityType: 'teacher_assignment', entityId: r.rows[0].id, details: b });
  res.status(201).json(r.rows[0]);
}));
router.delete('/assignments/:id', requirePerm('assignments.manage'), ah(async (req, res) => {
  const aid = parse(id, req.params.id);
  const r = await db.query('DELETE FROM teacher_assignments WHERE id = $1 RETURNING *', [aid]);
  if (!r.rowCount) throw notFound();
  await audit(req, 'assignment.delete', { entityType: 'teacher_assignment', entityId: aid, details: r.rows[0] });
  res.json({ ok: true });
}));

module.exports = router;
module.exports.pgConflict = pgConflict;
