'use strict';
/**
 * Import data from the ORIGINAL single-file system (browser localStorage) into PostgreSQL.
 *
 * 1. On each computer that used the old page, open it, press F12 → Console, and run:
 *      copy(JSON.stringify({ students: JSON.parse(localStorage.darwaza_students||'[]'), grades: JSON.parse(localStorage.darwaza_grades||'[]') }))
 *    Paste into a file, e.g. legacy-export.json.
 * 2. Run:  node scripts/import-legacy.js legacy-export.json --year=2026-2027 --term=1 [--dry-run]
 *
 * Mapping:
 *  - Each legacy student becomes a student + login account. The legacy "secret code" becomes their initial
 *    password (hashed with argon2id) and must be changed at first login. Username = new student ID.
 *    The legacy code is also kept in students.legacy_code for traceability.
 *  - Students are enrolled in section "A" of their legacy grade level (created if missing) in the given year.
 *  - Each legacy (subject, week) becomes one PUBLISHED weekly assessment per section, max score as recorded.
 *    Legacy grades were visible to students immediately, so they stay visible (published).
 *  - Legacy notes become grade comments. Photos (base64 data URLs) are validated and stored as files.
 *  - Re-running is safe: students whose legacy_code already exists are skipped.
 *  - Everything runs in ONE transaction: either all data is imported or nothing is.
 */
const fs = require('fs');
const db = require('../src/lib/db');
const { migrate } = require('../src/migrate');
const { hashPassword } = require('../src/lib/passwords');
const { nextStudentNo } = require('../src/lib/accounts');
const { storeImage } = require('../src/lib/images');

const SUBJECT_MAP = { Behavior: 'BEH', English: 'ENG', Math: 'MTH', Science: 'SCI', Kurdish: 'KUR', Religion: 'REL', Arabic: 'ARA',
  Social: 'SOC', 'Soc. Value': 'VAL', IT: 'ICT', Art: 'ART', Sport: 'PE', Music: 'MUS' };

