'use strict';
/**
 * DEMO / TEST DATA ONLY. Refuses to run when NODE_ENV is production or staging.
 *   node scripts/seed-demo.js [studentsCount=60] [--password=Passw0rd!demo]
 * All demo accounts share one known password and do NOT require a password change — never use in production.
 */
const config = require('../src/lib/config');
const db = require('../src/lib/db');
const { migrate } = require('../src/migrate');
const { hashPassword } = require('../src/lib/passwords');

// A disposable public TEST instance may opt in explicitly; real production never sets this flag.
const allowDemo = process.env.ALLOW_DEMO_SEED === 'yes-this-is-a-disposable-test-instance';
if (config.isProd && !allowDemo) { console.error('Refusing to seed demo data in production/staging.'); process.exit(1); }

const FIRST = ['ئاریان', 'سارا', 'ڕاز', 'ئالان', 'هێڤی', 'دانا', 'شیلان', 'کاروان', 'ڕۆژان', 'بەهار', 'ئازاد', 'نازدار', 'هاوڕێ', 'ژیلا', 'سۆران', 'دیلان'];
const LAST = ['کەمال', 'ئەحمەد', 'ڕێبوار', 'سامان', 'عومەر', 'حەسەن', 'محەمەد', 'عەلی', 'جەمال', 'فەرهاد'];
const FIRST_EN = ['Aryan', 'Sara', 'Raz', 'Alan', 'Hevi', 'Dana', 'Shilan', 'Karwan', 'Rozhan', 'Bahar', 'Azad', 'Nazdar', 'Hawre', 'Zhila', 'Soran', 'Dilan'];
const LAST_EN = ['Kamal', 'Ahmed', 'Rebwar', 'Saman', 'Omar', 'Hasan', 'Mohammed', 'Ali', 'Jamal', 'Farhad'];

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
    let firstStudentUser;
    for (let i = 0; i < n; i++) {
      const no = (await c.query(`SELECT 'DPS-2026-' || lpad(nextval('student_no_seq')::text,4,'0') AS no`)).rows[0].no;
      const fi = i % FIRST.length, li = (i * 7) % LAST.length;
      const u = await c.query(`INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1,$2,$3,false) RETURNING id`,
        [no, `${FIRST[fi]} ${LAST[li]}`, hash]);
      await c.query('INSERT INTO user_roles VALUES ($1,$2)', [u.rows[0].id, studentRole]);
      firstStudentUser ??= u.rows[0].id;
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
    // A parent linked to the first student.
    const pu = await mkUser('demo.parent', 'Demo Parent', 'parent');
    const p = await c.query('INSERT INTO parents (user_id) VALUES ($1) RETURNING id', [pu]);
    const firstStudent = (await c.query('SELECT id FROM students WHERE user_id=$1', [firstStudentUser])).rows[0].id;
    await c.query("INSERT INTO guardian_student_relationships (parent_id, student_id, relationship, verified_at) VALUES ($1,$2,'father',now())", [p.rows[0].id, firstStudent]);
  });
  // Demo accounts skip MFA enrolment so local testing is quick.
  await db.query(`UPDATE system_settings SET value = jsonb_set(value, '{mfa_required_roles}', '[]') WHERE key='security'`);
  console.log(`Demo data created: ${n} students. All demo accounts use password "${password}". MFA requirement disabled for demo.`);
  await db.pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(e.already ? 0 : 1); });
