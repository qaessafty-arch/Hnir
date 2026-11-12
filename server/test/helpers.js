'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://darwaza:devpass@localhost:5432/darwaza_test';
process.env.APP_ENCRYPTION_KEY = 'test-key-0123456789abcdef0123456789abcdef';
process.env.UPLOAD_DIR = require('path').resolve(__dirname, '../data/test-uploads');

const request = require('supertest');
const db = require('../src/lib/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/lib/passwords');
const { invalidateSettings } = require('../src/lib/settings');

const PW = 'Correct-Horse-9';
let app;

async function resetDb() {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await db.query(`UPDATE system_settings SET value = jsonb_set(value, '{mfa_required_roles}', '["super_admin"]') WHERE key='security'`);
  invalidateSettings();
  app = createApp();
  return app;
}

let hashCache;
async function mkUser(username, roles, { mustChange = false } = {}) {
  hashCache ??= await hashPassword(PW);
  const u = await db.query(`INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1,$1,$2,$3) RETURNING id`, [username, hashCache, mustChange]);
  await db.query('INSERT INTO user_roles SELECT $1, id FROM roles WHERE key = ANY($2)', [u.rows[0].id, roles]);
  return u.rows[0].id;
}

/** Build a small school: 1 year, 1 term, 2 sections, 2 teachers, 4 students, 1 parent. */
async function fixture() {
  const ids = {};
  ids.principal = await mkUser('principal1', ['principal']);
  ids.registrar = await mkUser('registrar1', ['registrar']);
  ids.auditor = await mkUser('auditor1', ['auditor']);
  ids.superadmin = await mkUser('super1', ['super_admin']);
  ids.year = (await db.query(`INSERT INTO academic_years (name, starts_on, ends_on, is_current) VALUES ('2026-2027','2026-09-01','2027-06-30',true) RETURNING id`)).rows[0].id;
  ids.term = (await db.query(`INSERT INTO terms (academic_year_id, name_en, name_ckb, ordinal, starts_on, ends_on) VALUES ($1,'Term 1','وەرزی ١',1,'2026-09-01','2027-01-31') RETURNING id`, [ids.year])).rows[0].id;
  const cls = (await db.query('SELECT id FROM classes WHERE grade_level = 10')).rows[0].id;
  ids.secA = (await db.query(`INSERT INTO sections (class_id, academic_year_id, name) VALUES ($1,$2,'A') RETURNING id`, [cls, ids.year])).rows[0].id;
  ids.secB = (await db.query(`INSERT INTO sections (class_id, academic_year_id, name) VALUES ($1,$2,'B') RETURNING id`, [cls, ids.year])).rows[0].id;
  ids.math = (await db.query("SELECT id FROM subjects WHERE code='MTH'")).rows[0].id;
  ids.eng = (await db.query("SELECT id FROM subjects WHERE code='ENG'")).rows[0].id;
  ids.weekly = (await db.query("SELECT id FROM assessment_categories WHERE code='weekly'")).rows[0].id;
  ids.exam = (await db.query("SELECT id FROM assessment_categories WHERE code='exam'")).rows[0].id;
  for (const t of ['teacherA', 'teacherB']) {
    const uid = await mkUser(t, ['teacher']);
    ids[t + 'User'] = uid;
    ids[t] = (await db.query(`INSERT INTO teachers (user_id, staff_no) VALUES ($1,$2) RETURNING id`, [uid, t])).rows[0].id;
  }
  await db.query('INSERT INTO teacher_assignments (teacher_id, section_id, subject_id, academic_year_id) VALUES ($1,$2,$3,$4)', [ids.teacherA, ids.secA, ids.math, ids.year]);
  await db.query('INSERT INTO teacher_assignments (teacher_id, section_id, subject_id, academic_year_id) VALUES ($1,$2,$3,$4)', [ids.teacherB, ids.secB, ids.math, ids.year]);
  ids.students = [];
  for (let i = 1; i <= 4; i++) {
    const uid = await mkUser(`stu${i}`, ['student']);
    const s = await db.query(`INSERT INTO students (user_id, student_no, full_name_ckb) VALUES ($1,$2,$3) RETURNING id`, [uid, `stu${i}`, `قوتابی ${i}`]);
    await db.query('INSERT INTO enrollments (student_id, section_id, academic_year_id) VALUES ($1,$2,$3)', [s.rows[0].id, i <= 2 ? ids.secA : ids.secB, ids.year]);
    ids.students.push(s.rows[0].id);
  }
  const pu = await mkUser('parent1', ['parent']);
  const p = await db.query('INSERT INTO parents (user_id) VALUES ($1) RETURNING id', [pu]);
  ids.parentId = p.rows[0].id;
  await db.query('INSERT INTO guardian_student_relationships (parent_id, student_id, verified_at) VALUES ($1,$2,now())', [p.rows[0].id, ids.students[0]]);
  // Unverified link to student 2: must NOT grant access.
  await db.query('INSERT INTO guardian_student_relationships (parent_id, student_id) VALUES ($1,$2)', [p.rows[0].id, ids.students[1]]);
  return ids;
}

/** A logged-in client that automatically sends the CSRF header. */
async function login(username, password = PW) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  const me = await agent.get('/api/auth/me');
  const csrf = me.body.csrfToken;
  const wrap = (m) => (url) => agent[m](url).set('X-CSRF-Token', csrf || '');
  return { agent, csrf, me: me.body, get: (u) => agent.get(u), post: wrap('post'), put: wrap('put'), delete: wrap('delete'), patch: wrap('patch') };
}

module.exports = { resetDb, fixture, login, mkUser, PW, db, request: () => request(app), getApp: () => app };
