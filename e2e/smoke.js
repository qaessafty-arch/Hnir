// Browser smoke test across roles, languages and viewports.
// Usage: node e2e/smoke.js [baseUrl] [outDir]   (requires demo data: server/scripts/seed-demo.js)
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const PW = 'Passw0rd!demo';
const problems = [];

async function session(browser, user, { lang = 'ckb', viewport = { width: 1366, height: 860 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => localStorage.setItem('dps_lang', l), lang);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) problems.push(`[${user} ${lang}] console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${user} ${lang}] pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`[${user}] ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[autocomplete=username]', user);
  await page.fill('input[autocomplete=current-password]', PW);
  await page.click('form button:not([type=button])');
  await page.waitForSelector('#main', { timeout: 10000 });
  return { ctx, page };
}

async function shot(page, name, path) {
  if (path) await page.goto(BASE + path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`${name}: horizontal page overflow ${overflow}px`);
  // Cards must fit inside the main column (the layout clips overflow, so check cards directly).
  const wide = await page.evaluate(() => {
    const main = document.querySelector('#main'); if (!main) return 0;
    const box = main.getBoundingClientRect();
    return [...document.querySelectorAll('#main .card')].filter((c) => { const r = c.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; }).length;
  });
  if (wide) problems.push(`${name}: ${wide} card(s) wider than the screen`);
}

(async () => {
  const browser = await chromium.launch();

  const c0 = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const p0 = await c0.newPage();
  // 401 from the initial /api/auth/me probe (not signed in yet) is expected.
  p0.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) problems.push(`login console: ${m.text()}`); });
  await p0.goto(`${BASE}/login`); await shot(p0, '01-login-ckb');
  await p0.click('text=English'); await shot(p0, '02-login-en');
  await p0.fill('input[autocomplete=username]', 'demo.admin');
  await p0.fill('input[autocomplete=current-password]', 'wrong-password');
  await p0.click('form button:not([type=button])');
  await p0.waitForSelector('.alert-bad'); await shot(p0, '03-login-error-en');
  await c0.close();

  for (const lang of ['ckb', 'en']) {
    const { ctx, page } = await session(browser, 'demo.principal', { lang });
    await shot(page, `10-home-${lang}`, '/');
    await shot(page, `11-students-${lang}`, '/students');
    await page.click('table tbody tr:first-child a'); await page.waitForSelector('.avatar-lg');
    await shot(page, `12-student-detail-${lang}`);
    await shot(page, `13-grade-sheets-${lang}`, '/grades');
    await page.click('table tbody tr:first-child a'); await page.waitForSelector('.sticky-bar');
    await shot(page, `14-sheet-${lang}`);
    await shot(page, `15-approvals-${lang}`, '/approvals');
    await shot(page, `16-results-overview-${lang}`, '/results');
    await shot(page, `17-results-at-risk-${lang}`, '/results?tab=help');
    await shot(page, `18-results-classes-${lang}`, '/results?tab=classes');
    await shot(page, `19-results-all-grades-${lang}`, '/results?tab=grades');
    await shot(page, `20-report-card-${lang}`, '/reports/student/1');
    await shot(page, `21-staff-${lang}`, '/staff');
    await shot(page, `22-staff-accounts-${lang}`, '/staff?tab=accounts');
    await shot(page, `23-staff-assignments-${lang}`, '/staff?tab=assignments');
    await shot(page, `24-setup-${lang}`, '/setup');
    await shot(page, `25-setup-classes-${lang}`, '/setup?tab=classes');
    await shot(page, `26-system-audit-${lang}`, '/system?tab=audit');
    await shot(page, `27-import-${lang}`, '/students/import');
    await ctx.close();
  }
  {
    const { ctx, page } = await session(browser, 'demo.admin', { lang: 'en' });
    await shot(page, '28-system-settings-en', '/system');
    await shot(page, '27-account-en', '/account');
    await shot(page, '29-system-account-types-en', '/system?tab=types');
    await page.click('.type-card .btn-secondary'); await page.waitForSelector('.section-picker');
    await page.screenshot({ path: `${OUT}/30-account-type-editor-en.png` });
    await ctx.close();
  }
  {
    // Teacher: create a sheet, enter grades incl. an invalid one and Eastern-Arabic digits, save draft.
    const { ctx, page } = await session(browser, 'demo.teacher1', { lang: 'ckb' });
    await shot(page, '30-teacher-dashboard-ckb');
    await page.click('#main .grid .card a.btn-primary'); await page.waitForLoadState('networkidle');
    await page.click('.page-actions .btn-primary');
    await page.fill('#nsf input[inputmode=numeric]', String(3 + (Date.now() % 50))); // unique week per run
    await page.fill('#nsf input[maxlength="100"]', `E2E ${Date.now()}`); // unique title so repeated runs never collide
    await page.click('button[form=nsf]');
    await page.waitForSelector('.score-input');
    const inputs = await page.$$('.score-input');
    await inputs[0].fill('9.5'); await inputs[1].fill('11'); await inputs[2].fill('٧');
    await shot(page, '31-sheet-entry-validation-ckb');
    await inputs[1].fill('8');
    await page.click('.sticky-bar .btn-secondary');
    await page.waitForSelector('.toast');
    await shot(page, '32-sheet-saved-ckb');
    await ctx.close();
  }
  {
    const { ctx, page } = await session(browser, 'DPS-2026-0001', { lang: 'ckb' });
    await shot(page, '40-student-portal-ckb');
    await ctx.close();
  }
  {
    const { ctx, page } = await session(browser, 'DPS-2026-0001', { lang: 'en' });
    await shot(page, '41-student-portal-en');
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: `${OUT}/42-student-print.png`, fullPage: true });
    await page.pdf({ path: `${OUT}/report-card-print.pdf`, format: 'A4', printBackground: true });
    await ctx.close();
  }
  for (const [u, path, name] of [['demo.principal', '/', '50-mobile-dashboard'], ['demo.principal', '/students', '51-mobile-students'], ['demo.principal', '/results', '55-mobile-results'], ['demo.principal', '/approvals', '56-mobile-approvals'], ['demo.teacher1', '/grades/sheet/1', '60-mobile-grade-entry'], ['demo.admin', '/system?tab=types', '61-mobile-account-types'],
    ['DPS-2026-0001', '/portal', '52-mobile-student'], ['demo.teacher1', '/grades', '53-mobile-grades']]) {
    const { ctx, page } = await session(browser, u, { lang: 'ckb', viewport: { width: 390, height: 844 } });
    await shot(page, name, path);
    if (name === '50-mobile-dashboard') {
      await page.click('.bottom-nav button'); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/54-mobile-menu.png` });
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await session(browser, 'demo.principal', { lang: 'en', viewport: { width: 820, height: 1180 } });
    await shot(page, '57-tablet-results', '/results');
    await shot(page, '58-tablet-home', '/');
    await shot(page, '59-tablet-students-ckb', '/students');
    await ctx.close();
  }
  await browser.close();
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'NO PROBLEMS');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); console.log(problems.join('\n')); process.exit(1); });
