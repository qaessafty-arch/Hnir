'use strict';
/**
 * DEMO / TEST DATA ONLY. Refuses to run when NODE_ENV is production or staging.
 *   node scripts/seed-demo.js [studentsCount=60] [--password=Passw0rd!demo]
 * All demo accounts share one known password and do NOT require a password change — never use in production.
 */
const config = require('../src/lib/config');
const db = require('../src/lib/db');
const { nextStudentNo } = require('../src/lib/accounts');
const { migrate } = require('../src/migrate');
const { hashPassword } = require('../src/lib/passwords');

// A disposable public TEST instance may opt in explicitly; real production never sets this flag.
const allowDemo = process.env.ALLOW_DEMO_SEED === 'yes-this-is-a-disposable-test-instance';
if (config.isProd && !allowDemo) { console.error('Refusing to seed demo data in production/staging.'); process.exit(1); }

const FIRST = ['ئاریان', 'سارا', 'ڕاز', 'ئالان', 'هێڤی', 'دانا', 'شیلان', 'کاروان', 'ڕۆژان', 'بەهار', 'ئازاد', 'نازدار', 'هاوڕێ', 'ژیلا', 'سۆران', 'دیلان'];
const LAST = ['کەمال', 'ئەحمەد', 'ڕێبوار', 'سامان', 'عومەر', 'حەسەن', 'محەمەد', 'عەلی', 'جەمال', 'فەرهاد'];
const FIRST_EN = ['Aryan', 'Sara', 'Raz', 'Alan', 'Hevi', 'Dana', 'Shilan', 'Karwan', 'Rozhan', 'Bahar', 'Azad', 'Nazdar', 'Hawre', 'Zhila', 'Soran', 'Dilan'];
const LAST_EN = ['Kamal', 'Ahmed', 'Rebwar', 'Saman', 'Omar', 'Hasan', 'Mohammed', 'Ali', 'Jamal', 'Farhad'];

/** Demo-only additions that may be missing from older demo databases (safe to run repeatedly). */
// Demo-only fixed 4-digit sign-in codes so testers (and e2e/smoke.js) know them. Real accounts get random codes.
const DEMO_CODES = {
  'demo.admin': '4721', 'demo.principal': '3958', 'demo.registrar': '6204', 'demo.auditor': '8137',
  'demo.teacher1': '2546', 'demo.teacher2': '7319', 'demo.teacher3': '5082', 'demo.teacher4': '9463', 'demo.teacher5': '1675', 'demo.teacher6': '6830',
};
const DEMO_FIRST_STUDENT = 'DAR-2741'; // the first demo student (used by e2e tests)

async function demoLoginCodes() {
  const { loginCodeHash } = require('../src/lib/crypto');
  if (!(await db.query("SELECT 1 FROM users WHERE username = 'demo.admin'")).rowCount) return;
  await db.tx(async (c) => {
    // A demo student whose ID collides with a demo staff code (or with the fixed first-student ID) gets a new random ID.
    const reserved = [...Object.values(DEMO_CODES).map((d) => `DAR-${d}`), DEMO_FIRST_STUDENT];
    const first = (await c.query('SELECT id, user_id, student_no FROM students ORDER BY id LIMIT 1')).rows[0];
    const clash = await c.query('SELECT id, user_id FROM students WHERE student_no = ANY($1::text[]) AND id <> $2', [reserved, first?.id ?? 0]);
    for (const r of clash.rows) {
      const tmp = `TMP-${r.id}`;
      await c.query('UPDATE students SET student_no = $2 WHERE id = $1', [r.id, tmp]);
      await c.query('UPDATE users SET username = $2 WHERE id = $1', [r.user_id, tmp]);
    }
    for (const r of clash.rows) {
      let no; do { no = await nextStudentNo(c); } while (reserved.includes(no));
      await c.query('UPDATE students SET student_no = $2 WHERE id = $1', [r.id, no]);
      await c.query('UPDATE users SET username = $2 WHERE id = $1', [r.user_id, no]);
    }
    if (first && first.student_no !== DEMO_FIRST_STUDENT) {
      await c.query('UPDATE students SET student_no = $2 WHERE id = $1', [first.id, DEMO_FIRST_STUDENT]);
      await c.query('UPDATE users SET username = $2 WHERE id = $1', [first.user_id, DEMO_FIRST_STUDENT]);
    }
    for (const [username, code] of Object.entries(DEMO_CODES)) {
      await c.query('UPDATE users SET login_code_hash = $2, login_code_set_at = now() WHERE username = $1 AND login_code_hash IS DISTINCT FROM $2',
        [username, loginCodeHash(code)]);
    }
  });
  console.log(`Demo sign-in: first student ${DEMO_FIRST_STUDENT}; staff codes ${Object.entries(DEMO_CODES).map(([u, d]) => `${u.slice(5)}=${d}`).join(', ')}`);
}

