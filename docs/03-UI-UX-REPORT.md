# 3. UI/UX change report

All screenshots are in [`screenshots/`](screenshots/). They were captured with Playwright from the running application using **demo data** (`seed-demo.js`), never real student data.

## 3.1 Brand

| Before | After |
|---|---|
| A hand-drawn SVG approximation of the logo, duplicated inline twice; wrong proportions, wrong details | The **original supplied logo image** is the single brand asset (`client/public/brand/darwaza-logo-original.jpg`, 1296×1277). Exact-artwork derivatives at 160/256/512 px (WebP + PNG) give sharp rendering through `srcset`. Icons are padded to a square on white rather than cropped or stretched, so proportions are preserved |
| — | One reusable component, `client/src/components/Logo.jsx`, used on the login page, sidebar, loading screen, report cards and print. Favicon (`favicon.ico`, 32 px), `apple-touch-icon`, 192/512 icons and `theme-color` are all derived from the same image |

Palette tokens are taken from the logo itself: navy `#182B53` and gold `#E59B24`, on white and neutral slate surfaces. Typography: **Vazirmatn** (Kurdish/Arabic script) and **Plus Jakarta Sans** (Latin). Both are bundled locally with no third-party requests.

## 3.2 Layout and navigation

- A persistent navy sidebar with a gold edge, grouped sections (Overview, Academic, Grades, Administration) and a clear active state (gold pill). Menu items are filtered by the user's permissions.
- Below 960 px the sidebar becomes an off-canvas drawer with a scrim and a menu button. On phones the user name collapses to an avatar.
- The top bar has notifications (with an unread count), the language switch, the user's name and roles, and sign-out.
- Page header pattern: title, one-line description, actions aligned to the end.
- No horizontal page scrolling at 390 px, 820 px or 1366 px. This is checked automatically by `e2e/smoke.js`, and that check found and fixed two real RTL overflow bugs.

## 3.3 Components and states

| Need | Implementation |
|---|---|
| Loading | Skeleton rows / blocks (respects `prefers-reduced-motion`) |
| Empty | Icon, title and hint (e.g. "No grade sheets yet — create one to start") |
| Errors | Inline, translated, specific messages (44 server error codes mapped to both languages), with a **Try again** button on failed loads |
| Success | Non-blocking toasts (`role=status`, `aria-live`) |
| Destructive actions | A promise-based confirm dialog; red danger button; reasons required for archive, return, unpublish and corrections |
| Forms | Visible labels, required markers, hints, `aria-invalid` and error text |
| Tables | Sticky-style header styling, sortable columns with `aria-sort`, server pagination with page-size selection, fail rows tinted red, conflict rows tinted orange |
| Status | Consistent badges for sheet workflow (Draft, Submitted, Approved, Published, Returned), student status and performance bands |

## 3.4 Key screens

| Screen | Highlights |
|---|---|
| Login | Split brand panel with the large logo; language switch before login; generic error; reset-code link |
| Admin dashboard | Active students, teachers, sections, grade completion %, pending approvals (linked), sheets by status, students by grade, recent audit activity |
| Teacher dashboard | One card per assigned class and subject, with counts of open and returned sheets and a direct "Enter grades" action |
| Students | Search (debounced), grade/section/status filters, sorting, pagination, photo avatars, Latin IDs isolated in RTL |
| Student profile | Photo upload (downscaled in the browser), details, enrollment history, change section, archive with a reason, reset login password (one-time password shown once with copy/print) |
| Bulk import | CSV template download, preview with per-row errors and duplicate warnings, all-or-nothing import, downloadable login sheet |
| Grade sheet | Roster grid sized for speed: **Enter / ↑ / ↓** move between students; instant validation (the same rules as the server); live percentage; missing/excused statuses; "mark remaining as missing"; an unsaved-changes counter and a leave warning; a sticky action bar with workflow buttons that depend on the role; history modal (approvals and per-grade changes); conflict banner after concurrent edits |
| Grade overview | All records with 6 filters, a failing/missing-only toggle, sorting, pagination, CSV export and a collapsible missing-grade tracker |
| Report card | Logo header, student meta, overall %, band, passed/failed counts, a subject table with pass marks, assessment history with teacher feedback, the **formula printed on the card**, signature lines, generation timestamp, an A4 print layout and CSV export |
| Student portal | The same report card, published grades only |
| Settings | Grading policy (mode, rounding, decimals, missing = 0, bands), security policy (MFA roles, session timeouts, lockout), school info, backup status |

## 3.5 Bilingual (Central Kurdish RTL / English LTR)

- Two complete dictionaries in `client/src/i18n/strings.js` (452 keys each). A key-parity and missing-key check was run: **0 missing** in either language.
- `dir` and `lang` are set on `<html>`. All spacing uses CSS logical properties (`margin-inline-start`, `inset-inline-end`, …). Direction-sensitive icons are mirrored with `.flip-rtl`.
- Latin data inside RTL (student IDs like `DPS-2026-0001`, usernames, e-mails, phone numbers, year ranges like `2026-2027`) is wrapped in `<bdi dir="ltr">` or Unicode isolates. Without this, Chromium rendered "2026-2027" as "2027-2026"; this was found in screenshots and fixed.
- Dates: browsers ship no Central Kurdish date data and silently fall back to English, so Kurdish month names (کانوونی دووەم … کانوونی یەکەم) are formatted explicitly.
- Numbers: Latin digits in both languages, for consistency with IDs and scores. **Input accepts Eastern Arabic digits** (٠–٩, ۰–۹), which are normalised before validation, so teachers can type on a Kurdish keyboard (covered by the e2e flow).
- Bilingual data (subjects, terms, categories, school name) is stored with `name_ckb` and `name_en` and shown in the active language.
- The user's language preference is saved to their account and restored at login.

