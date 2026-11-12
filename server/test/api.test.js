'use strict';
const test = require('node:test');
const assert = require('node:assert');
const totp = require('../src/lib/totp');
const h = require('./helpers');

let ids;
test.before(async () => { await h.resetDb(); ids = await h.fixture(); });
test.after(async () => { await h.db.pool.end(); });

// ---------------- Authentication ----------------
test.describe('authentication', () => {
  test('rejects wrong password with generic error, no user enumeration', async () => {
    const a = await h.request().post('/api/auth/login').send({ username: 'principal1', password: 'nope' });
    const b = await h.request().post('/api/auth/login').send({ username: 'nobody', password: 'nope' });
    assert.strictEqual(a.status, 401); assert.strictEqual(b.status, 401);
    assert.deepStrictEqual(a.body, b.body);
  });

  test('session cookie is HttpOnly + SameSite=Strict, and a new id is issued on every login', async () => {
    const r1 = await h.request().post('/api/auth/login').send({ username: 'auditor1', password: h.PW });
    const r2 = await h.request().post('/api/auth/login').send({ username: 'auditor1', password: h.PW });
    const c1 = r1.headers['set-cookie'].find((c) => c.startsWith('dps_sid='));
    const c2 = r2.headers['set-cookie'].find((c) => c.startsWith('dps_sid='));
    assert.match(c1, /HttpOnly/); assert.match(c1, /SameSite=Strict/);
    assert.notStrictEqual(c1.split(';')[0], c2.split(';')[0]);
  });

  test('passwords are stored as argon2id hashes', async () => {
    const r = await h.db.query("SELECT password_hash FROM users WHERE username='principal1'");
    assert.match(r.rows[0].password_hash, /^\$argon2id\$/);
  });

  test('account locks after repeated failures', async () => {
    await h.mkUser('locky', ['teacher']);
    for (let i = 0; i < 5; i++) await h.request().post('/api/auth/login').send({ username: 'locky', password: 'bad' });
    const r = await h.request().post('/api/auth/login').send({ username: 'locky', password: h.PW });
    assert.strictEqual(r.status, 423);
  });

  test('state-changing requests require the CSRF token', async () => {
    const s = await h.login('principal1');
    const bad = await s.agent.post('/api/notifications/read').send({});
    assert.strictEqual(bad.status, 403); assert.strictEqual(bad.body.error.code, 'csrf_failed');
    const forged = await s.agent.post('/api/notifications/read').set('X-CSRF-Token', s.csrf).set('Origin', 'https://evil.example').send({});
    assert.strictEqual(forged.status, 403);
    const ok = await s.post('/api/notifications/read').send({});
    assert.strictEqual(ok.status, 200);
  });

  test('logout invalidates the session server-side', async () => {
    const s = await h.login('auditor1');
    const cookie = (await s.agent.get('/api/auth/me')).request.cookies;
    await s.post('/api/auth/logout').send({});
    const r = await h.request().get('/api/auth/me').set('Cookie', cookie);
    assert.strictEqual(r.status, 401);
  });

  test('forced password change blocks other endpoints and enforces policy', async () => {
    await h.mkUser('newbie', ['teacher'], { mustChange: true });
    const s = await h.login('newbie');
    assert.strictEqual((await s.get('/api/dashboard/teacher')).body.error.code, 'password_change_required');
    const weak = await s.post('/api/auth/password').send({ currentPassword: h.PW, newPassword: 'short' });
    assert.strictEqual(weak.body.error.code, 'password_too_short');
    const ok = await s.post('/api/auth/password').send({ currentPassword: h.PW, newPassword: 'Brand-New-Pass-42' });
    assert.strictEqual(ok.status, 200);
    // Old session was revoked and a fresh one issued on the agent.
    assert.strictEqual((await s.agent.get('/api/dashboard/teacher')).status, 200);
  });

  test('MFA: privileged role must enrol, then must verify TOTP at each login', async () => {
    const s = await h.login('super1');
    assert.strictEqual(s.me.mfaState, 'pending_enroll');
    assert.strictEqual((await s.get('/api/dashboard')).body.error.code, 'mfa_enrollment_required');
    const setup = await s.post('/api/auth/mfa/setup').send({});
    assert.ok(setup.body.secret && setup.body.qr.startsWith('data:image/png'));
    const bad = await s.post('/api/auth/mfa/enable').send({ code: '000000' });
    assert.strictEqual(bad.status, 400);
    const code = totp.generate(setup.body.secret);
    assert.strictEqual((await s.post('/api/auth/mfa/enable').send({ code })).status, 200);
    assert.strictEqual((await s.agent.get('/api/dashboard')).status, 200);
    // Secret is encrypted at rest
    const row = await h.db.query("SELECT mfa_secret_enc FROM users WHERE username='super1'");
    assert.ok(row.rows[0].mfa_secret_enc.startsWith('v1.') && !row.rows[0].mfa_secret_enc.includes(setup.body.secret));
    // Next login requires a code
    const s2 = await h.login('super1');
    assert.strictEqual(s2.me.mfaState, 'pending_verify');
    assert.strictEqual((await s2.get('/api/users')).body.error.code, 'mfa_required');
    const v = await s2.post('/api/auth/mfa/verify').send({ code: totp.generate(setup.body.secret) });
    assert.strictEqual(v.status, 200);
    assert.strictEqual((await s2.agent.get('/api/users')).status, 200);
  });

  test('admin-issued reset token works exactly once', async () => {
    const p = await h.login('principal1');
    const uid = (await h.db.query("SELECT id FROM users WHERE username='teacherB'")).rows[0].id;
    const t = await p.post(`/api/users/${uid}/reset-token`).send({});
    const r1 = await h.request().post('/api/auth/reset-password').send({ token: t.body.token, newPassword: 'Reset-Pass-1234' });
    assert.strictEqual(r1.status, 200);
    const r2 = await h.request().post('/api/auth/reset-password').send({ token: t.body.token, newPassword: 'Reset-Pass-5678' });
    assert.strictEqual(r2.body.error.code, 'invalid_or_expired_token');
    await h.login('teacherB', 'Reset-Pass-1234');
    await h.db.query("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE username='teacherA') WHERE username='teacherB'");
  });
});