async function topUpDemo() {
  await demoLoginCodes();
  // Demo teacher comments on untouched demo grades (version 1, seeded or entered by a demo teacher; demo databases only). Deterministic, so re-runs change nothing.
  const c = await db.query(
    `UPDATE grade_records g SET comment = CASE
        WHEN g.score / a.max_score >= 0.9 THEN 'کارێکی نایاب، بەردەوام بە'
        WHEN g.score / a.max_score >= 0.7 THEN 'باشە، دەتوانیت باشتریش بیت'
        WHEN g.score / a.max_score >= 0.5 THEN 'پێویستی بە ڕاهێنانی زیاتر هەیە'
        ELSE 'تکایە زیاتر هەوڵ بدە و پرسیار بکە' END
       FROM assessments a
      WHERE a.id = g.assessment_id
        AND EXISTS (SELECT 1 FROM users WHERE username = 'demo.admin')
        AND (g.entered_by IS NULL OR g.entered_by IN (SELECT id FROM users WHERE username LIKE 'demo.teacher%'))
        AND g.comment IS NULL AND g.version = 1 AND g.status = 'graded'
        AND (g.score / a.max_score < 0.5 OR g.id % 3 <> 0)`);
  if (c.rowCount) console.log(`Demo teacher comments added: ${c.rowCount}.`);
  const has = (await db.query('SELECT count(*)::int n FROM behavior_evaluations')).rows[0].n;
  if (has > 0) return;
  const ratings = ['excellent', 'very_good', 'very_good', 'good', 'good', 'average', 'needs_improvement'];
  await db.query(
    `INSERT INTO behavior_evaluations (student_id, term_id, week_no, rating, comment, status)
     SELECT e.student_id, t.id, w, ($1::text[])[1 + ((e.student_id * 3 + w * 5) % 7)], NULL, 'published'
       FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
       JOIN terms t ON t.academic_year_id = y.id AND t.ordinal = 1
       CROSS JOIN generate_series(1, 2) AS w
      WHERE e.status = 'active'
     ON CONFLICT DO NOTHING`, [ratings]);
  console.log('Demo behavior evaluations added.');
}

