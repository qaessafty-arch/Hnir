'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const totp = require('../lib/totp');
const db = require('../lib/db');
const config = require('../lib/config');
const { z, parse } = require('../lib/validate');
const { ah, unauthorized, badRequest, forbidden } = require('../lib/errors');
const { encrypt, decrypt, sha256, normalizeLoginCode, loginCodeHash } = require('../lib/crypto');
const { audit } = require('../lib/audit');
const { getSettings } = require('../lib/settings');
const { createSession, destroySession, requireAuth, loadUserAuthz } = require('../middleware/auth');

const router = express.Router();

// Sign-in is by code only: students type their student ID (DAR + 4 random digits), staff a 4-digit code.
const limitHandler = (_req, res) => res.status(429).json({ error: { code: 'too_many_attempts' } });
const skipInTest = () => config.isTest && process.env.TEST_RATE_LIMIT !== '1';
// Codes are only 4 digits, so wrong attempts are limited tightly per address (successful sign-ins do not
// count, so a whole school behind one NAT address is not blocked by normal use).
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.loginFailLimit, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip), handler: limitHandler, skip: skipInTest,
  skipSuccessfulRequests: true,
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
const DIGITS = /^\d{4}$/;

async function findStudent(studentNo) {
  const { rows } = await db.query(
    `SELECT u.id, u.status, u.mfa_enabled FROM users u
      WHERE u.username = $1 AND u.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = 'student')
        AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key <> 'student')`,
    [studentNo]);
  return rows[0];
}

router.post('/login', loginLimiter, ah(async (req, res) => {
  const body = parse(z.object({ code: z.string().trim().min(1).max(100) }), req.body);
  const code = normalizeLoginCode(body.code);
  // Everyone types DAR + 4 digits (students: their ID; staff: their personal code). "4821" alone also works.
  // Students and staff share one 4-digit space (see lib/accounts.freeFourDigits), so a number never matches both.
  const sid = STUDENT_ID.exec(code);
  let rows = [];
  let kind = 'code';
  if (sid || DIGITS.test(code)) {
    const digits = sid ? sid[1].padStart(4, '0') : code;
    const st = await findStudent(`DAR-${digits}`);
    if (st) { rows = [st]; kind = 'student_id'; }
  }
  if (!rows.length) {
    const staffCode = sid && sid[1].length <= 4 ? sid[1].padStart(4, '0') : code;
    ({ rows } = await db.query(
      'SELECT id, status, mfa_enabled FROM users WHERE login_code_hash = $1 AND deleted_at IS NULL', [loginCodeHash(staffCode)]));
  }
  const u = rows[0];
  if (!u || u.status !== 'active') {
    await audit(req, 'auth.login_failed', { entityType: 'user', entityId: u?.id, details: { kind, reason: u ? 'disabled' : 'unknown_code' } });
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
  await audit(req, 'auth.login', { entityType: 'user', entityId: u.id, actorId: u.id, details: { mfaState, kind } });
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
