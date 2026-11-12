'use strict';
const express = require('express');
const db = require('../lib/db');
const { z, parse, id, text, optText, page } = require('../lib/validate');
const { ah, notFound, badRequest, forbidden } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm, has } = require('../middleware/auth');
const { createAccount, issueLoginCode, nextStaffNo } = require('../lib/accounts');
const { pgConflict } = require('./academic');

const router = express.Router();
router.use(requirePerm('users.manage', 'roles.manage'));

const PRIVILEGED_ASSIGN = ['super_admin', 'principal'];

/** Every requested role must exist; only super admins may assign built-in admin roles or custom types. */
async function assertRolesExist(keys) {
  const r = await db.query('SELECT key FROM roles WHERE key = ANY($1::text[])', [keys]);
  if (r.rowCount !== new Set(keys).size) throw badRequest('unknown_role');
}
const needsSuperAdmin = (key) => PRIVILEGED_ASSIGN.includes(key) || key.startsWith('custom_');

async function rolesOf(userId) {
  const r = await db.query('SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [userId]);
  return r.rows.map((x) => x.key);
}
/** Principals manage staff, but only a super admin may touch super-admin/principal accounts. */
async function assertCanManage(req, targetUserId, newRoles = []) {
  if (has(req, 'roles.manage')) return;
  const current = await rolesOf(targetUserId);
  if ([...current, ...newRoles].some(needsSuperAdmin)) throw forbidden('cannot_manage_privileged_account');
}

router.get('/roles', ah(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT r.key, r.name_en, r.name_ckb, r.is_privileged, r.is_system, r.is_active, coalesce(array_agg(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id ORDER BY r.id`);
  res.json({ items: rows });
}));

router.get('/', ah(async (req, res) => {
  const q = parse(page.extend({ q: z.string().trim().max(100).optional(), role: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(),
    includeStudents: z.enum(['0', '1']).default('0') }), req.query);
  const params = [q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m)}%` : null, q.role ?? null, q.includeStudents === '1'];
  const where = `WHERE u.deleted_at IS NULL
      AND ($1::text IS NULL OR lower(u.username) LIKE $1 OR lower(u.full_name) LIKE $1 OR lower(coalesce(u.email,'')) LIKE $1)
      AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = $2))
      AND ($3 OR $2::text = 'student' OR NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = 'student'))`;
  const total = (await db.query(`SELECT count(*)::int n FROM users u ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.full_name, u.email, u.status, u.mfa_enabled, u.last_login_at, u.locked_until, u.created_at,
            (SELECT array_agg(r.key ORDER BY r.id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
       FROM users u ${where} ORDER BY lower(u.full_name) LIMIT $4 OFFSET $5`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows, total, page: q.page, pageSize: q.pageSize });
}));

const createSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/),
  full_name: text(120), email: z.string().trim().email().max(200).optional().nullable().or(z.literal('').transform(() => null)),
  phone: optText(30),
  roles: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).min(1).max(4),
});
router.post('/', ah(async (req, res) => {
  const b = parse(createSchema, req.body);
  if (b.roles.includes('student')) throw badRequest('student_role_is_managed_by_student_records');
  await assertRolesExist(b.roles);
  if (!has(req, 'roles.manage') && b.roles.some(needsSuperAdmin)) throw forbidden('cannot_assign_privileged_role');
  const out = await db.tx(async (c) => {
    const acct = await createAccount(c, { username: b.username, fullName: b.full_name, email: b.email, roles: b.roles }).catch(pgConflict);
    if (b.roles.includes('teacher')) {
      await c.query('INSERT INTO teachers (user_id, staff_no, phone) VALUES ($1,$2,$3)', [acct.userId, await nextStaffNo(c), b.phone]);
    }
    await audit(req, 'user.create', { entityType: 'user', entityId: acct.userId, details: { username: b.username, roles: b.roles }, client: c });
    return { id: acct.userId, username: b.username, login_code: acct.loginCode };
  });
  res.status(201).json(out);
}));

