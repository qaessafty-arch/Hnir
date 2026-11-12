# 5. Technical handover — Darwaza School Management System

Contents:
1. Architecture
2. Repository layout
3. Files and components
4. Database schema
5. Grade workflow
6. Concurrency
7. Configuration
8. Deployment
9. Grading policy
10. Backup and recovery
11. Migrating legacy data
12. Operations and monitoring
13. Administrator guide
14. Teacher guide
15. Student and parent guide
16. Completed vs. remaining

Related reports:
- [01 Original system audit](01-ORIGINAL-SYSTEM-AUDIT.md): original architecture and every problem found
- [02 Security report](02-SECURITY-REPORT.md): controls and the **role/permission matrix**
- [03 UI/UX report](03-UI-UX-REPORT.md)
- [04 Testing report](04-TESTING-REPORT.md): every test, load results, known gaps

---

## 1. Architecture

```
 Browser (React SPA, ckb/en)                         Server (Node.js 22, Express)                    PostgreSQL 16
 ┌──────────────────────────┐   HTTPS (nginx TLS)   ┌──────────────────────────────────────┐        ┌──────────────────┐
 │ Login / MFA / portal      │ ───────────────────▶ │ helmet (CSP, HSTS) · pino logs        │  pool  │ 25 tables         │
 │ Admin, teacher, reports   │  HttpOnly cookie     │ session loader → CSRF → requireAuth   │ ─────▶ │ FKs, UNIQUE,       │
 │ No data in localStorage   │  + X-CSRF-Token      │ requirePerm (RBAC) → object checks    │        │ CHECKs, triggers  │
 └──────────────────────────┘                       │ zod validation → SQL (parameterised)  │        └──────────────────┘
                                                     │ grading engine (pure functions)       │        uploads/ (photos)
                                                     └──────────────────────────────────────┘        backups/ (AES-256)
```

- **Choices:** boring, proven technology (Express, `pg`, plain SQL migrations, React with Vite). There is no ORM, so every query is visible and reviewable.
- **One deployable:** the Node server also serves the built client (`client/dist`), so there is no CORS. Optional cluster mode (`WEB_CONCURRENCY`) uses all CPU cores.
- **Stateless app processes:** sessions live in PostgreSQL, so you can run several processes or servers behind a load balancer (see Security L1 about rate-limit stores).

## 2. Repository layout

```
server/                 API, migrations, scripts, tests
  migrations/           001_init.sql (schema), 002_reference_data.sql (roles, permissions, 13 subjects, settings)
  src/app.js            Express app: headers, CSP, routing, error handling
  src/server.js         Startup, migrations, cluster mode, graceful shutdown, session purge
  src/migrate.js        Forward-only migration runner (advisory lock, one transaction per file)
  src/middleware/auth.js  Sessions, CSRF, requireAuth (MFA / forced password change gates), requirePerm
  src/lib/              config, db (pool + tx), grading engine, access (object-level authz), audit, crypto, csv, images, ...
  src/routes/           auth, academic, students, teachers, users, assessments, reports, misc (portal, dashboard, audit, settings, notifications)
  scripts/              bootstrap-admin, seed-demo (refuses in production), import-legacy
  test/                 grading.test.js, api.test.js, helpers.js
client/                 React 19 + Vite SPA
  public/brand/         the official logo + derived sizes/icons
  src/components/       Logo, Layout (sidebar/topbar/notifications), ui (modal, toast, confirm, field, tables, badges)
  src/i18n/             strings.js (ckb + en), provider (dir/lang, formatting)
  src/lib/              api client (CSRF, errors, CSV, image resize), auth context, hooks
  src/pages/            Auth, Dashboard, Students, Import, Grades, Reports, Admin, System
e2e/smoke.js            Playwright browser test
ops/                    backup.sh, restore.sh, loadtest.js, nginx.conf.example, darwaza.service
legacy/original-index.html   the original system, untouched
docs/                   these reports + screenshots
```

## 3. Files and components

