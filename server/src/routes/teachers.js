'use strict';
const express = require('express');
const db = require('../lib/db');
const { z, parse, id, text, optText } = require('../lib/validate');
const { ah, notFound } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm } = require('../middleware/auth');
const { createAccount, nextStaffNo } = require('../lib/accounts');
const { pgConflict } = require('./academic');

const router = express.Router();

router.get('/', requirePerm('teachers.read', 'assignments.manage', 'academic.manage'), ah(async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['active', 'inactive', 'all']).default('active') }), req.query);
  const { rows } = await db.query(
    `SELECT t.id, t.staff_no, t.phone, t.status, u.id AS user_id, u.username, u.full_name, u.email, u.last_login_at,
            (SELECT count(*) FROM teacher_assignments ta WHERE ta.teacher_id = t.id
               AND ta.academic_year_id IN (SELECT id FROM academic_years WHERE is_current))::int AS assignment_count
       FROM teachers t JOIN users u ON u.id = t.user_id
      WHERE ($1::text = 'all' OR t.status = $1)
        AND ($2::text IS NULL OR lower(u.full_name) LIKE $2 OR lower(t.staff_no) LIKE $2)
      ORDER BY lower(u.full_name)`,
    [q.status, q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m)}%` : null]);
  res.json({ items: rows });
}));

router.post('/', requirePerm('teachers.write'), ah(async (req, res) => {
  const b = parse(z.object({
    username: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/), full_name: text(120),
    email: z.string().trim().email().max(200).optional().nullable().or(z.literal('').transform(() => null)), phone: optText(30),
  }), req.body);
  const out = await db.tx(async (c) => {
    const acct = await createAccount(c, { username: b.username, fullName: b.full_name, email: b.email, roles: ['teacher'] }).catch(pgConflict);
    const t = await c.query('INSERT INTO teachers (user_id, staff_no, phone) VALUES ($1,$2,$3) RETURNING id, staff_no',
      [acct.userId, await nextStaffNo(c), b.phone]);
    await audit(req, 'teacher.create', { entityType: 'teacher', entityId: t.rows[0].id, details: { username: b.username }, client: c });
    return { id: t.rows[0].id, staff_no: t.rows[0].staff_no, username: b.username, login_code: acct.loginCode };
  });
  res.status(201).json(out);
}));

router.put('/:id', requirePerm('teachers.write'), ah(async (req, res) => {
  const tid = parse(id, req.params.id);
  const b = parse(z.object({ full_name: text(120), phone: optText(30), status: z.enum(['active', 'inactive']),
    email: z.string().trim().email().max(200).optional().nullable().or(z.literal('').transform(() => null)) }), req.body);
  await db.tx(async (c) => {
    const t = await c.query('UPDATE teachers SET phone=$2, status=$3, updated_at=now() WHERE id=$1 RETURNING user_id', [tid, b.phone, b.status]);
    if (!t.rowCount) throw notFound();
    await c.query('UPDATE users SET full_name=$2, email=$3, updated_at=now() WHERE id=$1', [t.rows[0].user_id, b.full_name, b.email ?? null]).catch(pgConflict);
    await audit(req, 'teacher.update', { entityType: 'teacher', entityId: tid, details: b, client: c });
  });
  res.json({ ok: true });
}));

module.exports = router;
