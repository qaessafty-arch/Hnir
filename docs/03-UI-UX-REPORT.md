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
| Student / parent portal | The same report card, published grades only; parents pick from verified children |
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