function arg(name, def) { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : def; }

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/import-legacy.js <export.json> --year=2026-2027 --term=1 [--dry-run]'); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dry = process.argv.includes('--dry-run');
  const yearName = arg('year'); const termOrd = Number(arg('term', '1'));
  if (!yearName) throw new Error('--year is required');
  await migrate();
  const report = { students_created: 0, students_skipped: 0, assessments: 0, grades: 0, warnings: [] };
  const credentials = [];
  try {
    await db.tx(async (c) => {
      const year = (await c.query('SELECT id FROM academic_years WHERE name = $1', [yearName])).rows[0];
      if (!year) throw new Error(`Academic year ${yearName} not found — create it first`);
      const term = (await c.query('SELECT id FROM terms WHERE academic_year_id = $1 AND ordinal = $2', [year.id, termOrd])).rows[0];
      if (!term) throw new Error(`Term ${termOrd} not found in ${yearName}`);
      const weekly = (await c.query("SELECT id FROM assessment_categories WHERE code='weekly'")).rows[0].id;
      const studentRole = (await c.query("SELECT id FROM roles WHERE key='student'")).rows[0].id;
      const byCode = new Map();
      for (const s of data.students || []) {
        const code = String(s.code || '').trim();
        if (!code || !s.name) { report.warnings.push(`skipped student without code/name: ${JSON.stringify(s).slice(0, 80)}`); continue; }
        const existing = await c.query('SELECT id FROM students WHERE legacy_code = $1', [code]);
        const grade = Math.min(12, Math.max(1, Number(s.gradeClass) || 1));
        let sec = (await c.query(`SELECT s.id FROM sections s JOIN classes cl ON cl.id = s.class_id WHERE cl.grade_level=$1 AND s.academic_year_id=$2 AND s.name='A'`, [grade, year.id])).rows[0];
        if (!sec) sec = (await c.query(`INSERT INTO sections (class_id, academic_year_id, name) SELECT id, $2, 'A' FROM classes WHERE grade_level=$1 RETURNING id`, [grade, year.id])).rows[0];
        if (existing.rowCount) { byCode.set(code, { id: existing.rows[0].id, section: sec.id }); report.students_skipped++; continue; }
        // Legacy names look like "ئالان کەمال (Alan Kamal)" — split the Latin part out.
        const m = String(s.name).match(/^(.*?)\s*\(([^)]*[A-Za-z][^)]*)\)\s*$/);
        const ckb = (m ? m[1] : s.name).trim(); const en = m ? m[2].trim() : null;
        const no = await nextStudentNo(c);
        const pw = code.length >= 6 ? code : `${code}-${no.slice(-4)}`;
        const u = await c.query(`INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1,$2,$3,true) RETURNING id`, [no, ckb, await hashPassword(pw)]);
        await c.query('INSERT INTO user_roles VALUES ($1,$2)', [u.rows[0].id, studentRole]);
        let photo = null;
        if (typeof s.photo === 'string' && s.photo.startsWith('data:image/')) {
          const buf = Buffer.from(s.photo.split(',')[1] || '', 'base64');
          if (buf.length <= 5 * 1024 * 1024 && !dry) photo = await storeImage(buf, 'students');
          if (!photo) report.warnings.push(dry ? `photo for ${code} will be validated on the real run` : `photo for ${code} not imported (unsupported or too large)`);
        }
        const st = await c.query(`INSERT INTO students (user_id, student_no, full_name_ckb, full_name_en, legacy_code, photo_path) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [u.rows[0].id, no, ckb, en, code, photo]);
        await c.query('INSERT INTO enrollments (student_id, section_id, academic_year_id) VALUES ($1,$2,$3)', [st.rows[0].id, sec.id, year.id]);
        byCode.set(code, { id: st.rows[0].id, section: sec.id });
        credentials.push([no, ckb, pw]);
        report.students_created++;
      }
      for (const g of data.grades || []) {
        const st = byCode.get(String(g.studentCode || '').trim());
        const en = String(g.subject || '').split('/').pop().trim();
        const subjCode = SUBJECT_MAP[en];
        const max = Number(g.maxScore); const score = Number(g.score);
        if (!st || !subjCode) { report.warnings.push(`grade skipped (unknown student/subject): ${g.studentCode} ${g.subject}`); continue; }
        if (!(max > 0) || !Number.isFinite(score) || score < 0 || score > max) { report.warnings.push(`invalid grade skipped: ${g.studentCode} ${g.subject} ${g.score}/${g.maxScore}`); continue; }
        const subj = (await c.query('SELECT id FROM subjects WHERE code=$1', [subjCode])).rows[0].id;
        const week = Number(String(g.week || '').replace(/\D/g, '')) || null;
        // The legacy system allowed a different maximum per student for the same week. Sheets share one maximum,
        // so a differing maximum goes to its own sheet (e.g. "Week 1 (/20)") instead of being dropped.
        const base = g.week || 'Legacy';
        let a = null;
        for (const title of [base, `${base} (/${max})`]) {
          a = (await c.query('SELECT id, max_score FROM assessments WHERE term_id=$1 AND section_id=$2 AND subject_id=$3 AND title=$4', [term.id, st.section, subj, title])).rows[0];
          if (!a) {
            a = (await c.query(`INSERT INTO assessments (term_id, section_id, subject_id, category_id, title, week_no, max_score, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'published') RETURNING id, max_score`,
              [term.id, st.section, subj, weekly, title, week, max])).rows[0];
            report.assessments++;
          }
          if (Number(a.max_score) === max) break;
          a = null;
        }
        if (!a) { report.warnings.push(`could not place grade ${g.studentCode} ${g.subject} ${base}`); continue; }
        const r = await c.query(`INSERT INTO grade_records (assessment_id, student_id, score, status, comment) VALUES ($1,$2,$3,'graded',$4) ON CONFLICT (assessment_id, student_id) DO NOTHING`,
          [a.id, st.id, score, g.note ? String(g.note).slice(0, 500) : null]);
        report.grades += r.rowCount;
      }
      await c.query(`INSERT INTO audit_logs (action, entity_type, details) VALUES ('legacy.import','system',$1)`, [report]);
      if (dry) throw Object.assign(new Error('dry run'), { dry: true });
    });
  } catch (e) { if (!e.dry) throw e; console.log('DRY RUN — nothing was saved.'); }
  console.log(JSON.stringify(report, null, 2));
  if (!dry && credentials.length) {
    const out = `legacy-credentials-${Date.now()}.csv`;
    fs.writeFileSync(out, '﻿username,name,one_time_password\n' + credentials.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), { mode: 0o600 });
    console.log(`Login details written to ${out} (sensitive — distribute, then delete).`);
  }
  await db.pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
