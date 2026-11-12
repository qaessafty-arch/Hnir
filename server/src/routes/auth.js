'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const totp = require('../lib/totp');
const db = require('../lib/db');
const config = require('../lib/config');
const { z, parse } = require('../lib/validate');
const { ah, unauthorized, badRequest, forbidden } = require('../lib/errors');
const { hashPassword, verifyPassword, dummyVerify, passwordPolicyError } = require('../lib/passwords');
const { encrypt, decrypt, sha256 } = require('../lib/crypto');
const { audit } = require('../lib/audit');
const { getSettings } = require('../lib/settings');
const { createSession, destroySession, requireAuth, loadUserAuthz } = require('../middleware/auth');

const router = express.Router();

// Two layers: per IP+username (stops guessing one account) and a generous per-IP ceiling
// (a whole school can sit behind one NAT address, so the IP limit must not block normal use).
// Per-account lockout (users.failed_login_count) is the third layer and is shared across all instances.
const limitHandler = (_req, res) => res.status(429).json({ error: { code: 'too_many_attempts' } });
const skipInTest = () => config.isTest && process.env.TEST_RATE_LIMIT !== '1';
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${rateLimit.ipKeyGenerator(req.ip)}|${String(req.body?.username || '').toLowerCase().slice(0, 100)}`,
  handler: limitHandler, skip: skipInTest,
});
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.loginRateLimit, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip), handler: limitHandler, skip: skipInTest,
});
const loginLimiter = [loginIpLimiter, loginAccountLimiter];
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

router.post('/login', loginLimiter, ah(async (req, res) => {
  const body = parse(z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) }), req.body);
  const sec = (await getSettings()).security;
  const { rows } = await db.query(
    `SELECT id, username, password_hash, status, locked_until, failed_login_count, mfa_enabled
       FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL`, [body.username]);
  const u = rows[0];
  const fail = async (reason) => {
    await audit(req, 'auth.login_failed', { entityType: 'user', entityId: u?.id, details: { username: body.username.slice(0, 100), reason } });
    throw unauthorized('invalid_credentials');
  };
  if (!u) { await dummyVerify(body.password); return fail('unknown_user'); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await dummyVerify(body.password);
    await audit(req, 'auth.login_locked', { entityType: 'user', entityId: u.id });
    return res.status(423).json({ error: { code: 'account_locked' } });
  }
  const ok = await verifyPassword(u.password_hash, body.password);
  if (!ok || u.status !== 'active') {
    if (!ok) {
      await db.query(
        `UPDATE users SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
         WHERE id = $1`, [u.id, sec.max_failed_logins, String(sec.lockout_minutes)]);
    }
    return fail(ok ? 'disabled' : 'bad_password');
  }
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  const { roles } = await loadUserAuthz(u.id);
  const mfaRequired = roles.some((r) => sec.mfa_required_roles.includes(r));
  const mfaState = u.mfa_enabled ? 'pending_verify' : mfaRequired ? 'pending_enroll' : 'none';
  await destroySession(req, res, { clearCookie: false }); // revoke any previous session; new cookie replaces it
  await createSession(res, req, u.id, mfaState);
  await audit(req, 'auth.login', { entityType: 'user', entityId: u.id, actorId: u.id, details: { mfaState } });
  res.json({ ok: true, mfa: mfaState });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.user) await audit(req, 'auth.logout', { entityType: 'user', entityId: req.user.id });
  await destroySession(req, res);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  res.json({ user: publicUser(req), csrfToken: req.session.csrf, mfaState: req.session.mfaState });
}));

router.patch('/me', requireAuth, ah(async (req, res) => {
  const b = parse(z.object({ preferred_lang: z.enum(['ckb', 'en']) }), req.body);
  await db.query('UPDATE users SET preferred_lang = $2, updated_at = now() WHERE id = $1', [req.user.id, b.preferred_lang]);
  res.json({ ok: true });
}));

router.post('/password', requireAuth, ah(async (req, res) => {
  const b = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }), req.body);
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(rows[0].password_hash, b.currentPassword))) throw badRequest('current_password_wrong');
  const pe = passwordPolicyError(b.newPassword, { username: req.user.username });
  if (pe) throw badRequest(pe);
  if (await verifyPassword(rows[0].password_hash, b.newPassword)) throw badRequest('password_reused');
  const hash = await hashPassword(b.newPassword);
  await db.tx(async (c) => {
    await c.query('UPDATE users SET password_hash=$2, must_change_password=false, password_changed_at=now(), updated_at=now() WHERE id=$1', [req.user.id, hash]);
    // Revoke every session (including this one) and issue a new one — session rotation.
    await c.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    await audit(req, 'auth.password_changed', { entityType: 'user', entityId: req.user.id, client: c });
  });
  await createSession(res, req, req.user.id, req.session.mfaState === 'verified' ? 'verified' : 'none');
  res.json({ ok: true });
}));

// ---- Password reset via one-time token (issued by an administrator; see users.js) ----
router.post('/reset-password', loginLimiter, ah(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(20).max(100), newPassword: z.string().min(1).max(200) }), req.body);
  const { rows } = await db.query(
    `SELECT t.id, t.user_id, u.username FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.status = 'active'`, [sha256(b.token)]);
  if (!rows.length) throw badRequest('invalid_or_expired_token');
  const pe = passwordPolicyError(b.newPassword, { username: rows[0].username });
  if (pe) throw badRequest(pe);
  const hash = await hashPassword(b.newPassword);
  await db.tx(async (c) => {
    const upd = await c.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL', [rows[0].id]);
    if (!upd.rowCount) throw badRequest('invalid_or_expired_token');
    await c.query(`UPDATE users SET password_hash=$2, must_change_password=false, failed_login_count=0, locked_until=NULL,
                   password_changed_at=now(), updated_at=now() WHERE id=$1`, [rows[0].user_id, hash]);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].user_id]);
    await audit(req, 'auth.password_reset_completed', { entityType: 'user', entityId: rows[0].user_id, actorId: rows[0].user_id, client: c });
  });
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