// ---------------- Authorization / isolation ----------------
test.describe('authorization and student isolation', () => {
  let asmId;
  test.before(async () => {
    // A published and an unpublished assessment for section A math
    const t = await h.login('teacherA');
    const pub = await t.post('/api/assessments').send({ term_id: ids.term, section_id: ids.secA, subject_id: ids.math, category_id: ids.weekly, title: 'Published quiz', max_score: 10 });
    await t.put(`/api/assessments/${pub.body.id}/grades`).send({ rows: ids.students.slice(0, 2).map((s) => ({ student_id: s, score: 8 })) });
    await h.db.query("UPDATE assessments SET status='published' WHERE id=$1", [pub.body.id]);
    const draft = await t.post('/api/assessments').send({ term_id: ids.term, section_id: ids.secA, subject_id: ids.math, category_id: ids.weekly, title: 'Draft quiz', max_score: 10 });
    await t.put(`/api/assessments/${draft.body.id}/grades`).send({ rows: [{ student_id: ids.students[0], score: 2 }] });
    asmId = draft.body.id;
  });

  test('unauthenticated requests are rejected', async () => {
    assert.strictEqual((await h.request().get('/api/students')).status, 401);
    assert.strictEqual((await h.request().get(`/api/reports/student/${ids.students[0]}`)).status, 401);
  });

  test('student sees only own published grades', async () => {
    const s = await h.login('stu1');
    const r = await s.get(`/api/reports/student/${ids.students[0]}`);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.assessments.map((a) => a.title), ['Published quiz']); // draft hidden
    assert.strictEqual(r.body.scope.publishedOnly, true);
  });

  test('student cannot read another student by changing the id (IDOR)', async () => {
    const s = await h.login('stu1');
    for (const other of ids.students.slice(1)) {
      assert.strictEqual((await s.get(`/api/reports/student/${other}`)).status, 404);
      assert.strictEqual((await s.get(`/api/students/${other}`)).status, 404);
      assert.strictEqual((await s.get(`/api/students/${other}/photo`)).status, 404);
      assert.strictEqual((await s.get(`/api/reports/student/${other}?format=csv`)).status, 404);
    }
    assert.strictEqual((await s.get('/api/students')).status, 403);
    assert.strictEqual((await s.get('/api/reports/grades')).status, 403);
    assert.strictEqual((await s.get(`/api/assessments/${asmId}`)).status, 403);
  });

  test('parent role no longer exists', async () => {
    const r = await h.db.query("SELECT count(*)::int n FROM roles WHERE key = 'parent'");
    assert.strictEqual(r.rows[0].n, 0);
    const p = await h.login('principal1');
    const bad = await p.post('/api/users').send({ username: 'someparent', full_name: 'X', roles: ['parent'] });
    assert.strictEqual(bad.status, 400);
  });

  test('teacher is limited to assigned section + subject', async () => {
    const b = await h.login('teacherB');
    assert.strictEqual((await b.get(`/api/assessments/${asmId}`)).status, 404);
    const w = await b.put(`/api/assessments/${asmId}/grades`).send({ rows: [{ student_id: ids.students[0], score: 10 }] });
    assert.strictEqual(w.status, 404);
    const c = await b.post('/api/assessments').send({ term_id: ids.term, section_id: ids.secA, subject_id: ids.math, category_id: ids.weekly, title: 'x', max_score: 10 });
    assert.strictEqual(c.status, 404);
    const eng = await h.login('teacherA');
    const c2 = await eng.post('/api/assessments').send({ term_id: ids.term, section_id: ids.secA, subject_id: ids.eng, category_id: ids.weekly, title: 'x', max_score: 10 });
    assert.strictEqual(c2.status, 404); // teacherA teaches math, not English
    assert.strictEqual((await b.get('/api/students')).status, 403);
    const list = await b.get('/api/assessments');
    assert.ok(list.body.items.every((a) => a.section_id === ids.secB));
    // Teacher B sees reports only for students in their section, scoped to their subjects
    assert.strictEqual((await b.get(`/api/reports/student/${ids.students[0]}`)).status, 404);
    const rb = await b.get(`/api/reports/student/${ids.students[2]}`);
    assert.strictEqual(rb.status, 200); assert.strictEqual(rb.body.scope.teacherScoped, true);
  });

  test('teacher cannot grade a student outside the section', async () => {
    const a = await h.login('teacherA');
    const r = await a.put(`/api/assessments/${asmId}/grades`).send({ rows: [{ student_id: ids.students[3], score: 5, version: null }] });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error.details[0].code, 'student_not_in_section');
  });

  test('auditor is read-only', async () => {
    const a = await h.login('auditor1');
    assert.strictEqual((await a.get('/api/students')).status, 200);
    assert.strictEqual((await a.get('/api/audit')).status, 200);
    assert.strictEqual((await a.post('/api/students').send({ full_name_ckb: 'x' })).status, 403);
    assert.strictEqual((await a.put(`/api/assessments/${asmId}/grades`).send({ rows: [{ student_id: ids.students[0], score: 1 }] })).status, 404);
    assert.strictEqual((await a.post(`/api/assessments/${asmId}/transition`).send({ action: 'approve', version: 1 })).status, 403);
  });

  test('principal cannot create or modify super admins; registrar cannot manage users', async () => {
    const p = await h.login('principal1');
    const r = await p.post('/api/users').send({ username: 'evil', full_name: 'Evil', roles: ['super_admin'] });
    assert.strictEqual(r.body.error.code, 'cannot_assign_privileged_role');
    const sid = (await h.db.query("SELECT id FROM users WHERE username='super1'")).rows[0].id;
    assert.strictEqual((await p.post(`/api/users/${sid}/status`).send({ status: 'disabled' })).body.error.code, 'cannot_manage_privileged_account');
    const reg = await h.login('registrar1');
    assert.strictEqual((await reg.get('/api/users')).status, 403);
    assert.strictEqual((await reg.put('/api/settings/grading').send({})).status, 403);
  });
});