| Concern | Files |
|---|---|
| Logo (one reusable component) | `client/src/components/Logo.jsx`, `client/public/brand/*`, `client/index.html` (favicons) |
| Auth / sessions / MFA | `server/src/routes/auth.js`, `server/src/middleware/auth.js`, `server/src/lib/{passwords,crypto}.js`, `client/src/pages/Auth.jsx`, `client/src/lib/auth.jsx` |
| RBAC and object authorization | `migrations/002_reference_data.sql` (matrix), `middleware/auth.js` (`requirePerm`), `lib/access.js` |
| Students and import | `routes/students.js`, `pages/Students.jsx`, `pages/Import.jsx` |
| Grade entry, workflow, corrections | `routes/assessments.js`, `pages/Grades.jsx` |
| Grading engine | `server/src/lib/grading.js` (pure, unit-tested), `lib/reports.js` |
| Reports / exports | `routes/reports.js`, `lib/csv.js`, `pages/Reports.jsx` (report card is print-optimised) |
| Admin: users, teachers, years, sections, subjects, assignments | `routes/{users,teachers,academic}.js`, `pages/Admin.jsx` |
| Audit, settings, notifications, dashboard, portal | `routes/misc.js`, `pages/System.jsx`, `pages/Dashboard.jsx` |
| i18n | `client/src/i18n/*` |
| Styling | `client/src/styles.css` (design tokens, logical properties, print CSS) |

## 4. Database schema

Key relationships:

```
roles ─< role_permissions >─ permissions
users ─< user_roles >─ roles          users ─< sessions          users ─< password_reset_tokens
users ─1:1─ teachers                   users ─1:1─ students (login)  users ─1:1─ parents
parents ─< guardian_student_relationships >─ students   (verified_at, verified_by)
academic_years ─< terms
academic_years ─< sections >─ classes(grade 1–12)        sections.homeroom_teacher_id → teachers
students ─< enrollments >─ sections         UNIQUE(student, academic_year)
teachers ─< teacher_assignments >─ sections, subjects    UNIQUE(teacher, section, subject)
assessments (term, section, subject, category, title, max_score, status, version)   UNIQUE(term, section, subject, title)
assessments ─< grade_records >─ students     UNIQUE(assessment, student) · CHECK score ≥ 0 · CHECK graded ⇔ score NOT NULL
grade_records ─< grade_record_history (old/new score+status, reason, is_correction, changed_by)
assessments ─< grade_approvals (submit/approve/return/publish/unpublish/correct)
audit_logs (append-only trigger) · notifications · system_settings (school, grading, security JSON)
```

- **Duplicate prevention:** one grade per student per assessment, where an assessment is one subject, one period and one section (`UNIQUE` constraints above).
- **Score ≤ max** is enforced in the API (the max lives on the assessment); `score ≥ 0` and status consistency are enforced by `CHECK`.
- **Soft deletion:** students are never deleted (status archived / transferred / graduated + reason); users are disabled; enrollments are withdrawn. Hard deletes are allowed only for empty draft sheets and teacher assignments, and both are audited.
- **Indexes:** every FK used in lookups, `lower(username)`, `lower(email)`, student names, `audit_logs(created_at)`, `(actor, created_at)`, `(entity_type, entity_id)`, and `notifications(user, read_at, created_at)`.
- **Transactions:** every multi-statement change (create student + account + enrollment, bulk grades, workflow transitions, imports, role changes) runs in `db.tx()`, with its audit row written in the same transaction.

## 5. Grade workflow

```
draft ──submit──▶ submitted ──approve──▶ approved ──publish──▶ published
  ▲                  │  ▲                   │                     │
  └───── returned ◀──┘  └──── return ◀──────┘     unpublish ◀─────┘ (back to approved)
         (comment required)                       correct (reason required, stays published)
```

- Teachers edit only in `draft`/`returned`, only while the term's **grade entry is open**, and only for their own section and subject.
- **Submit** requires every active student to have a score or an explicit *missing* / *excused* status.
- Students and parents see **published** sheets only.
- Version checks on every transition prevent acting on a stale view.

## 6. Concurrency

