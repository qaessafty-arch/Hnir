# 1. Audit of the original system

**Audited artifact:** a single file, `index.html` (1,108 lines). It is kept unchanged at `legacy/original-index.html`.
**Audit date:** 2026-11-12. The repository contained no other code: no backend, no database, no build, and no tests.

## 1.1 Original architecture

| Layer | What it was |
|---|---|
| Hosting | One static HTML page |
| UI | Tailwind via the **CDN JIT script** (`cdn.tailwindcss.com`, which is not meant for production), Font Awesome from a CDN, Google Fonts |
| Logic | About 650 lines of inline JavaScript in the page |
| "Database" | Browser `localStorage` (`darwaza_students`, `darwaza_grades`), separately on **each browser and each device** |
| Authentication | Client-side string comparison: admin password `admin` / `admin123` hard-coded in the source; students logged in with a "secret code" only (e.g. `DAR-991`) |
| Authorization | Hiding or showing `<section>` elements |
| Branding | A hand-drawn SVG *approximation* of the logo, duplicated twice inline |

**Features that existed (all kept in the new system):**
- Student registration with an optional photo, grade level 1–12 and an auto-generated code.
- Master grade entry: one student × one week × all 13 subjects, with max score 10 or 20 per subject and a note per subject.
- A list of all grades with delete.
- A student dashboard with average, subject count, performance level and a weekly grade table.
- Printing with `window.print()`.
- The Kurdish (RTL) / English (LTR) toggle.
- Fail highlighting.

## 1.2 Problems found

Severity scale: **Critical** (data breach or total loss), **High**, **Medium**, **Low**.

Each problem below has an ID. The *Fix* columns point to the code, and the test that proves each fix is listed in [04-TESTING-REPORT.md](04-TESTING-REPORT.md).

### Security

| ID | Severity | Problem | Why it matters | Fix (where) | How tested | Result |
|---|---|---|---|---|---|---|
| S1 | Critical | Admin password `admin`/`admin123` hard-coded in the client source (`handleAdminLogin`) | Anyone who views the page source becomes the principal | Server-side accounts with argon2id hashes; no default passwords. The first admin is created with `scripts/bootstrap-admin.js` and gets a one-time password (`server/src/routes/auth.js`, `lib/passwords.js`) | `api.test.js` › authentication | Pass |
| S2 | Critical | Authentication and authorization happen only in the browser. Anyone can type `currentUser={role:'admin'}` in the console | No real access control at all | Server-side sessions plus RBAC middleware on every route (`middleware/auth.js`, `requirePerm`) | Authorization tests (unauthenticated → 401, wrong role → 403/404) | Pass |
| S3 | Critical | All data of all students sits in the browser's `localStorage`. On a shared or school computer, the next user sees every student and every code | Confidential records exposed | Data lives only in PostgreSQL. The browser stores only the language preference | Code review; `api.js` keeps the CSRF token only in memory | Pass |
| S4 | Critical | A student logs in with the code alone (`DAR-` + 4 digits = **9,000 possible values**), with no rate limit | Every student's grades can be enumerated in seconds | Username + password (≥10 characters, argon2id), per-account lockout, per IP+username rate limit, and TOTP MFA for privileged roles | Lockout test, rate-limit test, MFA test | Pass |
| S5 | High | Student codes are generated with `Math.random()` and never checked for collisions | Two students could share a code, and one would see the other's grades | Sequential `DPS-YYYY-NNNN` IDs from a DB sequence with a UNIQUE constraint. Passwords come from `crypto.randomInt` | Unit and integration tests | Pass |
| S6 | High | Stored XSS: student names, notes and subject names are interpolated into `innerHTML` without escaping (`renderAdminTables`, `renderMasterStudentForm`, `renderStudentDashboard`). A name like `<img src=x onerror=…>` runs script in the admin's browser | Account and data takeover | React escapes all output, there is no `dangerouslySetInnerHTML`, and a strict CSP (`script-src 'self'`) is in place | XSS test (payload stored and returned as inert JSON); CSP verified in a real browser by Playwright | Pass |
| S7 | High | Photo uploads are read as data URLs with no type or size checks. SVG/HTML could be stored and rendered | XSS / denial of service via huge base64 strings | Magic-byte check (JPEG/PNG/WebP only), 2 MB limit, random file names, files served only through an authorized endpoint with `nosniff`. The browser downscales to 512 px before upload | Upload tests (HTML, SVG, oversized, path traversal name) | Pass |
| S8 | Medium | Third-party scripts loaded from CDNs with no integrity checks, including the Tailwind JIT CDN | Supply-chain risk; Tailwind's CDN is not meant for production | Everything is bundled locally (Vite), including fonts. CSP allows only `'self'` | Playwright run reported no CSP violations | Pass |
| S9 | Medium | No audit trail. Grades could be changed or deleted with no record | Disputes cannot be resolved; tampering is invisible | Append-only `audit_logs` (enforced by a DB trigger), `grade_record_history`, `grade_approvals` | Audit tests | Pass |
| S10 | Medium | Codes were shown and copied in the admin table; anyone looking over the shoulder could read them | Credential exposure | Passwords are never stored or shown; one-time passwords are shown once at creation or reset | Code review | Pass |