// ---------------- Grades ----------------
test.describe('grade entry, validation, concurrency and workflow', () => {
  let aid; let teacher;
  test.before(async () => {
    teacher = await h.login('teacherA');
    const r = await teacher.post('/api/assessments').send({ term_id: ids.term, section_id: ids.secA, subject_id: ids.math, category_id: ids.exam, title: 'Midterm', max_score: 20 });
    aid = r.body.id;
  });

  test('server rejects out-of-range and malformed scores (no partial save)', async () => {
    for (const bad of [21, -1, 'abc', '', null, '1e400']) {
      const r = await teacher.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: 10 }, { student_id: ids.students[1], score: bad }] });
      assert.strictEqual(r.status, 400, `score ${bad}`);
    }
    const n = await h.db.query('SELECT count(*)::int n FROM grade_records WHERE assessment_id=$1', [aid]);
    assert.strictEqual(n.rows[0].n, 0, 'transaction rolled back');
  });

  test('duplicate grade rows are impossible (unique constraint)', async () => {
    await teacher.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: 15.5 }] });
    await assert.rejects(h.db.query('INSERT INTO grade_records (assessment_id, student_id, score) VALUES ($1,$2,1)', [aid, ids.students[0]]), /duplicate key/);
  });

  test('concurrent edits: second writer with stale version gets 409, nothing lost', async () => {
    const roster = (await teacher.get(`/api/assessments/${aid}`)).body.roster;
    const v = roster.find((r) => r.student_id === ids.students[0]).version;
    const principal = await h.login('principal1');
    const [r1, r2] = await Promise.all([
      teacher.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: 16, version: v }] }),
      principal.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: 12, version: v }] }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepStrictEqual(statuses, [200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    assert.strictEqual(loser.body.error.code, 'grade_conflict');
    const final = await h.db.query('SELECT score, version FROM grade_records WHERE assessment_id=$1 AND student_id=$2', [aid, ids.students[0]]);
    assert.strictEqual(final.rows[0].version, v + 1);
    const hist = await h.db.query('SELECT count(*)::int n FROM grade_record_history h JOIN grade_records g ON g.id=h.grade_record_id WHERE g.assessment_id=$1', [aid]);
    assert.strictEqual(hist.rows[0].n, 1);
  });

  test('new row for a student another user already graded is a conflict, not an overwrite', async () => {
    const r = await teacher.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: 1, version: null }] });
    assert.strictEqual(r.status, 409);
  });

  test('blank score is rejected; clearing must be explicit', async () => {
    const v = (await teacher.get(`/api/assessments/${aid}`)).body.roster.find((r) => r.student_id === ids.students[0]).version;
    const blank = await teacher.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: '', version: v }] });
    assert.strictEqual(blank.status, 400);
    assert.ok((await h.db.query('SELECT 1 FROM grade_records WHERE assessment_id=$1 AND student_id=$2', [aid, ids.students[0]])).rowCount);
  });

  test('cannot submit with ungraded students; missing/excused must be explicit', async () => {
    let a = (await teacher.get(`/api/assessments/${aid}`)).body.assessment;
    const r = await teacher.post(`/api/assessments/${aid}/transition`).send({ action: 'submit', version: a.version });
    assert.strictEqual(r.body.error.code, 'grades_incomplete');
    await teacher.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[1], status: 'excused', score: null }] });
    a = (await teacher.get(`/api/assessments/${aid}`)).body.assessment;
    const ok = await teacher.post(`/api/assessments/${aid}/transition`).send({ action: 'submit', version: a.version });
    assert.strictEqual(ok.status, 200);
  });

  test('submitted grades are locked for teachers', async () => {
    const roster = (await teacher.get(`/api/assessments/${aid}`)).body.roster;
    const row = roster.find((r) => r.student_id === ids.students[0]);
    const r = await teacher.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: 1, version: row.version }] });
    assert.strictEqual(r.body.error.code, 'assessment_locked');
  });

  test('teacher cannot approve own submission; principal approves and publishes; student then sees it', async () => {
    let a = (await teacher.get(`/api/assessments/${aid}`)).body.assessment;
    assert.strictEqual((await teacher.post(`/api/assessments/${aid}/transition`).send({ action: 'approve', version: a.version })).status, 403);
    const p = await h.login('principal1');
    assert.strictEqual((await p.post(`/api/assessments/${aid}/transition`).send({ action: 'approve', version: a.version })).status, 200);
    a = (await p.get(`/api/assessments/${aid}`)).body.assessment;
    assert.strictEqual((await p.post(`/api/assessments/${aid}/transition`).send({ action: 'publish', version: a.version })).status, 200);
    const s = await h.login('stu1');
    const rep = await s.get(`/api/reports/student/${ids.students[0]}`);
    assert.ok(rep.body.assessments.some((x) => x.title === 'Midterm'));
    const notes = await s.get('/api/notifications');
    assert.ok(notes.body.items.some((n) => n.kind === 'grades.published'));
  });

  test('post-publication correction requires a reason and is recorded in history', async () => {
    const p = await h.login('principal1');
    const row = (await p.get(`/api/assessments/${aid}`)).body.roster.find((r) => r.student_id === ids.students[0]);
    const noReason = await p.put(`/api/assessments/${aid}/grades`).send({ rows: [{ student_id: ids.students[0], score: 18, version: row.version }] });
    assert.strictEqual(noReason.body.error.code, 'correction_reason_required');
    const ok = await p.put(`/api/assessments/${aid}/grades`).send({ reason: 'Marking error on Q3', rows: [{ student_id: ids.students[0], score: 18, version: row.version }] });
    assert.strictEqual(ok.status, 200);
    const hist = await p.get(`/api/assessments/${aid}/history`);
    const corr = hist.body.changes.find((c) => c.is_correction);
    assert.strictEqual(corr.reason, 'Marking error on Q3'); assert.strictEqual(corr.new_score, 18);
    assert.ok(hist.body.approvals.some((x) => x.action === 'correct'));
    // Teachers cannot correct published grades
    const t2 = await teacher.put(`/api/assessments/${aid}/grades`).send({ reason: 'mine', rows: [{ student_id: ids.students[0], score: 1, version: row.version + 1 }] });
    assert.strictEqual(t2.status, 403);
  });
});