- Each grade row has a `version`. The client sends the version it saw. A mismatch rejects the **whole** batch with 409 and the current values, and the UI highlights those rows and keeps the user's other edits.
- The sheet row is locked `FOR UPDATE` during a save, with `lock_timeout 3s` → 409 `sheet_busy`.
- Writes are set-based (`unnest`), so lock time does not grow with class size.
- Verified under load: 48 parallel writers on 6 sheets produced 0 lost updates (testing report §4.4).

## 7. Configuration

All configuration comes from the environment. See [`server/.env.example`](../server/.env.example).

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` / `test` / `staging` / `production`. Staging and production require all secrets and enable Secure cookies and HSTS |
| `DATABASE_URL`, `DB_POOL_MAX` | PostgreSQL connection (use TLS: `sslmode=require`), pool size per process |
| `APP_ENCRYPTION_KEY` | ≥32 chars, encrypts MFA secrets. **Back it up separately**: losing it invalidates enrolled MFA devices |
| `PUBLIC_ORIGIN` | e.g. `https://grades.darwaza.school`, used by the CSRF Origin check |
| `TRUST_PROXY` | number of proxies in front (1 with nginx) |
| `UPLOAD_DIR`, `BACKUP_DIR` | persistent paths |
| `WEB_CONCURRENCY` | worker processes (≈ CPU cores) |
| `LOGIN_RATE_LIMIT` | per-IP login attempts per 15 min (default 300) |

Policy settings (MFA roles, session timeouts, lockout, grading rules, bands, school name) are edited in **Settings** in the UI and stored in `system_settings`.

**Environments:**
- *development*: local `.env`, demo data via `seed-demo.js`.
- *staging*: a production build with a copy of production data restored from a backup (never demo data in production).
- *production*: a separate database and secrets.

## 8. Deployment (production)

Tested here: build, migrations, server, cluster mode, backup/restore. **Not executed here:** nginx/TLS and systemd (examples are provided).

```bash
# 1. Server prerequisites: Node.js 22 LTS, PostgreSQL 16, nginx, openssl
sudo -u postgres createuser --pwprompt darwaza_app
sudo -u postgres createdb -O darwaza_app darwaza

# 2. Code
git clone <repo> /opt/darwaza && cd /opt/darwaza
npm ci --prefix server --omit=dev && npm ci --prefix client && npm run build --prefix client

# 3. Configuration
sudo mkdir -p /etc/darwaza /var/lib/darwaza/uploads /var/backups/darwaza
sudo cp server/.env.example /etc/darwaza/darwaza.env   # edit: DATABASE_URL, APP_ENCRYPTION_KEY (openssl rand -base64 48), PUBLIC_ORIGIN …
sudo chmod 600 /etc/darwaza/darwaza.env

# 4. Database schema + first administrator (prints a one-time password)
cd server && set -a && . /etc/darwaza/darwaza.env && set +a
node src/migrate.js
node scripts/bootstrap-admin.js admin "School Administrator"

# 5. Service + reverse proxy
sudo cp ../ops/darwaza.service /etc/systemd/system/ && sudo systemctl enable --now darwaza
sudo cp ../ops/nginx.conf.example /etc/nginx/sites-available/darwaza   # set domain, certbot --nginx
curl -s https://grades.example.school/api/health      # {"ok":true}

# 6. Backups (cron, daily) — see §10
```

First sign-in as `admin`: change the password, then enrol MFA (required).

**Upgrades:** `git pull && npm ci … && npm run build --prefix client && systemctl restart darwaza`. Migrations run automatically at start, under a lock, one transaction per file. Take a backup first.

## 9. Grading policy

Implemented in `server/src/lib/grading.js`, unit-tested in `test/grading.test.js`. The formula is printed on every report card.

