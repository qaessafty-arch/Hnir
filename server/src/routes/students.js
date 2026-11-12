'use strict';
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const db = require('../lib/db');
const { z, parse, id, text, optText, date, page } = require('../lib/validate');
const { ah, notFound, badRequest } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm } = require('../middleware/auth');
const { assertCanViewStudent } = require('../lib/access');
const { storeImage, resolveStored, MIME } = require('../lib/images');
const { createAccount, nextStudentNo } = require('../lib/accounts');
const { pgConflict } = require('./academic');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 } });

const SORTS = { name: 'lower(s.full_name_ckb)', student_no: 's.student_no', created: 's.created_at', grade: 'c.grade_level' };

router.get('/', requirePerm('students.read'), ah(async (req, res) => {
  const q = parse(page.extend({
    q: z.string().trim().max(100).optional(),
    yearId: id.optional(), classId: id.optional(), sectionId: id.optional(),
    status: z.enum(['active', 'archived', 'transferred', 'graduated', 'all']).default('active'),
    sort: z.enum(Object.keys(SORTS)).default('name'), dir: z.enum(['asc', 'desc']).default('asc'),
  }), req.query);
  const params = [];
  const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  // Enrollment for the selected (or current) academic year.
  const yearExpr = q.yearId ? p(q.yearId) : '(SELECT id FROM academic_years WHERE is_current)';
  if (q.status !== 'all') where.push(`s.status = ${p(q.status)}`);
  if (q.q) {
    const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const ph = p(like);
    where.push(`(lower(s.full_name_ckb) LIKE ${ph} OR lower(coalesce(s.full_name_en,'')) LIKE ${ph} OR lower(s.student_no) LIKE ${ph})`);
  }
  if (q.classId) where.push(`c.id = ${p(q.classId)}`);
  if (q.sectionId) where.push(`sec.id = ${p(q.sectionId)}`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM students s
    LEFT JOIN enrollments e ON e.student_id = s.id AND e.academic_year_id = ${yearExpr}
    LEFT JOIN sections sec ON sec.id = e.section_id
    LEFT JOIN classes c ON c.id = sec.class_id`;
  const total = (await db.query(`SELECT count(*)::int AS n ${from} ${whereSql}`, params)).rows[0].n;
  const order = `${SORTS[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, s.id`;
  const { rows } = await db.query(
    `SELECT s.id, s.student_no, s.full_name_ckb, s.full_name_en, s.gender, s.status, s.photo_path IS NOT NULL AS has_photo,
            s.guardian_phone, sec.id AS section_id, sec.name AS section_name, c.grade_level, c.id AS class_id
       ${from} ${whereSql} ORDER BY ${order}
      LIMIT ${p(q.pageSize)} OFFSET ${p((q.page - 1) * q.pageSize)}`, params);
  res.json({ items: rows, total, page: q.page, pageSize: q.pageSize });
}));

const studentSchema = z.object({
  full_name_ckb: text(120), full_name_en: optText(120),
  date_of_birth: date.optional().nullable(), gender: z.enum(['male', 'female']).optional().nullable(),
  guardian_name: optText(120), guardian_phone: optText(30).refine((v) => !v || /^[0-9+\-\s()]{5,30}$/.test(v), 'invalid phone'),
  address: optText(300),
});

async function enrollInSection(c, studentId, sectionId) {
  const sec = await c.query('SELECT id, academic_year_id FROM sections WHERE id = $1', [sectionId]);
  if (!sec.rowCount) throw badRequest('section_not_found');
  await c.query(
    `INSERT INTO enrollments (student_id, section_id, academic_year_id) VALUES ($1,$2,$3)
     ON CONFLICT (student_id, academic_year_id) DO UPDATE SET section_id = EXCLUDED.section_id, status = 'active', left_on = NULL`,
    [studentId, sectionId, sec.rows[0].academic_year_id]);
}

async function createStudent(c, b, sectionId) {
  const studentNo = await nextStudentNo(c);
  const acct = await createAccount(c, { username: studentNo, fullName: b.full_name_ckb, roles: ['student'] });
  const r = await c.query(
    `INSERT INTO students (user_id, student_no, full_name_ckb, full_name_en, date_of_birth, gender, guardian_name, guardian_phone, address, legacy_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, student_no`,
    [acct.userId, studentNo, b.full_name_ckb, b.full_name_en, b.date_of_birth ?? null, b.gender ?? null,
      b.guardian_name, b.guardian_phone, b.address, b.legacy_code ?? null]);
  if (sectionId) await enrollInSection(c, r.rows[0].id, sectionId);
  return { id: r.rows[0].id, student_no: studentNo, username: studentNo };
}

router.post('/', requirePerm('students.write'), ah(async (req, res) => {
  const b = parse(studentSchema.extend({ section_id: id.optional().nullable() }), req.body);
  const out = await db.tx(async (c) => {
    const s = await createStudent(c, b, b.section_id);
    await audit(req, 'student.create', { entityType: 'student', entityId: s.id, details: { student_no: s.student_no, section_id: b.section_id }, client: c });
    return s;
  });
  // Students sign in with their student ID only (no password).
  res.status(201).json(out);
}));

router.get('/:id', ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  await assertCanViewStudent(req, sid);
  const { rows } = await db.query(
    `SELECT s.id, s.student_no, s.full_name_ckb, s.full_name_en, s.date_of_birth, s.gender, s.status, s.status_reason,
            s.guardian_name, s.guardian_phone, s.address, s.photo_path IS NOT NULL AS has_photo, s.created_at, u.username
       FROM students s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = $1`, [sid]);
  const enr = await db.query(
    `SELECT e.id, e.status, e.enrolled_on, e.left_on, y.id AS year_id, y.name AS year_name, y.is_current,
            sec.id AS section_id, sec.name AS section_name, c.grade_level
       FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
       JOIN sections sec ON sec.id = e.section_id JOIN classes c ON c.id = sec.class_id
      WHERE e.student_id = $1 ORDER BY y.starts_on DESC`, [sid]);
  res.json({ ...rows[0], enrollments: enr.rows });
}));

router.put('/:id', requirePerm('students.write'), ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const b = parse(studentSchema, req.body);
  const r = await db.query(
    `UPDATE students SET full_name_ckb=$2, full_name_en=$3, date_of_birth=$4, gender=$5, guardian_name=$6,
            guardian_phone=$7, address=$8, updated_at=now() WHERE id=$1 RETURNING user_id`,
    [sid, b.full_name_ckb, b.full_name_en, b.date_of_birth ?? null, b.gender ?? null, b.guardian_name, b.guardian_phone, b.address]);
  if (!r.rowCount) throw notFound();
  if (r.rows[0].user_id) await db.query('UPDATE users SET full_name = $2 WHERE id = $1', [r.rows[0].user_id, b.full_name_ckb]);
  await audit(req, 'student.update', { entityType: 'student', entityId: sid, details: b });
  res.json({ ok: true });
}));

router.post('/:id/status', requirePerm('students.archive'), ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const b = parse(z.object({ status: z.enum(['active', 'archived', 'transferred', 'graduated']), reason: optText(300) }), req.body);
  if (b.status !== 'active' && !b.reason) throw badRequest('reason_required');
  await db.tx(async (c) => {
    const r = await c.query('UPDATE students SET status=$2, status_reason=$3, updated_at=now() WHERE id=$1 RETURNING user_id', [sid, b.status, b.reason]);
    if (!r.rowCount) throw notFound();
    // Archived students keep all records but lose portal access.
    if (r.rows[0].user_id) {
      await c.query('UPDATE users SET status = $2 WHERE id = $1', [r.rows[0].user_id, b.status === 'active' ? 'active' : 'disabled']);
      if (b.status !== 'active') await c.query('DELETE FROM sessions WHERE user_id = $1', [r.rows[0].user_id]);
    }
    if (b.status !== 'active') {
      await c.query(`UPDATE enrollments SET status='withdrawn', left_on=current_date
                      WHERE student_id=$1 AND status='active' AND academic_year_id IN (SELECT id FROM academic_years WHERE is_current)`, [sid]);
    }
    await audit(req, 'student.status', { entityType: 'student', entityId: sid, details: b, client: c });
  });
  res.json({ ok: true });
}));

router.post('/:id/enroll', requirePerm('students.write'), ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  const b = parse(z.object({ section_id: id }), req.body);
  await db.tx(async (c) => {
    const s = await c.query('SELECT status FROM students WHERE id = $1', [sid]);
    if (!s.rowCount) throw notFound();
    if (s.rows[0].status !== 'active') throw badRequest('student_not_active');
    await enrollInSection(c, sid, b.section_id);
    await audit(req, 'student.enroll', { entityType: 'student', entityId: sid, details: b, client: c });
  });
  res.json({ ok: true });
}));

router.post('/:id/photo', requirePerm('students.write'), upload.single('photo'), ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  if (!req.file) throw badRequest('file_required');
  const rel = await storeImage(req.file.buffer, 'students');
  if (!rel) throw badRequest('unsupported_image', 'Only JPEG, PNG or WebP images are accepted');
  const old = await db.query('SELECT photo_path FROM students WHERE id = $1', [sid]);
  if (!old.rowCount) throw notFound();
  await db.query('UPDATE students SET photo_path = $2, updated_at = now() WHERE id = $1', [sid, rel]);
  const oldPath = resolveStored(old.rows[0].photo_path);
  if (oldPath) fs.promises.unlink(oldPath).catch(() => {});
  await audit(req, 'student.photo', { entityType: 'student', entityId: sid });
  res.json({ ok: true });
}));

router.get('/:id/photo', ah(async (req, res) => {
  const sid = parse(id, req.params.id);
  await assertCanViewStudent(req, sid);
  const { rows } = await db.query('SELECT photo_path FROM students WHERE id = $1', [sid]);
  const file = resolveStored(rows[0]?.photo_path);
  if (!file || !fs.existsSync(file)) throw notFound();
  res.set('Content-Type', MIME[file.split('.').pop()]);
  res.set('Cache-Control', 'private, max-age=300');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', 'inline');
  fs.createReadStream(file).pipe(res);
}));

// ---------- Bulk import (preview → commit, all-or-nothing) ----------
const importRow = z.object({
  full_name_ckb: z.string().trim().min(1, 'required').max(120),
  full_name_en: z.string().trim().max(120).optional().nullable(),
  gender: z.preprocess((v) => (v === '' ? null : typeof v === 'string' ? v.toLowerCase().trim() : v), z.enum(['male', 'female']).nullable().optional()),
  date_of_birth: z.preprocess((v) => (v === '' ? null : v), date.nullable().optional()),
  grade_level: z.coerce.number().int().min(1).max(12),
  section: z.string().trim().min(1).max(20),
  guardian_name: z.string().trim().max(120).optional().nullable(),
  guardian_phone: z.string().trim().max(30).optional().nullable(),
});
async function validateImport(rows, yearId) {
  const sections = (await db.query(
    `SELECT s.id, s.name, c.grade_level FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.academic_year_id = $1`, [yearId])).rows;
  const results = rows.map((raw, i) => {
    const r = importRow.safeParse(raw);
    if (!r.success) return { row: i + 1, ok: false, errors: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) };
    const sec = sections.find((s) => s.grade_level === r.data.grade_level && s.name.toLowerCase() === r.data.section.toLowerCase());
    if (!sec) return { row: i + 1, ok: false, errors: [`section "${r.data.grade_level}-${r.data.section}" does not exist in this year`] };
    return { row: i + 1, ok: true, data: { ...r.data, section_id: sec.id } };
  });
  // Flag likely duplicates (same name in the same section) rather than silently importing twice.
  const existing = new Set((await db.query(
    `SELECT lower(s.full_name_ckb) || '|' || e.section_id AS k FROM students s JOIN enrollments e ON e.student_id = s.id
      WHERE e.academic_year_id = $1`, [yearId])).rows.map((r) => r.k));
  const seen = new Set();
  for (const r of results.filter((x) => x.ok)) {
    const k = `${r.data.full_name_ckb.toLowerCase()}|${r.data.section_id}`;
    if (existing.has(k) || seen.has(k)) r.warnings = ['possible_duplicate'];
    seen.add(k);
  }
  return results;
}
const importBody = z.object({ yearId: id, rows: z.array(z.record(z.string(), z.any())).min(1).max(1000), skipDuplicates: z.boolean().default(true) });

router.post('/import/preview', requirePerm('students.import'), ah(async (req, res) => {
  const b = parse(importBody, req.body);
  const results = await validateImport(b.rows, b.yearId);
  res.json({ results, valid: results.filter((r) => r.ok).length, invalid: results.filter((r) => !r.ok).length });
}));

router.post('/import/commit', requirePerm('students.import'), ah(async (req, res) => {
  const b = parse(importBody, req.body);
  const results = await validateImport(b.rows, b.yearId);
  if (results.some((r) => !r.ok)) throw badRequest('import_has_errors', 'Fix all errors before importing', results.filter((r) => !r.ok));
  const toCreate = results.filter((r) => !(b.skipDuplicates && r.warnings));
  const created = await db.tx(async (c) => {
    const out = [];
    for (const r of toCreate) {
      const s = await createStudent(c, r.data, r.data.section_id);
      out.push({ row: r.row, ...s, full_name_ckb: r.data.full_name_ckb });
    }
    await audit(req, 'student.import', { entityType: 'student', details: { count: out.length, yearId: b.yearId }, client: c });
    return out;
  });
  res.status(201).json({ created, skipped: results.length - toCreate.length });
}));

module.exports = router;
