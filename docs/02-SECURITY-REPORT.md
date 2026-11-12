# 2. Security report

This report covers the controls implemented in the rebuilt system and how each was verified. Findings in the *original* system are listed in [01-ORIGINAL-SYSTEM-AUDIT.md](01-ORIGINAL-SYSTEM-AUDIT.md) (S1–S10).

Status meanings:
- ✅ implemented and tested
- 🟡 implemented, verified by code review or manual check only
- ⬜ recommendation / not done

## 2.1 Threat model (short)

| Asset | Threat | Main controls |
|---|---|---|
| Student grades and personal data | A student viewing other students; a teacher viewing other classes | Object-level authorization on every read (`lib/access.js`); a 404 response for both not-found and not-allowed, so IDs cannot be enumerated |
| Grade integrity | Unauthorised or silent changes; lost updates | RBAC, workflow states, optimistic locking, history tables, append-only audit log |
| Staff accounts | Credential stuffing or guessing | argon2id, lockout, rate limits, TOTP MFA for privileged roles |
| Sessions | Theft, fixation, CSRF | HttpOnly + SameSite=Strict cookie, `__Host-` prefix and `Secure` in production, rotation on login / MFA / password change, CSRF token + Origin check |
| Server | Injection, malicious uploads | Parameterised SQL only, zod validation, magic-byte upload check, strict CSP |

## 2.2 Controls