| Term | Definition |
|---|---|
| Assessment % | score ÷ max × 100 |
| *graded* | counted |
| *missing* | counted as **0** if "missing counts as 0" is on (default); otherwise excluded |
| *excused* | always excluded (from numerator and denominator) |
| not entered | excluded, reported as pending; a sheet cannot be submitted while any are pending |
| Category % | Σ scores ÷ Σ max within the category (points-based) |
| Subject % (weighted, default) | Σ(category weight × category %) ÷ Σ weights of categories that have counted work |
| Subject % (unweighted) | Σ all scores ÷ Σ all max |
| Overall % | mean of subject percentages (each subject equal); subjects with no counted work are excluded, not treated as 0 |
| Pass / fail | subject % ≥ that subject's pass mark (default 50%, matching the legacy 5/10 and 10/20) |
| Rounding | only on displayed values (default 1 decimal, half-up); never on intermediate values |
| Bands (default) | ≥90 Excellent · ≥75 Very good · ≥60 Good · ≥50 Pass · <50 Needs improvement |
| Score input | 0 ≤ score ≤ max; decimals allowed by default (2 places); validated in the browser **and** on the server |

Category weights default to 1 (all equal). Change them in **Subjects → Assessment categories**.

> **Decision for the school:** the defaults reproduce the spirit of the old system (pass = 50%). The principal should confirm pass marks, weights and bands before the first term is published.

## 10. Backup and recovery

**Backup** (daily cron as the `darwaza` user):
```
30 1 * * *  DATABASE_URL=… BACKUP_DIR=/var/backups/darwaza UPLOAD_DIR=/var/lib/darwaza/uploads BACKUP_PASSPHRASE=… /opt/darwaza/ops/backup.sh
```
- Output: `darwaza-<UTC>.tar.enc` (pg_dump custom format + uploads, AES-256 / PBKDF2 600k) and a `.sha256` checksum. 30-day retention (`BACKUP_RETENTION_DAYS`).
- **Copy backups off the server** (another machine or cloud storage). Store `BACKUP_PASSPHRASE` and `APP_ENCRYPTION_KEY` in a password manager held by two people.
- Status appears under **Settings → Backups**.

**Restore** (tested, testing report §4.5):
```bash
sudo -u postgres createdb -O darwaza_app darwaza_restore
BACKUP_PASSPHRASE=… ops/restore.sh /var/backups/darwaza/darwaza-<ts>.tar.enc postgres://…/darwaza_restore /var/lib/darwaza/uploads-restored
# verify counts printed, sign in against it on staging, then point DATABASE_URL at it (or rename databases) and restart.
```

**Recommended practice:** run a test restore every term. Recovery point objective is 24 h with daily backups; add PostgreSQL WAL archiving for point-in-time recovery if a smaller window is required.

## 11. Migrating data from the old system

The old data lives in each browser's `localStorage`, on every computer the old page was used on.

1. On each such computer, open the old page, press F12 → Console, and run:
   `copy(JSON.stringify({ students: JSON.parse(localStorage.darwaza_students||'[]'), grades: JSON.parse(localStorage.darwaza_grades||'[]') }))`
   Paste the result into a file.
2. Create the academic year and term in the new system.
3. `node scripts/import-legacy.js export.json --year=2026-2027 --term=1 --dry-run`. Review the warnings, then run it without `--dry-run`.

The script:
- keeps each student's old code as their first password (they must change it);
- splits "کوردی (English)" names;
- imports valid photos;
- puts grades on published weekly sheets and keeps the notes;
- gives differing maximum scores their own sheet;
- **reports, never silently drops**, invalid rows (e.g. 15/10);
- is safe to re-run;
- writes a login sheet CSV.

Delete that CSV after distributing it.

## 12. Operations and monitoring

- Logs: JSON on stdout (`journalctl -u darwaza`), with request IDs (`X-Request-Id` header) and redacted secrets. Ship them to a central log system (e.g. Loki or ELK) if one is available.
- Health: `GET /api/health` (checks the DB). Point an uptime monitor at it.
- Watch: 5xx rate, p95 latency, DB connections, disk space for uploads and backups, backup job success, and `auth.login_failed` spikes (Audit Logs, filter `auth.`).
- Dependency updates: run `npm audit` in `server/` and `client/` monthly.

## 13. Administrator guide (principal / super admin / registrar)