async function main() {
  const n = Number(process.argv.find((a) => /^\d+$/.test(a)) || 60);
  const pwArg = process.argv.find((a) => a.startsWith('--password='));
  const password = pwArg ? pwArg.split('=')[1] : 'Passw0rd!demo';
  await migrate();
  const hash = await hashPassword(password);
  await db.tx(async (c) => {
    if ((await c.query("SELECT 1 FROM users WHERE username = 'demo.admin'")).rowCount) throw Object.assign(new Error('Demo data already seeded'), { already: true });
    const role = async (key) => (await c.query('SELECT id FROM roles WHERE key=$1', [key])).rows[0].id;
    const mkUser = async (username, full, roleKey) => {
      const u = await c.query(`INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1,$2,$3,false) RETURNING id`, [username, full, hash]);
      await c.query('INSERT INTO user_roles VALUES ($1,$2)', [u.rows[0].id, await role(roleKey)]);
      return u.rows[0].id;
    };
    await mkUser('demo.admin', 'Demo Super Admin', 'super_admin');
    await mkUser('demo.principal', 'Demo Principal', 'principal');
    await mkUser('demo.registrar', 'Demo Registrar', 'registrar');
    await mkUser('demo.auditor', 'Demo Auditor', 'auditor');
    const y = (await c.query(`INSERT INTO academic_years (name, starts_on, ends_on, is_current) VALUES ('2026-2027','2026-09-01','2027-06-30', true) RETURNING id`)).rows[0].id;
    const t1 = (await c.query(`INSERT INTO terms (academic_year_id, name_en, name_ckb, ordinal, starts_on, ends_on) VALUES ($1,'Term 1','وەرزی یەکەم',1,'2026-09-01','2027-01-20') RETURNING id`, [y])).rows[0].id;
    await c.query(`INSERT INTO terms (academic_year_id, name_en, name_ckb, ordinal, starts_on, ends_on) VALUES ($1,'Term 2','وەرزی دووەم',2,'2027-02-01','2027-06-30')`, [y]);
    const subjects = (await c.query('SELECT id, default_max_score FROM subjects ORDER BY sort_order')).rows;
    const weekly = (await c.query("SELECT id FROM assessment_categories WHERE code='weekly'")).rows[0].id;
    const teachers = [];
    for (let i = 1; i <= 6; i++) {
      const uid = await mkUser(`demo.teacher${i}`, `Demo Teacher ${i}`, 'teacher');
      teachers.push((await c.query(`INSERT INTO teachers (user_id, staff_no) VALUES ($1, 'STF-' || lpad(nextval('staff_no_seq')::text,4,'0')) RETURNING id`, [uid])).rows[0].id);
    }
    const sections = [];
    for (const g of [9, 10, 11, 12]) {
      for (const name of ['A', 'B']) {
        const cls = (await c.query('SELECT id FROM classes WHERE grade_level=$1', [g])).rows[0].id;
        sections.push((await c.query('INSERT INTO sections (class_id, academic_year_id, name, homeroom_teacher_id) VALUES ($1,$2,$3,$4) RETURNING id',
          [cls, y, name, teachers[sections.length % teachers.length]])).rows[0].id);
      }
    }
    // Teacher i teaches a rotating set of subjects in every section.
    for (const [si, sec] of sections.entries()) {
      for (const [ji, sub] of subjects.entries()) {
        await c.query('INSERT INTO teacher_assignments (teacher_id, section_id, subject_id, academic_year_id) VALUES ($1,$2,$3,$4)',
          [teachers[(si + ji) % teachers.length], sec, sub.id, y]);
      }
    }
    const studentRole = await role('student');
    for (let i = 0; i < n; i++) {
      const no = await nextStudentNo(c);
      const fi = i % FIRST.length, li = (i * 7) % LAST.length;
      const u = await c.query(`INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1,$2,$3,false) RETURNING id`,
        [no, `${FIRST[fi]} ${LAST[li]}`, hash]);
      await c.query('INSERT INTO user_roles VALUES ($1,$2)', [u.rows[0].id, studentRole]);
      const s = await c.query(`INSERT INTO students (user_id, student_no, full_name_ckb, full_name_en, gender) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [u.rows[0].id, no, `${FIRST[fi]} ${LAST[li]}`, `${FIRST_EN[fi]} ${LAST_EN[li]}`, i % 2 ? 'female' : 'male']);
      await c.query('INSERT INTO enrollments (student_id, section_id, academic_year_id) VALUES ($1,$2,$3)', [s.rows[0].id, sections[i % sections.length], y]);
    }
    // Two published weekly assessments per section/subject with realistic scores.
    let rnd = 42;
    const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
    for (const sec of sections) {
      const roster = (await c.query("SELECT student_id FROM enrollments WHERE section_id=$1 AND status='active'", [sec])).rows;
      for (const sub of subjects) {
        for (const week of [1, 2]) {
          const a = await c.query(
            `INSERT INTO assessments (term_id, section_id, subject_id, category_id, title, week_no, max_score, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'published') RETURNING id`, [t1, sec, sub.id, weekly, `Week ${week}`, week, sub.default_max_score]);
          for (const r of roster) {
            const score = Math.round(Math.min(1, 0.35 + rand() * 0.7) * sub.default_max_score * 2) / 2;
            await c.query('INSERT INTO grade_records (assessment_id, student_id, score, status) VALUES ($1,$2,$3,$4)', [a.rows[0].id, r.student_id, score, 'graded']);
          }
        }
      }
    }
  });
  await topUpDemo();
  // Demo accounts skip MFA enrolment so local testing is quick.
  await db.query(`UPDATE system_settings SET value = jsonb_set(value, '{mfa_required_roles}', '[]') WHERE key='security'`);
  console.log(`Demo data created: ${n} students. All demo accounts use password "${password}". MFA requirement disabled for demo.`);
  await db.pool.end();
}
main().catch(async (e) => {
  if (e.already) { console.error(e.message); try { await topUpDemo(); } finally { await db.pool.end().catch(() => {}); } process.exit(0); }
  console.error(e.message); process.exit(1);
});