| # | Control | Implementation | Status | Evidence |
|---|---|---|---|---|
| 1 | Password hashing | argon2id (m=19 MiB, t=2, p=1, OWASP baseline), `server/src/lib/passwords.js` | ✅ | test "passwords are stored as argon2id hashes" |
| 2 | Password policy | ≥10 characters with letters and digits, max 128, must not contain the username, small common-password list, must differ from the current password | ✅ | forced-change test |
| 3 | No default credentials | First admin created by CLI with a random one-time password; every created account must change its password at first login | ✅ | `scripts/bootstrap-admin.js` |
| 4 | Timing-safe login | A dummy argon2 verify runs for unknown users; identical error for unknown user and wrong password | ✅ | test "rejects wrong password…, no user enumeration" |
| 5 | Account lockout | `max_failed_logins` (default 5) gives a `lockout_minutes` (15) lock. Stored in the DB, so it applies across processes | ✅ | lockout test |
| 6 | Rate limiting | Login: 10 per 15 min per IP+username, and `LOGIN_RATE_LIMIT` (300) per IP. MFA: 10 per 15 min per session | ✅ | rate-limit test. Memory store is per process (see 2.4) |
| 7 | Sessions | 256-bit random token; only its SHA-256 is stored server-side; idle timeout 30 min, absolute 12 h (both configurable); purge job every 30 min | ✅ | logout test |
| 8 | Cookie flags | `HttpOnly; SameSite=Strict; Path=/`. In production `Secure` and the `__Host-` prefix | ✅ | cookie test |
| 9 | Session rotation | A new session ID on login, MFA verification, MFA enrolment and password change; all sessions revoked on password change/reset, role change, disable or archive | ✅ | tests |
| 10 | MFA | TOTP (RFC 6238, otplib). Required for roles configured in Settings (default super_admin + principal; super_admin cannot be removed). Secret encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`) | ✅ | MFA test |
| 11 | Password recovery | An administrator issues a one-time reset code (SHA-256 stored, 24 h expiry, single use, previous codes invalidated). Self-service email reset is **not** built because no mail service is configured | ✅ / ⬜ email | reset test |
| 12 | CSRF | Synchronizer token (`X-CSRF-Token`, kept in memory only) on every non-GET request, plus an `Origin` check, plus SameSite=Strict | ✅ | CSRF test (missing token, forged Origin) |
| 13 | XSS | React auto-escaping, no `dangerouslySetInnerHTML`, CSP `script-src 'self'`, no inline scripts, `object-src 'none'`, `frame-ancestors 'none'` | ✅ | XSS test; Playwright run found no CSP violations (the build sets `assetsInlineLimit: 0` so fonts are not `data:` URIs) |
| 14 | SQL injection | Only parameterised queries. Sort columns come from server-side allow-lists. `LIKE` wildcards are escaped | ✅ | SQLi test |
| 15 | IDOR / BOLA | `assertCanViewStudent` and `assertAssessmentAccess` run on every object route; teachers are limited to their own section+subject, students to themselves | ✅ | IDOR tests (report, profile, photo, CSV for each other ID) |
| 16 | Least privilege | Permission-based RBAC (25 permissions, 7 roles). Principals cannot grant or modify super-admin/principal accounts. Teachers cannot approve their own sheets. Auditors are read-only | ✅ | authorization tests |
| 17 | Server-side validation | zod schemas on every body and query; DB `CHECK` / `UNIQUE` / FK constraints as a second layer | ✅ | validation tests |
| 18 | File uploads | 2 MB limit, magic-byte allow-list (JPEG/PNG/WebP), random name, stored outside the web root, served via an authorized route with `nosniff` and `Content-Disposition: inline` | ✅ | upload tests |
| 19 | CSV export safety | Formula-injection neutralisation (`'` prefix), UTF-8 BOM; every export is written to the audit log | ✅ | CSV test |
| 20 | Security headers | helmet: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: same-origin`, HSTS (production), `Permissions-Policy`; `Cache-Control: no-store` on all API responses | ✅ | curl check |
| 21 | Error handling | No stack traces or SQL in responses; a request ID is returned for 500s; pool exhaustion gives 503 with `Retry-After`; lock timeouts give 409 `sheet_busy` | ✅ | load test phase D |
| 22 | Logging | pino JSON logs with request IDs; cookies, CSRF headers and passwords are redacted | 🟡 | code review |
| 23 | Audit log | Every login, failed login, data change, workflow step, export and settings change goes to `audit_logs`. A DB trigger blocks UPDATE/DELETE | ✅ | audit tests |
| 24 | Encrypted backups | `ops/backup.sh`: `pg_dump` + uploads, AES-256 with PBKDF2 (600k iterations), SHA-256 checksum, retention | ✅ | restore test (see testing report) |
| 25 | HTTPS | Terminated at nginx (`ops/nginx.conf.example`); the app sets HSTS and Secure cookies in production | 🟡 | config provided; not run here (no public host) |
| 26 | Dependency scanning | `npm audit` run on server and client: **0 vulnerabilities** at delivery. `file-type` was removed (it had an advisory) in favour of a 15-line magic-byte check; react-router was upgraded to 7.18.5 to fix 2 advisories | ✅ | `npm audit` |
| 27 | Secrets | All secrets come from the environment (`.env.example`); `.env` is git-ignored; nothing secret ships to the client | ✅ | code review |

## 2.3 Role and permission matrix

✔ = permitted. All checks are enforced by the server (`requirePerm` + object-level checks), not only by hiding buttons.

| Permission | Super Admin | Principal | Registrar | Teacher | Student | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| system.settings (grading & security policy) | ✔ | | | | | |
| roles.manage (assign admin roles) | ✔ | | | | | |
| users.manage (staff accounts) | ✔ | ✔¹ | | | | |
| academic.manage (years, terms, sections, subjects) | ✔ | ✔ | | | | |
| backups.manage (view backup status) | ✔ | | | | | |
| dashboard.school | ✔ | ✔ | ✔ | | | ✔ |
| students.read | ✔ | ✔ | ✔ | | | ✔ |
| students.write / archive / import | ✔ | ✔ | ✔ | | | |
| teachers.read | ✔ | ✔ | ✔ | | | ✔ |
| teachers.write, assignments.manage | ✔ | ✔ | | | | |
| grades.enter (own section+subject only) | | | | ✔ | | |
| grades.manage_all (any sheet before publication) | ✔ | ✔ | | | | |
| grades.read_all | ✔ | ✔ | | | | ✔ |
| grades.approve / publish | ✔ | ✔ | | | | |
| grades.correct (published, reason required) | ✔ | ✔ | | | | |
| reports.school | ✔ | ✔ | | | | ✔ |
| reports.class (own classes, own subjects) | | | | ✔ | | |
| exports.csv | ✔ | ✔ | ✔ | (own classes) | own report | |
| audit.read | ✔ | ✔ | | | | ✔ |
| self.grades (own published grades) | | | | | ✔ | |

¹ Principals cannot create, modify, disable or reset super-admin or principal accounts.

**Configurable account types:** the super administrator can change which sections each account type may use (`/api/roles`, permission `roles.manage`). Sections translate to permissions in `server/src/lib/sections.js`; `system.settings`, `roles.manage` and `backups.manage` are never grantable; the super_admin and student types are locked. Changing or suspending a type ends its users' sessions immediately; users whose types are all suspended cannot sign in (`account_type_suspended`). All changes are audited. Tested in `api.test.js` › *account types managed by the super administrator*. The matrix below is the **default** configuration.

**Weekly card & behavior:** `/api/weekly/students/:id` uses the same object-level check as report cards (students: own, published only; teachers: their subjects). `/api/behavior` is limited to `grades.manage_all` or the homeroom teacher of the section; students outside the section are rejected; drafts are invisible to students; changes are written to `behavior_history` and the audit log.

**Removed:** the Parent/Guardian role (and its tables) was removed at the school's request (migration `003_remove_parent_role.sql`). Former parent-only accounts are disabled and soft-deleted, kept for audit history.

## 2.4 Known limitations and recommendations (not done)

| # | Item | Risk | Recommendation |
|---|---|---|---|
| L1 | The rate-limit store is in memory per process. With `WEB_CONCURRENCY=4` the effective per-IP limit is up to 4×. Account lockout is DB-backed and is not affected | Low | Use a shared store (Redis via `rate-limit-redis`) for multi-server deployments |
| L2 | No self-service "forgot password" email | Low (an admin reset exists) | Add SMTP and an email-verified reset flow |
| L3 | No MFA recovery codes; a lost device needs an admin `MFA reset` | Low | Add one-time recovery codes |
| L4 | Upload malware scanning is not performed (only images are accepted and re-encoded client-side, but the server stores the bytes it receives) | Low | Re-encode on the server (e.g. `sharp`) or add ClamAV |
| L5 | No external penetration test; testing was automated plus a self-review | — | Commission an independent test before go-live |
| L6 | Database encryption at rest depends on the hosting disk | — | Use an encrypted volume / managed PostgreSQL with encryption at rest |
| L7 | TLS / HSTS behaviour was not exercised end-to-end (no domain in this environment) | — | Run SSL Labs and securityheaders.com after deployment |
