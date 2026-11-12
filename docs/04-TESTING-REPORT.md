# 4. Testing report

Environment: Linux, 4 vCPU, 15 GB RAM, Node.js 22.23, PostgreSQL 16.15, Chromium (Playwright). Date: 2026-11-12.
The application, database and load generator all ran **on the same machine**, so the load figures are conservative: the load generator competed with the server for CPU.

## 4.1 Summary

| Suite | Command | Result |
|---|---|---|
| Unit: grading engine | `npm test --prefix server` (`test/grading.test.js`) | **7 / 7 pass** |
| Integration: API + security against real PostgreSQL | `npm test --prefix server` (`test/api.test.js`) | **33 / 33 pass** |
| Browser end-to-end (roles × languages × viewports) | `node e2e/smoke.js` | **Pass**: 0 console errors, 0 CSP violations, 0 5xx, 0 horizontal overflow on 40+ screens |
| Backup → restore | `ops/backup.sh` + `ops/restore.sh` | **Pass**: row counts identical, uploads restored, wrong passphrase rejected |
| Legacy data import | `scripts/import-legacy.js` (dry run, real run, re-run) | **Pass**: names split, photos imported, notes kept, invalid grade reported, re-run idempotent |
| Load (1,000 users) | `node ops/loadtest.js` | **Pass**: 0 errors / 0 5xx, see 4.4 |
| Dependency audit | `npm audit` (server, client) | **0 vulnerabilities** |

Total automated tests: **40 passed, 0 failed.**

## 4.2 Integration and security tests (`server/test/api.test.js`)

Each run builds a fresh schema via the migrations, then a fixture school: 1 year, 2 sections, 2 teachers, 4 students, 1 parent with one verified and one **unverified** link, and admin roles.

| Area | Test | Result |
|---|---|---|
| Authentication | Wrong password and unknown user give identical 401 bodies (no enumeration) | Pass |
| | Cookie is HttpOnly + SameSite=Strict; a new session ID on every login | Pass |
| | Passwords stored as `$argon2id$` | Pass |
| | 5 failed attempts give 423 locked, even with the right password | Pass |
| | Missing CSRF token → 403; forged `Origin` → 403; valid → 200 | Pass |
| | Logout invalidates the session server-side (old cookie replay → 401) | Pass |
| | Forced password change blocks other APIs; policy enforced; sessions rotated | Pass |
| | MFA: enrolment required for super_admin; bad code rejected; secret encrypted at rest; code required at next login | Pass |
| | Admin reset code works once, then is rejected | Pass |
| | Rate limit: 12 attempts on one account → 429; another account from the same IP not blocked | Pass |
| Authorization / isolation | Unauthenticated → 401 on data routes | Pass |
| | Student sees **only published** grades of themself | Pass |
| | **IDOR:** student requesting each other student's report, profile, photo and CSV by changing the ID → 404 every time; staff list endpoints → 403 | Pass |
| | Parent: only the verified child; unverified link and unrelated students → 404 | Pass |
| | Teacher: cannot read or write another teacher's sheet, cannot create sheets for an unassigned subject, sees only own sheets, report scoped to own subjects | Pass |
| | Teacher cannot grade a student outside the section | Pass |
| | Auditor: read OK; every write → 403/404 | Pass |
| | Principal cannot create or disable super admins; registrar cannot manage users or settings | Pass |
| Grades | Out-of-range / non-numeric / blank / `1e400` scores → 400, and **nothing** saved (transaction) | Pass |
| | Duplicate (assessment, student) rejected by the DB | Pass |
| | **Concurrent edit**: two users save the same row with the same version → exactly one 200 and one 409; version incremented once; one history row | Pass |
| | A "new" row for a student someone already graded → 409, not an overwrite | Pass |
| | Blank score never silently deletes | Pass |
| | Cannot submit with ungraded students; explicit excused/missing allowed | Pass |
| | Submitted sheet locked for the teacher | Pass |
| | Teacher cannot approve; principal approves and publishes; student sees it and is notified | Pass |
| | Correction after publication requires a reason, is recorded in history + approvals; teacher cannot correct | Pass |
| Injection / uploads | SQLi payloads in search are treated as data; unknown sort → 400; table intact | Pass |
| | Stored XSS payload returned as inert JSON; CSV formula prefixed with `'` | Pass |
| | Upload: HTML disguised as PNG rejected; SVG rejected; 3 MB → 413; `../../etc/passwd.png` stored under a random name; photo visible to its owner, 404 to other students | Pass |
| | `UPDATE`/`DELETE` on `audit_logs` raise an exception | Pass |
| | Invalid settings rejected; super_admin MFA requirement cannot be removed | Pass |
| Bulk import | Preview reports per-row errors; commit with errors imports nothing; valid commit creates accounts with one-time passwords | Pass |

## 4.3 Browser end-to-end (`e2e/smoke.js`)

Roles: principal, super admin, teacher, student, parent. Languages: Kurdish (RTL) and English (LTR). Viewports: 1366×860 desktop, 820×1180 tablet, 390×844 phone.