1. **Before the year starts:**
   - **Academic Years**: add the year and terms, then *Set as current*.
   - **Classes & Sections**: add sections (e.g. Grade 10 – A) and homeroom teachers.
   - **Subjects**: confirm max scores and pass marks.
   - **Teachers**: add teachers (each gets a one-time password).
   - **Teacher Assignments**: assign teacher → section → subject.
2. **Students:**
   - **Add student** (with a section), or use **Import Students** for a CSV. Give each student the printed one-time login.
   - Open a student to upload a photo, change section, archive or transfer (a reason is required), or *Reset login password*.
3. **Parents:** in **User Management → Add user**, choose the *Parent* role, then use the link icon to attach their children. Only linked (verified) children are visible to the parent.
4. **Grades:**
   - The dashboard lists *Pending grade approvals*.
   - Open a sheet → *Approve* or *Return for changes* (with a comment) → *Publish to students*.
   - To fix a published grade, edit it directly. A reason is required and it is logged.
   - Close grade entry for a term in **Academic Years** (edit the term).
5. **Reports:**
   - **Reports → Class summary** (print / CSV); **Student report card** (print / CSV).
   - **Grade Overview** has filters, a missing-grade tracker and CSV export.
6. **Security:**
   - **User Management**: disable accounts, issue password reset codes, reset MFA.
   - **Audit Logs**: see who did what.
   - **Settings**: policies.

## 14. Teacher guide

1. Sign in, change your first password, and open **My Classes** on the dashboard.
2. Click **Enter grades** on a class/subject → **New grade sheet** → choose the term and category, enter the week number (the title fills in automatically) and the max score.
3. Type the scores. **Enter** moves to the next student, ↑/↓ move between rows. Kurdish digits work. Invalid scores turn red with the reason.
   - For absent students choose **Missing**; for students with permission choose **Excused**.
   - **Mark remaining as missing** fills in everyone left.
4. **Save draft** as often as you like. When everyone has a grade, choose **Submit for approval**; the sheet is then locked.
5. If the principal returns it, you'll get a notification. Fix the grades and submit again.
6. If another teacher saved the same sheet at the same time, the changed rows turn orange with their latest values. Check them and save again.

## 15. Student and parent guide

- **Students:** sign in with your student number (e.g. `DPS-2026-0001`) and the password from the school office, then choose a new password.
  - **My Grades** shows your overall average, each subject's percentage and pass status, and every published assessment with teacher feedback.
  - Choose a term or the whole year. **Print** gives an A4 report card.
- **Parents:** sign in with the account the school created. If you have several children, pick one at the top.
- Only grades that the school has **published** are shown. Forgot your password? Ask the school office for a reset code and use *I have a reset code* on the login page.

## 16. Completed vs. remaining

**Completed and tested:** everything listed in the testing report: auth, MFA, RBAC, isolation, grade entry, workflow, corrections, concurrency, reports and exports, import, bilingual UI, responsive layouts, backups, load test at 1,000 accounts.

**Not implemented (by decision or scope):**

| Item | Note |
|---|---|
| Attendance module | The brief marked it optional; not built. The schema leaves room for an `attendance` table later |
| Email / SMS (password reset, notifications) | No mail provider configured; in-app notifications and admin-issued reset codes instead |
| Server-generated PDF | Report cards use a print-optimised A4 layout. The browser's *Save as PDF* produces the PDF ([sample](screenshots/report-card-print-sample.pdf)). Server-side PDF libraries don't shape Kurdish script correctly, so browser printing gives better results |
| Background job queue for exports | Exports are generated synchronously with a 50,000-row cap; a full export of 26,750 grade rows took 0.38 s in testing. Add a queue if data grows by orders of magnitude |
| MFA recovery codes, shared rate-limit store, server-side image re-encoding, external pentest, axe/screen-reader audit | See Security report §2.4 |
| Staff profile photos | Only student photos |
| Self-service profile editing by students | Students can change their password and language only; profile data is maintained by the registrar (safer for official records) |

**Known issues:** none open from the test runs. The limitations are listed above and in the security report §2.4.
