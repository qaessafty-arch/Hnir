'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const totp = require('../lib/totp');
const db = require('../lib/db');
const config = require('../lib/config');
const { z, parse } = require('../lib/validate');
const { ah, unauthorized, badRequest, forbidden } = require('../lib/errors');
const { encrypt, decrypt, sha256, normalizeLoginCode } = require('../lib/crypto');
const { audit } = require('../lib/audit');
const { getSettings } = require('../lib/settings');
const { createSession, destroySession, requireAuth, loadUserAuthz } = require('../middleware/auth');

const router = express.Router();

// Sign-in is by code only. Students type their student ID; staff type a secret 10-character code
// (50 bits, so guessing is not feasible). A per-IP ceiling slows bulk probing; it stays generous because
// a whole school can sit behind one NAT address.
const limitHandler = (_req, res) => res.status(429).json({ error: { code: 'too_many_attempts' } });
const skipInTest = () => config.isTest && process.env.TEST_RATE_LIMIT !== '1';
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.loginRateLimit, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip), handler: limitHandler, skip: skipInTest,
});
const mfaLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `mfa:${req.session?.id || rateLimit.ipKeyGenerator(req.ip)}`,
  handler: (_req, res) => res.status(429).json({ error: { code: 'too_many_attempts' } }),
  skip: () => config.isTest,
});

function publicUser(req) {
  const u = req.user;
  return {
    id: u.id, username: u.username, full_name: u.full_name, email: u.email, roles: u.roles,
    permissions: [...u.permissions].sort(), must_change_password: u.must_change_password,
    mfa_enabled: u.mfa_enabled, preferred_lang: u.preferred_lang,
  };
}

const STUDENT_ID = /^DAR(\d{1,6})$/;

router.post('/login', loginLimiter, ah(async (req, res) => {
  const body = parse(z.object({ code: z.string().trim().min(1).max(100) }), req.body);
  const code = normalizeLoginCode(body.code);
  const sid = STUDENT_ID.exec(code);
  let rows;
  if (sid) {
    // Student ID: only accounts whose every role is "student" may sign in this way.
    const studentNo = `DAR-${sid[1].padStart(4, '0')}`;
    ({ rows } = await db.query(
      `SELECT u.id, u.status, u.mfa_enabled FROM users u
        WHERE u.username = $1 AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = 'student')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key <> 'student')`,
      [studentNo]));
  } else {
    ({ rows } = await db.query(
      'SELECT id, status, mfa_enabled FROM users WHERE login_code_hash = $1 AND deleted_at IS NULL', [sha256(code)]));
  }
  const u = rows[0];
  if (!u || u.status !== 'active') {
    await audit(req, 'auth.login_failed', { entityType: 'user', entityId: u?.id, details: { kind: sid ? 'student_id' : 'code', reason: u ? 'disabled' : 'unknown_code' } });
    throw unauthorized('unknown_login_code');
  }
  const sec = (await getSettings()).security;
  const { roles } = await loadUserAuthz(u.id);
  if (roles.length === 0) {
    await audit(req, 'auth.login_blocked_suspended_type', { entityType: 'user', entityId: u.id, actorId: u.id });
    return res.status(403).json({ error: { code: 'account_type_suspended' } });
  }
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, must_change_password = false, last_login_at = now() WHERE id = $1', [u.id]);
  const mfaRequired = roles.some((r) => sec.mfa_required_roles.includes(r));
  const mfaState = u.mfa_enabled ? 'pending_verify' : mfaRequired ? 'pending_enroll' : 'none';
  await destroySession(req, res, { clearCookie: false }); // revoke any previous session; new cookie replaces it
  await createSession(res, req, u.id, mfaState);
  await audit(req, 'auth.login', { entityType: 'user', entityId: u.id, actorId: u.id, details: { mfaState, kind: sid ? 'student_id' : 'code' } });
  res.json({ ok: true, mfa: mfaState });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.user) await audit(req, 'auth.logout', { entityType: 'user', entityId: req.user.id });
  await destroySession(req, res);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  const names = await db.query('SELECT key, name_en, name_ckb FROM roles WHERE key = ANY($1::text[])', [req.user.roles]);
  res.json({ user: { ...publicUser(req), role_names: names.rows }, csrfToken: req.session.csrf, mfaState: req.session.mfaState });
}));

router.patch('/me', requireAuth, ah(async (req, res) => {
  const b = parse(z.object({ preferred_lang: z.enum(['ckb', 'en']) }), req.body);
  await db.query('UPDATE users SET preferred_lang = $2, updated_at = now() WHERE id = $1', [req.user.id, b.preferred_lang]);
  res.json({ ok: true });
}));

// ---- MFA (TOTP) ----
router.post('/mfa/setup', requireAuth, mfaLimiter, ah(async (req, res) => {
  if (req.user.mfa_enabled) throw badRequest('mfa_already_enabled');
  const secret = totp.generateSecret();
  await db.query('UPDATE users SET mfa_secret_enc = $2 WHERE id = $1', [req.user.id, encrypt(secret)]);
  const uri = totp.keyUri({ issuer: 'Darwaza School', label: req.user.username, secret });
  res.json({ secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
}));

async function checkTotp(userId, token) {
  const { rows } = await db.query('SELECT mfa_secret_enc FROM users WHERE id = $1', [userId]);
  if (!rows[0]?.mfa_secret_enc) return false;
  const secret = decrypt(rows[0].mfa_secret_enc);
  try { return totp.verify(secret, token); } catch { return false; }
}

router.post('/mfa/enable', requireAuth, mfaLimiter, ah(async (req, res) => {
  const b = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  if (req.user.mfa_enabled) throw badRequest('mfa_already_enabled');
  if (!(await checkTotp(req.user.id, b.code))) throw badRequest('invalid_code');
  await db.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user.id]);
  await db.query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
  await createSession(res, req, req.user.id, 'verified');
  await audit(req, 'auth.mfa_enabled', { entityType: 'user', entityId: req.user.id });
  res.json({ ok: true });
}));

router.post('/mfa/verify', requireAuth, mfaLimiter, ah(async (req, res) => {
  const b = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  if (req.session.mfaState !== 'pending_verify') throw forbidden('mfa_not_pending');
  if (!(await checkTotp(req.user.id, b.code))) {
    await audit(req, 'auth.mfa_failed', { entityType: 'user', entityId: req.user.id });
    throw badRequest('invalid_code');
  }
  await db.query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
  await createSession(res, req, req.user.id, 'verified');
  await audit(req, 'auth.mfa_verified', { entityType: 'user', entityId: req.user.id });
  res.json({ ok: true });
}));

module.exports = router;
