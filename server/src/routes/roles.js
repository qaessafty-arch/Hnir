'use strict';
/** Account types (roles): super-administrator configuration of which sections each type can use. */
const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { z, parse, text, optText } = require('../lib/validate');
const { ah, notFound, badRequest, conflict } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm } = require('../middleware/auth');
const { SECTIONS, LOCKED_ROLES, levelsFromPermissions, permissionsFromLevels } = require('../lib/sections');

const router = express.Router();
router.use(requirePerm('roles.manage'));

const keyParam = z.string().regex(/^[a-z0-9_]{2,40}$/);

async function loadRole(c, key) {
  const r = await c.query('SELECT * FROM roles WHERE key = $1', [key]);
  if (!r.rowCount) throw notFound();
  return r.rows[0];
}

router.get('/', ah(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT r.key, r.name_en, r.name_ckb, r.description, r.is_system, r.is_active,
            coalesce(array_agg(p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions,
            (SELECT count(*) FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role_id = r.id AND u.deleted_at IS NULL)::int AS user_count
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id ORDER BY r.is_system DESC, r.id`);
  res.json({
    sections: SECTIONS.map((s) => ({ key: s.key, levels: ['hidden', ...Object.keys(s.levels)] })),
    items: rows.map((r) => ({
      key: r.key, name_en: r.name_en, name_ckb: r.name_ckb, description: r.description, is_system: r.is_system, is_active: r.is_active,
      user_count: r.user_count, locked: LOCKED_ROLES.includes(r.key), sections: levelsFromPermissions(new Set(r.permissions)),
    })),
  });
}));

const levelEnum = z.enum(['hidden', 'view', 'manage']);
const sectionsSchema = z.record(z.string(), levelEnum);

async function writeSections(c, roleId, levels) {
  let perms;
  try { perms = permissionsFromLevels(levels); } catch (e) { throw badRequest(e.code || 'invalid_level', e.message); }
  await c.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  await c.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2::text[])`, [roleId, perms]);
  // Changes apply immediately: affected users sign in again.
  await c.query('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_id = $1)', [roleId]);
  return perms;
}

router.post('/', ah(async (req, res) => {
  const b = parse(z.object({ name_en: text(60), name_ckb: text(60), description: optText(300), sections: sectionsSchema.default({}) }), req.body);
  const key = `custom_${crypto.randomBytes(4).toString('hex')}`;
  const out = await db.tx(async (c) => {
    const r = await c.query(`INSERT INTO roles (key, name_en, name_ckb, description, is_privileged, is_system) VALUES ($1,$2,$3,$4,false,false) RETURNING id`,
      [key, b.name_en, b.name_ckb, b.description]);
    const perms = await writeSections(c, r.rows[0].id, b.sections);
    await audit(req, 'role.create', { entityType: 'role', entityId: key, details: { ...b, permissions: perms }, client: c });
    return { key };
  });
  res.status(201).json(out);
}));

router.put('/:key', ah(async (req, res) => {
  const key = parse(keyParam, req.params.key);
  const b = parse(z.object({ name_en: text(60), name_ckb: text(60), description: optText(300), sections: sectionsSchema }), req.body);
  await db.tx(async (c) => {
    const role = await loadRole(c, key);
    if (LOCKED_ROLES.includes(key)) throw badRequest('role_locked');
    await c.query('UPDATE roles SET name_en=$2, name_ckb=$3, description=$4 WHERE id=$1', [role.id, b.name_en, b.name_ckb, b.description]);
    const perms = await writeSections(c, role.id, b.sections);
    await audit(req, 'role.update', { entityType: 'role', entityId: key, details: { sections: b.sections, permissions: perms }, client: c });
  });
  res.json({ ok: true });
}));

router.post('/:key/status', ah(async (req, res) => {
  const key = parse(keyParam, req.params.key);
  const b = parse(z.object({ active: z.boolean() }), req.body);
  await db.tx(async (c) => {
    const role = await loadRole(c, key);
    if (key === 'super_admin') throw badRequest('role_locked');
    await c.query('UPDATE roles SET is_active = $2 WHERE id = $1', [role.id, b.active]);
    if (!b.active) await c.query('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_id = $1)', [role.id]);
    await audit(req, b.active ? 'role.activate' : 'role.suspend', { entityType: 'role', entityId: key, client: c });
  });
  res.json({ ok: true });
}));

router.delete('/:key', ah(async (req, res) => {
  const key = parse(keyParam, req.params.key);
  await db.tx(async (c) => {
    const role = await loadRole(c, key);
    if (role.is_system) throw badRequest('cannot_delete_builtin_role');
    const n = (await c.query('SELECT count(*)::int n FROM user_roles WHERE role_id = $1', [role.id])).rows[0].n;
    if (n > 0) throw conflict('role_has_users', 'Move its users to another account type first');
    await c.query('DELETE FROM roles WHERE id = $1', [role.id]);
    await audit(req, 'role.delete', { entityType: 'role', entityId: key, details: { name_en: role.name_en }, client: c });
  });
  res.json({ ok: true });
}));

module.exports = router;
