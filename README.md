# Darwaza Private School — School Management System
**قوتابخانەی دەروازەی ناحکومی**

<img src="client/public/brand/darwaza-logo-256.png" alt="Darwaza Private School logo" width="128" />

A secure, bilingual (Central Kurdish RTL / English LTR), database-backed school management platform. It replaces the original single-file, localStorage-based grade page (kept at `legacy/original-index.html`).

| Area | What you get |
|---|---|
| Roles | Super Administrator, Principal, Registrar, Teacher, Student, Auditor, plus custom account types. The super administrator decides per type which sections are hidden, view-only or full access (enforced on the server) |
| Security | argon2id, server sessions (HttpOnly / SameSite=Strict), TOTP MFA for privileged roles, CSRF tokens, strict CSP, rate limiting and lockout, object-level authorization (IDOR-tested), append-only audit log, encrypted backups |
| Grades | Roster entry per class and subject, draft → submit → approve → publish workflow, missing/excused statuses, corrections with reasons and full history, conflict-safe concurrent editing, configurable grading policy |
| Analysis | Plain-language dashboard ("needs your attention" with one-click actions), Results & analysis page (school average, pass rate, subject and class charts, students needing help, top students), approvals inbox with bulk approve & publish |
| Reports | Printable A4 report cards with the official logo and signatures, class summaries, school-wide grade overview, audited CSV exports |
| Devices | Separate layouts: phone (bottom navigation, card lists), tablet (icon rail), laptop (full sidebar), large screens |
| App | Installable on Android, iPhone/iPad, Windows and Mac (Progressive Web App): own icon, full screen, offline screen; student data is never stored on the device |
| Scale | Load-tested with 1,000 accounts and 26,000 grades: 200 concurrent students at p99 132 ms (1 process) / 67 ms (4 workers), and 48 concurrent grade writers with 0 lost updates |

## Quick start (development)

Requirements: Node.js 22, PostgreSQL 16.

```bash
createuser -P darwaza && createdb -O darwaza darwaza_dev        # password: devpass (dev only)
cp server/.env.example server/.env    # set NODE_ENV=development, DATABASE_URL, APP_ENCRYPTION_KEY
npm ci --prefix server && npm ci --prefix client
npm run migrate --prefix server
node server/scripts/seed-demo.js 120  # DEMO data only — refuses to run in production
npm run build --prefix client && npm start --prefix server   # http://localhost:3000
# or for UI work: npm run dev --prefix server  +  npm run dev --prefix client (http://localhost:5173)
```

**Sign-in is by code only (no passwords).** Everyone types a code in the form **DAR-####** (the login box shows `DAR-`, so only the 4 digits are typed): students their student ID (4 random digits), staff their personal code. Demo (dev only): admin `DAR-4721`, principal `DAR-3958`, registrar `DAR-6204`, auditor `DAR-8137`, teachers 1–6 `DAR-2546` `DAR-7319` `DAR-5082` `DAR-9463` `DAR-1675` `DAR-6830`; first demo student `DAR-2741`.

For production, **do not seed demo data**. Create the first administrator with `node server/scripts/bootstrap-admin.js <username> "<Full Name>"` (prints their sign-in code; `node server/scripts/issue-login-code.js <username>` issues a new one), then follow [deployment](docs/05-HANDOVER.md#8-deployment-production).

## Tests

```bash
createdb -O darwaza darwaza_test
npm test --prefix server                       # 48 unit + integration/security tests (real PostgreSQL)
node e2e/smoke.js http://localhost:3000 out    # browser test: roles × languages × viewports (needs demo data)
node e2e/pwa.js http://localhost:3000          # installable-app checks (manifest, service worker, offline, no data cached)
node ops/loadtest.js http://localhost:3000 1000 30   # load test (separate DB seeded with 1000 students, LOGIN_RATE_LIMIT raised)
```

## Documentation

1. [Original system audit](docs/01-ORIGINAL-SYSTEM-AUDIT.md): every problem found, why it mattered, how and where it was fixed, and how it was tested
2. [Security report](docs/02-SECURITY-REPORT.md): controls, the role/permission matrix, open recommendations
3. [UI/UX report](docs/03-UI-UX-REPORT.md): brand, layouts, bilingual/RTL, accessibility, [screenshots](docs/screenshots)
4. [Testing report](docs/04-TESTING-REPORT.md): all tests, load and concurrency results, what was *not* tested
5. [Technical handover](docs/05-HANDOVER.md): architecture, schema, grading formula, deployment, backup and recovery, legacy import, admin/teacher/student guides, completed vs. remaining work
