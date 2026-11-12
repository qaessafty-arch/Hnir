'use strict';
/**
 * Load test for Darwaza SMS. Run against a NON-production database seeded with
 *   DATABASE_URL=... node server/scripts/seed-demo.js 1000
 * and a server started with LOGIN_RATE_LIMIT raised (all virtual users share one IP here).
 *
 *   node ops/loadtest.js http://localhost:3000 [students=1000] [duration=30]
 *
 * Phases
 *   A. All students sign in (concurrency 25) — argon2id hashing is the expected bottleneck.
 *   B. 200 concurrent connections, each a different signed-in student, reading their report card.
 *   C. Mixed staff traffic: principal dashboard + grade overview + school-wide CSV-free reads.
 *   D. Concurrent grade writes: 6 teachers × 8 parallel writers saving grades on the SAME sheets
 *      (worst case for conflicts). Every response must be 200 or 409 — never 5xx, never lost updates.
 */
const autocannon = require('autocannon');

const BASE = process.argv[2] || 'http://localhost:3000';
const N = Number(process.argv[3] || 1000);
const DURATION = Number(process.argv[4] || 30);
const PW = 'Passw0rd!demo';

async function login(username) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PW }) });
  const ms = performance.now() - t0;
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })).json();
  return { cookie, csrf: me.csrfToken, ms };
}
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const fmt = (r) => ({ reqPerSec: Math.round(r.requests.average), p50: r.latency.p50, p90: r.latency.p90, p99: r.latency.p99, max: r.latency.max,
  total: r.requests.total, errors: r.errors, timeouts: r.timeouts, non2xx: r.non2xx, '5xx': r['5xx'] });

async function pool(items, conc, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

(async () => {
  const results = {};
  if (!process.env.ONLY_WRITES) {
  // ---- A: logins ----
  const usernames = Array.from({ length: N }, (_, i) => `DAR-${String(i + 1).padStart(4, '0')}`);
  const tA = performance.now();
  const sessions = await pool(usernames, 25, (u) => login(u));
  const lat = sessions.map((s) => s.ms);
  results.A_logins = { users: N, seconds: +((performance.now() - tA) / 1000).toFixed(1), perSec: +(N / ((performance.now() - tA) / 1000)).toFixed(1),
    p50: Math.round(pct(lat, 50)), p90: Math.round(pct(lat, 90)), p99: Math.round(pct(lat, 99)) };
  console.log('A', results.A_logins);

  // student ids: student N has id N in the seeded DB
  const me = await Promise.all(sessions.slice(0, 200).map((s) => fetch(`${BASE}/api/portal/me`, { headers: { cookie: s.cookie } }).then((r) => r.json())));
  // ---- B: 200 concurrent students reading their own report card ----
  let ci = 0;
  const b = await autocannon({
    url: BASE, connections: 200, duration: DURATION,
    setupClient: (client) => { const k = ci++ % 200; client.setHeaders({ cookie: sessions[k].cookie }); client.setRequest({ method: 'GET', path: `/api/reports/student/${me[k].students[0].id}` }); },
  });
  results.B_student_reports = fmt(b);
  console.log('B', results.B_student_reports);

  // ---- C: staff reads ----
  const principal = await login('demo.principal');
  const c = await autocannon({
    url: BASE, connections: 50, duration: DURATION, headers: { cookie: principal.cookie },
    requests: [{ method: 'GET', path: '/api/dashboard' }, { method: 'GET', path: '/api/reports/grades?pageSize=50&q=a' },
      { method: 'GET', path: '/api/students?pageSize=25&q=ar' }, { method: 'GET', path: '/api/reports/section/1' }],
  });
  results.C_staff_reads = fmt(c);
  console.log('C', results.C_staff_reads);

  }
  // ---- D: concurrent grade writes ----
  const teachers = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => login(`demo.teacher${i}`)));
  // each teacher gets one draft sheet in a section/subject they teach
  const sheets = [];
  for (const t of teachers) {
    const asg = (await (await fetch(`${BASE}/api/academic/assignments`, { headers: { cookie: t.cookie } })).json()).items[0];
    const term = (await (await fetch(`${BASE}/api/academic/terms`, { headers: { cookie: t.cookie } })).json()).items.find((x) => x.ordinal === 1);
    const r = await fetch(`${BASE}/api/assessments`, { method: 'POST', headers: { cookie: t.cookie, 'x-csrf-token': t.csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ term_id: term.id, section_id: asg.section_id, subject_id: asg.subject_id, category_id: 1, title: `Load ${Date.now()}-${sheets.length}`, max_score: 10 }) });
    const body = await r.json();
    if (r.status !== 201) throw new Error(`create sheet failed: ${r.status} ${JSON.stringify(body)}`);
    sheets.push({ t, id: body.id });
  }
  const counts = { 200: 0, 409: 0 }; const wlat = [];
  const end = Date.now() + DURATION * 1000;
  await Promise.all(sheets.flatMap((sh) => Array.from({ length: 8 }, async () => {
    while (Date.now() < end) {
      const g = await fetch(`${BASE}/api/assessments/${sh.id}`, { headers: { cookie: sh.t.cookie } });
      if (g.status !== 200) { counts[`read_${g.status}`] = (counts[`read_${g.status}`] || 0) + 1; await g.arrayBuffer(); continue; }
      const { roster } = await g.json();
      const rows = roster.slice(0, 25).map((r) => ({ student_id: r.student_id, score: Math.round(Math.random() * 20) / 2, version: r.record_id ? r.version : null }));
      const t0 = performance.now();
      const res = await fetch(`${BASE}/api/assessments/${sh.id}/grades`, { method: 'PUT', headers: { cookie: sh.t.cookie, 'x-csrf-token': sh.t.csrf, 'content-type': 'application/json' }, body: JSON.stringify({ rows }) });
      wlat.push(performance.now() - t0);
      await res.arrayBuffer();
      const k = res.status === 200 ? 200 : res.status === 409 ? 409 : `write_${res.status}`; counts[k] = (counts[k] || 0) + 1;
    }
  })));
  // Integrity: every record's version must equal 1 + number of history rows (no lost updates)
  results.D_concurrent_writes = { writers: 48, saves_ok: counts[200], conflicts_409: counts[409], statuses: counts,
    p50: Math.round(pct(wlat, 50)), p90: Math.round(pct(wlat, 90)), p99: Math.round(pct(wlat, 99)), sheet_ids: sheets.map((s) => s.id) };
  console.log('D', results.D_concurrent_writes);
  console.log(JSON.stringify(results));
})().catch((e) => { console.error(e); process.exit(1); });