Checks on every screen: no console errors, no uncaught exceptions, no 5xx responses, no horizontal page overflow. A full-page screenshot is saved for review.
Teacher flow: open a class → create a sheet → enter `9.5`, `11` (over max) and `٧` (Eastern Arabic 7) → inline error shown for 11 → fix → save draft → toast.
Print flow: student report card rendered with print media and exported to A4 PDF (`docs/screenshots/report-card-print-sample.pdf`).

**Defects this suite found and that were fixed:**
1. The CSP blocked Vite-inlined `data:` fonts. Fixed by disabling inlining, not by loosening the CSP.
2. `can is not defined` on the admin dashboard.
3. The mobile drawer caused 323 px horizontal overflow in RTL. Fixed by changing it from translate to display toggling.
4. Visually-hidden table header text escaped its scroll container in RTL. Fixed by making `.table-wrap` the containing block.
5. The hamburger button showed on desktop (CSS specificity).
6. "Session expired" was shown on the first visit to the login page.
7. Year ranges were reversed in RTL ("2027-2026").
8. Browser date formatting silently fell back to English for Kurdish.
9. Login rate limiting keyed on IP alone would lock a whole school behind one NAT address. Changed to IP+username plus a high per-IP ceiling.

## 4.4 Load and concurrency test (`ops/loadtest.js`)

Dataset: **1,011 accounts** (1,000 students, 6 teachers, 4 staff, 1 parent), 8 sections, 13 subjects, 208 published sheets, **26,000 grade records**. Each phase lasted 30 s.

| Phase | Scenario | Single process (`WEB_CONCURRENCY=1`) | 4 workers (`WEB_CONCURRENCY=4`) |
|---|---|---|---|
| A | 1,000 distinct students sign in (25 concurrent, argon2id) | 120 logins/s · p50 191 ms · p99 341 ms | 96/s · p50 220 ms · p99 726 ms ¹ |
| B | **200 concurrent signed-in students** each loading their own report card (heaviest read: grading engine + audit insert) | 2,551 req/s · p50 74 ms · p99 132 ms · **0 errors** | 7,173 req/s · p50 24 ms · p99 67 ms · **0 errors** |
| C | 50 concurrent staff connections: dashboard, grade overview search, student search, class report | 156 req/s · p50 316 ms · p99 588 ms · 0 errors | 183 req/s · p50 260 ms · p99 602 ms · 0 errors |
| D | **48 concurrent writers** (6 teachers × 8 parallel) repeatedly saving 25 grades on the **same 6 sheets**, the worst-case conflict scenario | 703 saves OK + 2,778 conflicts (409) · 0 other statuses · p50 117 ms | 1,130 saves + 6,575 conflicts (409) · 0 other · p50 111 ms |

¹ Login throughput is bounded by deliberate argon2id cost on 4 shared vCPUs. The load generator competed for CPU in the 4-worker run.

**Write integrity after phase D** (SQL check on the stressed sheets): 150 grade records, 27,010 applied updates, and **0 records** whose `version` ≠ 1 + its number of history rows. There were no lost updates and no unrecorded changes.

**A defect found by this test and fixed:** the first phase-D run exhausted the 20-connection DB pool (writers waited on the sheet row lock while holding connections), and other requests failed with 500. Fixes:
- Grade saves now use 3–4 set-based statements instead of 2 per student, so the lock is held for milliseconds.
- `lock_timeout = 3s` → 409 `sheet_busy`.
- Pool exhaustion → 503 + `Retry-After`.

After the fix there were 0 errors. The p99 of ~3 s in phase D is the lock timeout under the artificial 8-writers-per-sheet contention; in practice one teacher edits one sheet.

**What this does and does not show:**
- Shown: 1,000 registered users; 200 simultaneous active student sessions with sub-150 ms p99; 48 simultaneous grade writers with no data loss.
- **Not shown:** 1,000 users *all active at the same instant*. That was not tested as a single phase, and this report does not claim it. A real school day (1,000 students signing in over minutes, a few dozen staff) is well inside the measured capacity.
- Not tested: multi-server deployment, network latency, or production hardware.

## 4.5 Backup and restore test

1. `ops/backup.sh` against the dev DB (122 students, 3,144 grades) produced an encrypted file (`*.tar.enc`, 235 KB) plus a SHA-256 checksum.
2. `ops/restore.sh` into an empty database: the checksum verified, and the result was **122 students, 3,144 grade records, 169 audit rows**, identical to the source. Uploaded photos were restored.
3. A restore with the wrong passphrase failed with `bad decrypt` (no partial restore).

## 4.6 Not tested / gaps

- Formal accessibility audit (screen reader, axe-core).
- TLS/HSTS in a real deployment; nginx and systemd configs are provided but were not executed here.
- Email-based flows (none exist).
- Cross-browser runs beyond Chromium (Firefox/Safari RTL rendering should be spot-checked).
- Multi-instance rate limiting (see Security L1).