### Data integrity

| ID | Severity | Problem | Fix | Tested |
|---|---|---|---|---|
| D1 | Critical | No central database. Each browser had its own copy, so two teachers on two PCs saw different data, and clearing the browser deleted everything | PostgreSQL with migrations and automated encrypted backups | Backup/restore test |
| D2 | High | Deleting a student left their grades orphaned (shown as "Unknown") | Students are never hard-deleted (archive/transfer/graduate with a reason); foreign keys use `ON DELETE RESTRICT` | Schema plus status test |
| D3 | High | No validation: the `max` attribute is advisory only, so scores of `25/10`, `-3` or `1e9` were saved | Server-side `validateScore` (0 ≤ score ≤ max, decimal rules), plus `CHECK` constraints in the DB, plus the same validation in the UI | Validation tests |
| D4 | High | Last write wins: two admins editing at once silently overwrite each other | Optimistic concurrency (row `version`), a sheet-level row lock, and a 409 response with conflict details shown in the UI | Concurrency test and load test phase D |
| D5 | Medium | Duplicate grades were possible for the same student/subject/week (the lookup used `find` on names) | `UNIQUE (assessment_id, student_id)` | Integrity test |
| D6 | Medium | A blank field silently kept the old value, and there was no way to say "absent" or "excused" | Explicit `missing` / `excused` statuses; blank is rejected; clearing is an explicit confirmed action | "Blank score" test |
| D7 | Medium | Grade IDs were `Date.now() + index`, which collides when two saves happen in the same millisecond | DB-generated `bigserial` keys | n/a (structural) |
| D8 | Low | Subjects were identified by their display string `"بیرکاری / Math"`; renaming one broke all history | `subjects` table with stable IDs and codes | n/a |

### Grading logic

| ID | Problem | Fix |
|---|---|---|
| G1 | `isFailingGrade` only knew max 10 (<5) and max 20 (<10). Any other maximum could never fail | A pass mark per subject (percent), configurable |
| G2 | The average was the mean of *rounded per-row percentages*. That double-rounds, and it weights a 10-point quiz the same as a 20-point exam | Points-based percentages within each category, a weighted or unweighted mode, and rounding applied only to the final displayed value. The formula is documented and printed on every report card ([GRADING_POLICY](05-HANDOVER.md#9-grading-policy)) |
| G3 | The "overall" figure mixed every week and every subject into one mean | Overall = mean of subject percentages. Subjects with no grades are excluded, not counted as 0 |
| G4 | Performance bands were hard-coded in mixed languages ("زۆر باش / Excellent") | Bands are configurable in Settings and fully localized |

### UI / UX

| ID | Problem | Fix |
|---|---|---|
| U1 | The logo was an approximate SVG redraw that is not the real logo | The supplied original image is used everywhere through one `<Logo>` component: login, sidebar, report cards, favicon and app icons |
| U2 | `alert()` / `confirm()` dialogs, untranslated in places | Accessible toasts, a focus-trapped confirm dialog, inline errors |
| U3 | Mixed-language strings ("پۆلی 10 (Grade 10)", "Unknown", "Week 1" in Kurdish mode) | Two complete dictionaries (452 keys each) with a parity check |
| U4 | Physical `ml-*`/`mr-*`/`space-x-reverse` hacks for RTL | CSS logical properties throughout; `<bdi dir=ltr>` and Unicode isolates for Latin codes and year ranges |
| U5 | Tables became unusable on phones; no pagination; every record rendered at once | Responsive layout, scroll containers, server-side pagination, filters, sorting |
| U6 | No loading, empty or error states | Skeletons, empty states and retryable error states on every list |
| U7 | Print stylesheet bug (`shadow: none` is not a CSS property) | A dedicated A4 print stylesheet for report cards with logo, signatures and the generation date |
| U8 | No keyboard support or form labels on dynamic inputs | Every input has a label or `aria-label`; skip link; focus rings; Enter/↑/↓ navigation in grade entry |

### Performance and scalability

| ID | Problem | Fix |
|---|---|---|
| P1 | All data was re-rendered via `innerHTML` on every change, at O(students × grades) cost (`renderAdminTables` runs `find` inside `map`) | Indexed SQL with server-side pagination |
| P2 | Photos stored as base64 inside `localStorage` (5 MB browser quota), so the app breaks after a few dozen photos | Files on disk, downscaled in the browser, served lazily |
| P3 | Cannot support more than one simultaneous user (see D1) | Multi-user server, verified with a load test at 1,000 accounts |

### Useful features intentionally changed (documented, not dropped)

- **"Master card" entry** (one student, all subjects) was replaced by **roster entry** (one class, one subject, all students). That matches how teachers actually work and makes per-subject ownership enforceable. Admins can still see all of a student's subjects on the report card and in the grade overview.
- **Delete grade** became **clear (draft only)** or **correction with a reason (published)**, so history is never lost.
- **Visible/copyable secret codes** became **one-time passwords** shown once, plus a "reset login password" action.
- **Fixed 13 subjects** became an editable subject list. The original 13 are pre-loaded with the same names and max score 10.