// ---------------- Input handling / injection ----------------
test.describe('injection and upload safety', () => {
  test('SQL injection payloads in search are treated as data', async () => {
    const p = await h.login('principal1');
    for (const q of ["' OR 1=1 --", "%' ; DROP TABLE students; --", '%', '_']) {
      const r = await p.get(`/api/students?q=${encodeURIComponent(q)}`);
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.total, 0, q);
    }
    assert.strictEqual((await p.get('/api/students?sort=id;drop')).status, 400);
    assert.ok((await h.db.query('SELECT count(*) FROM students')).rows[0].count > 0);
  });

  test('stored XSS payload is returned as inert JSON data; CSV neutralises formulas', async () => {
    const reg = await h.login('registrar1');
    const payload = '<img src=x onerror=alert(1)>';
    const r = await reg.post('/api/students').send({ full_name_ckb: payload, full_name_en: '=HYPERLINK("http://x")', section_id: ids.secA });
    assert.strictEqual(r.status, 201);
    assert.match(r.body.initial_password, /^[A-Za-z2-9]{10}$/);
    const g = await reg.get(`/api/students/${r.body.id}`);
    assert.strictEqual(g.headers['content-type'], 'application/json; charset=utf-8');
    assert.strictEqual(g.body.full_name_ckb, payload);
    const p = await h.login('principal1');
    const csv = await p.get(`/api/reports/section/${ids.secA}?format=csv`);
    assert.ok(csv.text.includes(`'=HYPERLINK`), 'formula prefixed');
  });

  test('upload accepts real images only and serves them only to authorised users', async () => {
    const reg = await h.login('registrar1');
    const sid = ids.students[0];
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const r1 = await reg.agent.post(`/api/students/${sid}/photo`).set('X-CSRF-Token', reg.csrf).attach('photo', html, { filename: 'a.png', contentType: 'image/png' });
    assert.strictEqual(r1.body.error.code, 'unsupported_image');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const r2 = await reg.agent.post(`/api/students/${sid}/photo`).set('X-CSRF-Token', reg.csrf).attach('photo', svg, { filename: 'a.svg', contentType: 'image/svg+xml' });
    assert.strictEqual(r2.status, 400);
    const big = Buffer.alloc(3 * 1024 * 1024, 0);
    const r3 = await reg.agent.post(`/api/students/${sid}/photo`).set('X-CSRF-Token', reg.csrf).attach('photo', big, 'big.jpg');
    assert.strictEqual(r3.status, 413);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const ok = await reg.agent.post(`/api/students/${sid}/photo`).set('X-CSRF-Token', reg.csrf).attach('photo', png, '../../etc/passwd.png');
    assert.strictEqual(ok.status, 200);
    const stored = (await h.db.query('SELECT photo_path FROM students WHERE id=$1', [sid])).rows[0].photo_path;
    assert.match(stored, /^students\/[A-Za-z0-9_-]+\.png$/);
    const own = await (await h.login('stu1')).get(`/api/students/${sid}/photo`);
    assert.strictEqual(own.status, 200); assert.strictEqual(own.headers['content-type'], 'image/png');
    assert.strictEqual((await (await h.login('stu3')).get(`/api/students/${sid}/photo`)).status, 404);
  });

  test('audit log is append-only at the database level', async () => {
    await assert.rejects(h.db.query('UPDATE audit_logs SET action = $1', ['tamper']), /append-only/);
    await assert.rejects(h.db.query('DELETE FROM audit_logs'), /append-only/);
    const p = await h.login('principal1');
    const r = await p.get('/api/audit?action=grades.correct');
    assert.ok(r.body.items.length >= 1);
  });

  test('settings are validated server-side', async () => {
    const sa = await h.mkUser('super2', ['super_admin']);
    await h.db.query(`UPDATE system_settings SET value = jsonb_set(value, '{mfa_required_roles}', '[]') WHERE key='security'`);
    require('../src/lib/settings').invalidateSettings();
    const s = await h.login('super2');
    const bad = await s.put('/api/settings/grading').send({ mode: 'magic' });
    assert.strictEqual(bad.status, 400);
    const badSec = await s.put('/api/settings/security').send({ mfa_required_roles: [], session_idle_minutes: 30, session_absolute_hours: 12, max_failed_logins: 5, lockout_minutes: 15 });
    assert.strictEqual(badSec.status, 400, 'super_admin MFA cannot be turned off');
    assert.ok(sa);
  });
});

