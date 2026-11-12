'use strict';
const db = require('../lib/db');
const config = require('../lib/config');
const { sha256, randomToken, safeEqual } = require('../lib/crypto');
const { getSettings } = require('../lib/settings');
const { unauthorized, forbidden } = require('../lib/errors');

const COOKIE = config.cookieSecure ? '__Host-dps_sid' : 'dps_sid';

function cookieOptions(maxAgeMs) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/', maxAge: maxAgeMs };
}

async function loadUserAuthz(userId) {
  const { rows } = await db.query(
    `SELECT r.key AS role, p.key AS perm
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1`, [userId]);
  const roles = [...new Set(rows.map((r) => r.role))];
  const permissions = new Set(rows.map((r) => r.perm).filter(Boolean));
  return { roles, permissions };
}

/** Create a new session (always a fresh id → prevents session fixation). */
async function createSession(res, req, userId, mfaState, client = db) {
  const s = (await getSettings()).security;
  const token = randomToken(32);
  const csrf = randomToken(24);
  const absMs = s.session_absolute_hours * 3600_000;
  await client.query(
    `INSERT INTO sessions (id, user_id, csrf_token, mfa_state, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' milliseconds')::interval, $6, $7)`,
    [sha256(token), userId, csrf, mfaState, String(absMs), req.ip, String(req.get('user-agent') || '').slice(0, 300)]);
  res.cookie(COOKIE, token, cookieOptions(absMs));
  return { csrf };
}

async function destroySession(req, res, { clearCookie = true } = {}) {
  const token = req.cookies?.[COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
  if (clearCookie) res.clearCookie(COOKIE, { path: '/', secure: config.cookieSecure, sameSite: 'strict', httpOnly: true });
}

async function loadSession(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token || token.length > 100) return next();
    const s = (await getSettings()).security;
    const { rows } = await db.query(
      `SELECT s.id AS sid, s.csrf_token, s.mfa_state, s.last_seen_at, s.created_at AS session_created,
              u.id, u.username, u.full_name, u.must_change_password, u.mfa_enabled, u.preferred_lang,
              u.password_changed_at, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now()
          AND s.last_seen_at > now() - ($2 || ' minutes')::interval
          AND u.status = 'active' AND u.deleted_at IS NULL`,
      [sha256(token), String(s.session_idle_minutes)]);
    if (!rows.length) return next();
    const row = rows[0];
    const authz = await loadUserAuthz(row.id);
    req.session = { id: row.sid, csrf: row.csrf_token, mfaState: row.mfa_state };
    req.user = {
      id: row.id, username: row.username, full_name: row.full_name, email: row.email,
      must_change_password: row.must_change_password, mfa_enabled: row.mfa_enabled,
      preferred_lang: row.preferred_lang, roles: authz.roles, permissions: authz.permissions,
    };
    // Sliding idle timeout; throttle writes to once per minute.
    if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
      db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.sid]).catch(() => {});
    }
    next();
  } catch (err) { next(err); }
}

const MFA_ALLOWED = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/mfa/verify', '/api/auth/mfa/setup', '/api/auth/mfa/enable']);
const PW_ALLOWED = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/password']);

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  const path = req.baseUrl + req.path;
  if (req.session.mfaState === 'pending_verify' || req.session.mfaState === 'pending_enroll') {
    if (!MFA_ALLOWED.has(path)) return next(forbidden(req.session.mfaState === 'pending_verify' ? 'mfa_required' : 'mfa_enrollment_required'));
  } else if (req.user.must_change_password && !PW_ALLOWED.has(path)) {
    return next(forbidden('password_change_required'));
  }
  next();
}

/** Require at least one of the listed permissions. Enforced server-side on every route. */
function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (perms.some((p) => req.user.permissions.has(p))) return next();
    next(forbidden());
  };
}

/** CSRF: synchronizer token (header) + Origin check for every state-changing request. */
function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const allowed = config.publicOrigin ? [config.publicOrigin] : [`${req.protocol}://${req.get('host')}`];
    if (!allowed.includes(origin)) return next(forbidden('bad_origin'));
  }
  if (!req.session) return next(); // unauthenticated endpoints (login/reset) rely on SameSite + Origin
  const header = req.get('x-csrf-token');
  if (!header || !safeEqual(header, req.session.csrf)) return next(forbidden('csrf_failed'));
  next();
}

const has = (req, p) => req.user?.permissions.has(p);

module.exports = { COOKIE, createSession, destroySession, loadSession, requireAuth, requirePerm, csrfProtection, has, loadUserAuthz };
