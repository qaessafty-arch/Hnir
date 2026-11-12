// PWA checks: manifest, installability (Chromium), service worker, offline page, and that no API data is cached.
// Usage: node e2e/pwa.js [baseUrl]   (production build served by the Node server)
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:3000';
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');

  const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();
  check(manifest.display === 'standalone' && manifest.icons.some((i) => i.sizes === '512x512') && manifest.icons.some((i) => i.purpose === 'maskable'), 'manifest: standalone, 512px icon, maskable icon');

  const swReady = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  check(swReady, 'service worker registered and active');

  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  check(installabilityErrors.length === 0, `Chromium installability: ${installabilityErrors.length ? JSON.stringify(installabilityErrors) : 'installable'}`);

  // Sign in and load grades so /api responses pass through the service worker, then inspect the caches.
  await page.reload(); await page.waitForLoadState('networkidle');
  await page.fill('input[autocomplete=username]', 'DAR-2741');
  await page.click('form button:not([type=button])');
  await page.waitForSelector('#main'); await page.waitForLoadState('networkidle');
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  check(cached.length > 0 && !cached.some((p) => p.startsWith('/api/')), `no API/student data in device cache (${cached.length} shell files cached)`);

  await ctx.setOffline(true);
  await page.goto(`${BASE}/grades`).catch(() => {});
  const offlineText = await page.textContent('body').catch(() => '');
  check(/You are offline/.test(offlineText) && /ئینتەرنێت/.test(offlineText), 'offline: bilingual offline page shown');
  await page.screenshot({ path: process.argv[3] ? `${process.argv[3]}/pwa-offline.png` : 'pwa-offline.png' });
  await ctx.setOffline(false);

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