## 3.6 Accessibility

| Checked | How |
|---|---|
| Skip link, landmarks (`aside`, `header`, `main`, `nav`) | code review |
| Every input labelled (`<label for>` or `aria-label`, including per-row grade inputs) | code review |
| Focus-visible ring (gold, 3 px) on all controls | manual screenshot review |
| Modals: `role=dialog`, `aria-modal`, labelled, focus trapped, Esc to close, focus returned to the trigger | code review |
| Contrast: navy `#182B53` on white is 13.9:1; body ink `#0f172a`; muted text `#64748b` on white is 4.76:1 (AA) | calculated |
| Touch targets ≥ 32 px (buttons 38 px) | CSS |
| Colour is never the only signal (fail rows also show "Below pass mark" text, statuses are text badges) | review |

**Not done:** a formal WCAG audit with a screen reader (NVDA/VoiceOver), and automated axe-core scanning. Both are recommended before go-live.

## 3.7 Simplification for administrators (second iteration)

Feedback: admins found it hard to analyse results and to find their way around. Changes:

| Before | After |
|---|---|
| 14 menu items | 8: **Home, Approvals, Grade sheets, Students, Results & analysis, Staff, School setup, System** (+ Account). Related pages became tabs (Staff = Teachers / Who teaches what / Accounts; School setup = Years & terms / Classes / Subjects; System = Settings / Activity history). Old addresses redirect |
| Dashboard of raw counts | **Home:** "Needs your attention" written as plain sentences (e.g. "3 grade sheets are waiting for your approval") with a button that goes straight there, or "Everything is up to date"; then 4 headline numbers (students, school average, % passing all subjects, students needing help) and two charts |
| Workflow jargon (Draft / Submitted / Approved / Published / Returned) | Plain status names: *Teacher is entering, Waiting for approval, Approved – not yet visible, Visible to students, Sent back to teacher* |
| Grade overview table only | **Results & analysis:** subject chart (sorted weakest first, red below the pass mark, pass-mark tick, pass rate per subject), class chart (tap a class to see its students), students by performance level, top 10 students, **Students needing help** (failed subjects shown as chips, CSV export), class results, all grades, report cards |
| Approve then publish, one sheet at a time, opening each | **Approvals inbox:** class average, number below the pass mark and sender on each row; **Approve & publish** per row or for all selected at once; count badge in the menu |
| No guidance | A one-line explanation at the top of each section |
| Parent accounts | Removed (not needed by the school) |

Charts follow the dataviz rules: single series with direct value labels, one hue, the reserved "critical" red only for below-pass bars together with a text label (never colour alone), a recessive track and a pass-mark tick. Bands with "≥" are isolated so RTL does not mirror them into "≤".

## 3.8 Account types and per-device layouts (third iteration)

**Account types (System → Account types, super administrator only).** Each account type has a card listing every section with its access level: *Hidden*, *View only* or *Full access*. The editor uses a three-way switch per section with a one-line explanation. You can create custom types (e.g. Secretary), suspend a type (its users are signed out and cannot sign in), or delete a custom type that has no users. The Super Administrator type is locked to full access, and the Student type is locked to "my grades", so neither can be broken. Sections map to server permissions in `server/src/lib/sections.js`, so a hidden section is blocked on the server, not just removed from the menu.

**Distinct layouts per device (pure CSS media queries + one small React hook):**

| Device | Layout |
|---|---|
| Phone ≤ 640 px | App-style: compact header with logo; **bottom navigation bar** with the user's 4 most important sections + "More" (opens the full menu); every table becomes a list of cards (each value labelled with its column heading, set automatically); headline numbers in a 2×2 grid; dialogs open as bottom sheets; large touch targets and score inputs for grade entry |
| Tablet 641–1100 px | Slim **icon rail** (icon + short label) instead of the full sidebar; 2-column headline numbers; single-column charts in portrait |
| Laptop 1101–1599 px | Full sidebar with section headings |
| Large ≥ 1600 px | Wider sidebar and content, slightly larger text |

## 3.9 Student Weekly Grade Card (reference design)

Built from the school's reference screenshot:
- full-width **navy header**: logo, Kurdish name, English name and subtitle, user badge, gold language button, red logout;
- white **profile card**: photo, name, **DAR-4821**-style ID, class, year, term, gold **Print grade card** button;
- **three summary cards** with coloured side accents: *Overall performance* (emerald when passing), *Weekly average* (with the 0–10 scale when all subjects share it), *Behavior evaluation*;
- **week navigation**: year, term, week selector with previous/next;
- the **Weekly Student Grade Card** table: Subject, Week, Obtained, Maximum, Percentage, Teacher comments;
- an expandable **Performance history**: term averages, weekly averages chart, subject-by-subject progress with week-to-week change.

Percentage badges: 90–100 green, 70–89 light green, 50–69 amber, below 50 light red. Rows below the subject's pass mark get a soft red tint and a red mark. All values come from published database records; percentage = obtained ÷ maximum × 100. On phones the repeated Week column is hidden so marks, percentages and comments fit without scrolling.

**Print grade card** opens a dedicated A4 page (`/print/report/:id`): logo, school names, photo, name, DAR ID, class, year, term, week, subject table, weekly average, overall performance, behavior, signatures and generation date. App navigation is never printed.

Staff open the same card from *Students → student → Weekly grade card*. Behavior evaluations are entered in *Grade sheets → Behavior evaluation*.