// ---------------- Bulk import ----------------
test.describe('bulk import', () => {
  test('preview reports per-row errors; commit is all-or-nothing', async () => {
    const reg = await h.login('registrar1');
    const rows = [
      { full_name_ckb: 'هێمن', grade_level: 10, section: 'A', gender: 'Male' },
      { full_name_ckb: '', grade_level: 10, section: 'A' },
      { full_name_ckb: 'دیار', grade_level: 10, section: 'Z' },
    ];
    const pv = await reg.post('/api/students/import/preview').send({ yearId: ids.year, rows });
    assert.strictEqual(pv.body.valid, 1); assert.strictEqual(pv.body.invalid, 2);
    const before = (await h.db.query('SELECT count(*)::int n FROM students')).rows[0].n;
    const bad = await reg.post('/api/students/import/commit').send({ yearId: ids.year, rows });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await h.db.query('SELECT count(*)::int n FROM students')).rows[0].n, before);
    const ok = await reg.post('/api/students/import/commit').send({ yearId: ids.year, rows: [rows[0], { full_name_ckb: 'دیار', grade_level: 10, section: 'b' }] });
    assert.strictEqual(ok.status, 201); assert.strictEqual(ok.body.created.length, 2);
    assert.ok(ok.body.created.every((c) => c.initial_password && c.username.startsWith('DPS-')));
  });
});