router.put('/:id', ah(async (req, res) => {
  const uid = parse(id, req.params.id);
  const b = parse(z.object({ full_name: text(120), email: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)) }), req.body);
  await assertCanManage(req, uid);
  const r = await db.query('UPDATE users SET full_name=$2, email=$3, updated_at=now() WHERE id=$1 AND deleted_at IS NULL',
    [uid, b.full_name, b.email ?? null]).catch(pgConflict);
  if (!r.rowCount) throw notFound();
  await audit(req, 'user.update', { entityType: 'user', entityId: uid, details: b });
  res.json({ ok: true });
}));

router.put('/:id/roles', ah(async (req, res) => {
  const uid = parse(id, req.params.id);
  const b = parse(z.object({ roles: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).min(1).max(4) }), req.body);
  await assertRolesExist(b.roles);
  await assertCanManage(req, uid, b.roles);
  if (uid === req.user.id && !b.roles.includes('super_admin') && req.user.roles.includes('super_admin')) throw badRequest('cannot_remove_own_super_admin');
  await db.tx(async (c) => {
    const before = await c.query('SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [uid]);
    if (before.rows.some((r) => r.key === 'student') !== b.roles.includes('student')) throw badRequest('student_role_is_managed_by_student_records');
    await c.query('DELETE FROM user_roles WHERE user_id = $1', [uid]);
    await c.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = ANY($2::text[])', [uid, b.roles]);
    if (b.roles.includes('teacher')) {
      await c.query(`INSERT INTO teachers (user_id, staff_no) SELECT $1, 'STF-' || lpad(nextval('staff_no_seq')::text, 4, '0')
                      WHERE NOT EXISTS (SELECT 1 FROM teachers WHERE user_id = $1)`, [uid]);
    }
    // A role change takes effect immediately: force re-login.
    await c.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
    await audit(req, 'user.roles', { entityType: 'user', entityId: uid, details: { before: before.rows.map((r) => r.key), after: b.roles }, client: c });
  });
  res.json({ ok: true });
}));

router.post('/:id/status', ah(async (req, res) => {
  const uid = parse(id, req.params.id);
  const b = parse(z.object({ status: z.enum(['active', 'disabled']) }), req.body);
  if (uid === req.user.id) throw badRequest('cannot_change_own_status');
  await assertCanManage(req, uid);
  await db.tx(async (c) => {
    const r = await c.query('UPDATE users SET status=$2, failed_login_count=0, locked_until=NULL, updated_at=now() WHERE id=$1', [uid, b.status]);
    if (!r.rowCount) throw notFound();
    if (b.status === 'disabled') await c.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
    await audit(req, 'user.status', { entityType: 'user', entityId: uid, details: b, client: c });
  });
  res.json({ ok: true });
}));

// Issue a new secret sign-in code (staff). The old code stops working and all sessions end.
router.post('/:id/login-code', ah(async (req, res) => {
  const uid = parse(id, req.params.id);
  await assertCanManage(req, uid);
  const code = await db.tx(async (c) => {
    const u = await c.query(`SELECT 1 FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key <> 'student')`, [uid]);
    if (!u.rowCount) throw notFound();
    const out = await issueLoginCode(c, uid);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
    await audit(req, 'user.login_code_issued', { entityType: 'user', entityId: uid, client: c });
    return out;
  });
  res.json({ login_code: code });
}));

router.post('/:id/mfa-reset', ah(async (req, res) => {
  const uid = parse(id, req.params.id);
  await assertCanManage(req, uid);
  await db.tx(async (c) => {
    const r = await c.query('UPDATE users SET mfa_enabled=false, mfa_secret_enc=NULL WHERE id=$1', [uid]);
    if (!r.rowCount) throw notFound();
    await c.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
    await audit(req, 'user.mfa_reset', { entityType: 'user', entityId: uid, client: c });
  });
  res.json({ ok: true });
}));

module.exports = router;
