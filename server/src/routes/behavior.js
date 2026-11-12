'use strict';
/** Weekly behavior evaluations: entered by the principal (grades.manage_all) or the class's homeroom teacher. */
const express = require('express');
const db = require('../lib/db');
const { z, parse, id, optText } = require('../lib/validate');
const { ah, notFound, badRequest } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { has } = require('../middleware/auth');

const router = express.Router();
const RATINGS = ['excellent', 'very_good', 'good', 'average', 'needs_improvement'];

async function manageableSectionIds(req) {
  if (has(req, 'grades.manage_all')) return null; // all
  const r = await db.query(
    `SELECT s.id FROM sections s JOIN teachers t ON t.id = s.homeroom_teacher_id WHERE t.user_id = $1`, [req.user.id]);
  return r.rows.map((x) => x.id);
}
async function assertSection(req, sectionId) {
  const ids = await manageableSectionIds(req);
  if (ids && !ids.includes(sectionId)) throw notFound();
}

router.get('/sections', ah(async (req, res) => {
  const ids = await manageableSectionIds(req);
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.academic_year_id, c.grade_level FROM sections s JOIN classes c ON c.id = s.class_id
       JOIN academic_years y ON y.id = s.academic_year_id
      WHERE y.is_current AND ($1::int[] IS NULL OR s.id = ANY($1)) ORDER BY c.grade_level, s.name`, [ids]);
  res.json({ items: rows, ratings: RATINGS });
}));

router.get('/', ah(async (req, res) => {
  const q = parse(z.object({ sectionId: id, termId: id, week: z.coerce.number().int().min(1).max(60) }), req.query);
  await assertSection(req, q.sectionId);
  const { rows } = await db.query(
    `SELECT s.id AS student_id, s.student_no, s.full_name_ckb, s.full_name_en, s.photo_path IS NOT NULL AS has_photo,
            b.rating, b.comment, b.status, b.updated_at
       FROM enrollments e JOIN students s ON s.id = e.student_id
       LEFT JOIN behavior_evaluations b ON b.student_id = s.id AND b.term_id = $2 AND b.week_no = $3
      WHERE e.section_id = $1 AND e.status = 'active' ORDER BY lower(s.full_name_ckb)`, [q.sectionId, q.termId, q.week]);
  res.json({ items: rows, ratings: RATINGS });
}));

router.put('/', ah(async (req, res) => {
  const b = parse(z.object({
    section_id: id, term_id: id, week_no: z.coerce.number().int().min(1).max(60), publish: z.boolean().default(false),
    rows: z.array(z.object({ student_id: id, rating: z.enum(RATINGS).nullable(), comment: optText(300) })).min(1).max(200),
  }), req.body);
  await assertSection(req, b.section_id);
  const out = await db.tx(async (c) => {
    const ok = await c.query('SELECT 1 FROM sections s JOIN terms t ON t.academic_year_id = s.academic_year_id WHERE s.id = $1 AND t.id = $2', [b.section_id, b.term_id]);
    if (!ok.rowCount) throw badRequest('term_section_year_mismatch');
    const roster = new Set((await c.query("SELECT student_id FROM enrollments WHERE section_id = $1 AND status = 'active'", [b.section_id])).rows.map((r) => r.student_id));
    let saved = 0;
    const status = b.publish ? 'published' : 'draft';
    for (const r of b.rows) {
      if (!roster.has(r.student_id)) throw badRequest('student_not_in_section');
      if (!r.rating) continue;
      const cur = (await c.query('SELECT * FROM behavior_evaluations WHERE student_id=$1 AND term_id=$2 AND week_no=$3 FOR UPDATE', [r.student_id, b.term_id, b.week_no])).rows[0];
      if (cur && cur.rating === r.rating && (cur.comment || null) === (r.comment || null) && cur.status === status) continue;
      const up = await c.query(
        `INSERT INTO behavior_evaluations (student_id, term_id, week_no, rating, comment, status, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (student_id, term_id, week_no) DO UPDATE SET rating=EXCLUDED.rating, comment=EXCLUDED.comment, status=EXCLUDED.status,
           entered_by=EXCLUDED.entered_by, updated_at=now() RETURNING id`,
        [r.student_id, b.term_id, b.week_no, r.rating, r.comment, status, req.user.id]);
      await c.query('INSERT INTO behavior_history (evaluation_id, old_rating, new_rating, old_status, new_status, changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [up.rows[0].id, cur?.rating ?? null, r.rating, cur?.status ?? null, status, req.user.id]);
      saved++;
    }
    await audit(req, b.publish ? 'behavior.publish' : 'behavior.save', { entityType: 'section', entityId: b.section_id, details: { term_id: b.term_id, week_no: b.week_no, saved }, client: c });
    return { saved };
  });
  res.json(out);
}));

module.exports = router;