test.describe('rate limiting', () => {
  test('repeated logins for one account are throttled with 429 (per IP+username)', async () => {
    process.env.TEST_RATE_LIMIT = '1';
    try {
      let last;
      for (let i = 0; i < 12; i++) last = await h.request().post('/api/auth/login').send({ username: 'ratelimited-user', password: 'x' });
      assert.strictEqual(last.status, 429);
      // A different account from the same IP is not blocked by the per-account limiter.
      const other = await h.request().post('/api/auth/login').send({ username: 'someone-else', password: 'x' });
      assert.strictEqual(other.status, 401);
    } finally { delete process.env.TEST_RATE_LIMIT; }
  });
});

test.describe('analysis and approvals inbox', () => {
  test('analytics: averages match the grading engine; at-risk list; teacher sees only own classes', async () => {
    const p = await h.login('principal1');
    const r = await p.get('/api/analytics');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.kpis.students >= 4);
    // Each at-risk student must really have a failed subject on their own report card.
    for (const s of r.body.at_risk) {
      assert.ok(s.subjects_failed > 0 && s.failed_subjects.length === s.subjects_failed);
      const card = await p.get(`/api/reports/student/${s.id}`);
      assert.strictEqual(card.body.overall_percent, s.overall_percent);
    }
    const bandTotal = r.body.bands.reduce((a, b) => a + b.count, 0);
    assert.strictEqual(bandTotal, r.body.kpis.graded);
    const t = await h.login('teacherB');
    const tr = await t.get('/api/analytics');
    assert.strictEqual(tr.status, 200);
    assert.strictEqual(tr.body.scope.teacher, true);
    assert.ok(tr.body.sections.every((s) => s.id === ids.secB));
    const stu = await h.login('stu1');
    assert.strictEqual((await stu.get('/api/analytics')).status, 403);
  });

  test('attention list and bulk approve + publish', async () => {
    const t = await h.login('teacherA');
    const a = (await t.post('/api/assessments').send({ term_id: ids.term, section_id: ids.secA, subject_id: ids.math, category_id: ids.weekly, title: 'Bulk test', max_score: 10 })).body;
    const roster = (await t.get(`/api/assessments/${a.id}`)).body.roster;
    await t.put(`/api/assessments/${a.id}/grades`).send({ rows: roster.map((r) => ({ student_id: r.student_id, score: 9 })) });
    const fresh = (await t.get(`/api/assessments/${a.id}`)).body.assessment;
    await t.post(`/api/assessments/${a.id}/transition`).send({ action: 'submit', version: fresh.version });
    const p = await h.login('principal1');
    const att = await p.get('/api/analytics/attention');
    assert.ok(att.body.items.awaiting_approval >= 1);
    const inbox = await p.get('/api/assessments?status=submitted');
    const row = inbox.body.items.find((x) => x.id === a.id);
    assert.strictEqual(row.submitted_by, 'teacherA'); assert.strictEqual(Number(row.avg_percent), 90); assert.strictEqual(row.below_pass, 0);
    assert.strictEqual((await t.post('/api/assessments/bulk-approve').send({ ids: [a.id] })).status, 403); // teachers cannot approve
    const sub = await t.get(`/api/assessments/${a.id}`); assert.strictEqual(sub.body.assessment.status, 'submitted');
    const r = await p.post('/api/assessments/bulk-approve').send({ ids: [a.id, 999999], publish: true });
    assert.deepStrictEqual(r.body.done, [a.id]);
    assert.strictEqual(r.body.skipped[0].id, 999999);
    assert.strictEqual((await p.get(`/api/assessments/${a.id}`)).body.assessment.status, 'published');
    const s = await h.login('stu1');
    assert.ok((await s.get(`/api/reports/student/${ids.students[0]}`)).body.assessments.some((x) => x.title === 'Bulk test'));
  });
});

test.describe('account types managed by the super administrator', () => {
  let sa;
  test.before(async () => {
    await h.mkUser('super3', ['super_admin']);
    await h.db.query(`UPDATE system_settings SET value = jsonb_set(value, '{mfa_required_roles}', '[]') WHERE key='security'`);
    require('../src/lib/settings').invalidateSettings();
    sa = await h.login('super3');
  });

  test('only the super administrator can manage account types', async () => {
    const p = await h.login('principal1');
    assert.strictEqual((await p.get('/api/roles')).status, 403);
    const r = await sa.get('/api/roles');
    assert.strictEqual(r.status, 200);
    const principal = r.body.items.find((x) => x.key === 'principal');
    assert.strictEqual(principal.sections.students, 'manage');
    assert.ok(r.body.items.find((x) => x.key === 'super_admin').locked);
    assert.ok(!r.body.items.some((x) => x.key === 'parent'));
  });

  test('custom type: sections control real API access (hidden / view / manage)', async () => {
    const c = await sa.post('/api/roles').send({ name_en: 'Secretary', name_ckb: 'سکرتێر', sections: { students: 'view', results: 'view' } });
    assert.strictEqual(c.status, 201);
    const key = c.body.key;
    // A principal cannot hand out custom types; the super admin can.
    const p = await h.login('principal1');
    assert.strictEqual((await p.post('/api/users').send({ username: 'sec1', full_name: 'Sec', roles: [key] })).body.error.code, 'cannot_assign_privileged_role');
    const u = await sa.post('/api/users').send({ username: 'sec1', full_name: 'Sec', roles: [key] });
    assert.strictEqual(u.status, 201);
    await h.db.query("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE username='principal1'), must_change_password=false WHERE username='sec1'");
    let s = await h.login('sec1');
    assert.strictEqual((await s.get('/api/students')).status, 200);
    assert.strictEqual((await s.post('/api/students').send({ full_name_ckb: 'x' })).status, 403);   // view only
    assert.strictEqual((await s.get('/api/analytics')).status, 200);
    assert.strictEqual((await s.get('/api/assessments')).status, 403);                               // section hidden
    // Upgrade students to manage, hide results.
    const upd = await sa.put(`/api/roles/${key}`).send({ name_en: 'Secretary', name_ckb: 'سکرتێر', sections: { students: 'manage', results: 'hidden' } });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual((await s.agent.get('/api/students')).status, 401, 'changing a type signs its users out');
    s = await h.login('sec1');
    assert.strictEqual((await s.post('/api/students').send({ full_name_ckb: 'From secretary' })).status, 201);
    assert.strictEqual((await s.get('/api/analytics')).status, 403);
    // Suspend: signed out and cannot sign in.
    await sa.post(`/api/roles/${key}/status`).send({ active: false });
    assert.strictEqual((await s.agent.get('/api/students')).status, 401);
    const blocked = await h.request().post('/api/auth/login').send({ username: 'sec1', password: h.PW });
    assert.strictEqual(blocked.body.error.code, 'account_type_suspended');
    await sa.post(`/api/roles/${key}/status`).send({ active: true });
    await h.login('sec1');
    // Delete is refused while users have it, allowed after.
    assert.strictEqual((await sa.delete(`/api/roles/${key}`)).body.error.code, 'role_has_users');
    const uid = (await h.db.query("SELECT id FROM users WHERE username='sec1'")).rows[0].id;
    await sa.put(`/api/users/${uid}/roles`).send({ roles: ['auditor'] });
    assert.strictEqual((await sa.delete(`/api/roles/${key}`)).status, 200);
  });

  test('locked and built-in types are protected; invalid levels rejected', async () => {
    assert.strictEqual((await sa.put('/api/roles/super_admin').send({ name_en: 'x', name_ckb: 'x', sections: {} })).body.error.code, 'role_locked');
    assert.strictEqual((await sa.put('/api/roles/student').send({ name_en: 'x', name_ckb: 'x', sections: { students: 'manage' } })).body.error.code, 'role_locked');
    assert.strictEqual((await sa.post('/api/roles/super_admin/status').send({ active: false })).body.error.code, 'role_locked');
    assert.strictEqual((await sa.delete('/api/roles/teacher')).body.error.code, 'cannot_delete_builtin_role');
    assert.strictEqual((await sa.post('/api/roles').send({ name_en: 'X', name_ckb: 'X', sections: { approvals: 'view' } })).body.error.code, 'invalid_level');
    // Built-in types can be adjusted, e.g. registrar loses Results.
    const reg = (await sa.get('/api/roles')).body.items.find((x) => x.key === 'registrar');
    const r = await sa.put('/api/roles/registrar').send({ name_en: reg.name_en, name_ckb: reg.name_ckb, sections: { ...reg.sections, home: 'hidden' } });
    assert.strictEqual(r.status, 200);
    const rs = await h.login('registrar1');
    assert.strictEqual((await rs.get('/api/dashboard')).status, 403);
    await sa.put('/api/roles/registrar').send({ name_en: reg.name_en, name_ckb: reg.name_ckb, sections: reg.sections });
  });
});
