'use strict';
const express = require('express');
const db = require('../lib/db');
const { z, parse, id, text, optText, date, page } = require('../lib/validate');
const { ah, notFound, badRequest, conflict, forbidden } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { requirePerm, has } = require('../middleware/auth');
const { assertAssessmentAccess } = require('../lib/access');
const { validateScore } = require('../lib/grading');
const { getSettings } = require('../lib/settings');
const { pgConflict } = require('./academic');

const router = express.Router();
router.use(requirePerm('grades.enter', 'grades.manage_all', 'grades.read_all', 'grades.approve'));

const EDITABLE = new Set(['draft', 'returned']);

async function loadAssessment(q, aid, lock = false) {
  const r = await q.query(
    `SELECT a.*, t.grade_entry_open, t.academic_year_id AS term_year_id, sec.academic_year_id AS section_year_id
       FROM assessments a JOIN terms t ON t.id = a.term_id JOIN sections sec ON sec.id = a.section_id
      WHERE a.id = $1 ${lock ? 'FOR UPDATE OF a' : ''}`, [aid]);
  if (!r.rowCount) throw notFound();
  return r.rows[0];
}

async function notify(c, userIds, kind, payload) {
  if (!userIds.length) return;
  await c.query(`INSERT INTO notifications (user_id, kind, payload) SELECT unnest($1::bigint[]), $2, $3`, [userIds, kind, payload]);
}

router.get('/', ah(async (req, res) => {
  const q = parse(page.extend({ termId: id.optional(), sectionId: id.optional(), subjectId: id.optional(), yearId: id.optional(),
    status: z.enum(['draft', 'submitted', 'approved', 'published', 'returned']).optional() }), req.query);
  const all = has(req, 'grades.read_all') || has(req, 'grades.manage_all') || has(req, 'grades.approve');
  const params = [q.termId ?? null, q.sectionId ?? null, q.subjectId ?? null, q.status ?? null, q.yearId ?? null, !all, req.user.id];
  const where = `WHERE ($1::int IS NULL OR a.term_id = $1) AND ($2::int IS NULL OR a.section_id = $2)
      AND ($3::int IS NULL OR a.subject_id = $3) AND ($4::text IS NULL OR a.status = $4)
      AND ($5::int IS NULL OR t.academic_year_id = $5)
      AND (NOT $6 OR EXISTS (SELECT 1 FROM teacher_assignments ta JOIN teachers tt ON tt.id = ta.teacher_id
             WHERE ta.section_id = a.section_id AND ta.subject_id = a.subject_id AND tt.user_id = $7))`;
  const from = `FROM assessments a JOIN terms t ON t.id = a.term_id JOIN sections sec ON sec.id = a.section_id
      JOIN classes c ON c.id = sec.class_id JOIN subjects sj ON sj.id = a.subject_id JOIN assessment_categories cat ON cat.id = a.category_id`;
  const total = (await db.query(`SELECT count(*)::int n ${from} ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.week_no, a.max_score, a.status, a.assessed_on, a.updated_at, a.term_id, a.section_id, a.subject_id,
            t.name_en AS term_name_en, t.name_ckb AS term_name_ckb, c.grade_level, sec.name AS section_name,
            sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb, cat.name_en AS category_name_en, cat.name_ckb AS category_name_ckb,
            (SELECT count(*) FROM enrollments e WHERE e.section_id = a.section_id AND e.status = 'active')::int AS roster_count,
            (SELECT count(*) FROM grade_records g WHERE g.assessment_id = a.id)::int AS entered_count,
            (SELECT round(avg(g.score * 100 / a.max_score), 1) FROM grade_records g WHERE g.assessment_id = a.id AND g.status = 'graded') AS avg_percent,
            (SELECT count(*) FROM grade_records g WHERE g.assessment_id = a.id
               AND (g.status = 'missing' OR (g.status = 'graded' AND g.score * 100 / a.max_score < sj.pass_mark_percent)))::int AS below_pass,
            (SELECT u.full_name FROM grade_approvals ga JOIN users u ON u.id = ga.acted_by
              WHERE ga.assessment_id = a.id AND ga.action = 'submit' ORDER BY ga.acted_at DESC LIMIT 1) AS submitted_by,
            a.version
       ${from} ${where} ORDER BY a.updated_at DESC LIMIT $8 OFFSET $9`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows, total, page: q.page, pageSize: q.pageSize });
}));

const metaSchema = z.object({
  term_id: id, section_id: id, subject_id: id, category_id: id, title: text(100),
  week_no: z.coerce.number().int().min(1).max(60).nullable().optional(),
  max_score: z.coerce.number().positive().max(1000), assessed_on: date.nullable().optional(),
});

router.post('/', ah(async (req, res) => {
  const b = parse(metaSchema, req.body);
  const access = await assertAssessmentAccess(req, b, { write: true });
  const out = await db.tx(async (c) => {
    const t = await c.query('SELECT academic_year_id, grade_entry_open FROM terms WHERE id = $1', [b.term_id]);
    const s = await c.query('SELECT academic_year_id FROM sections WHERE id = $1', [b.section_id]);
    if (!t.rowCount || !s.rowCount) throw notFound();
    if (t.rows[0].academic_year_id !== s.rows[0].academic_year_id) throw badRequest('term_section_year_mismatch');
    if (!t.rows[0].grade_entry_open && !access.manager) throw forbidden('grade_entry_closed');
    const r = await c.query(
      `INSERT INTO assessments (term_id, section_id, subject_id, category_id, title, week_no, max_score, assessed_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.term_id, b.section_id, b.subject_id, b.category_id, b.title, b.week_no ?? null, b.max_score, b.assessed_on ?? null, req.user.id]).catch(pgConflict);
    await audit(req, 'assessment.create', { entityType: 'assessment', entityId: r.rows[0].id, details: b, client: c });
    return r.rows[0];
  });
  res.status(201).json(out);
}));

router.get('/:id', ah(async (req, res) => {
  const aid = parse(id, req.params.id);
  const a = await loadAssessment(db, aid);
  const access = await assertAssessmentAccess(req, a);
  const meta = await db.query(
    `SELECT t.name_en AS term_name_en, t.name_ckb AS term_name_ckb, c.grade_level, sec.name AS section_name,
            sj.name_en AS subject_name_en, sj.name_ckb AS subject_name_ckb, sj.pass_mark_percent,
            cat.name_en AS category_name_en, cat.name_ckb AS category_name_ckb, y.name AS year_name
       FROM assessments a JOIN terms t ON t.id = a.term_id JOIN academic_years y ON y.id = t.academic_year_id
       JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
       JOIN subjects sj ON sj.id = a.subject_id JOIN assessment_categories cat ON cat.id = a.category_id WHERE a.id = $1`, [aid]);
  // Roster = students actively enrolled in the section, plus anyone who already has a record (e.g. transferred mid-term).
  const roster = await db.query(
    `SELECT s.id AS student_id, s.student_no, s.full_name_ckb, s.full_name_en, e.status AS enrollment_status,
            g.id AS record_id, g.score, g.status, g.comment, g.version, g.updated_at,
            (SELECT count(*) FROM grade_record_history h WHERE h.grade_record_id = g.id)::int AS change_count
       FROM students s
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.section_id = $2
       LEFT JOIN grade_records g ON g.student_id = s.id AND g.assessment_id = $1
      WHERE (e.status = 'active') OR g.id IS NOT NULL
      ORDER BY lower(s.full_name_ckb), s.id`, [aid, a.section_id]);
  const settings = (await getSettings()).grading;
  const editable = EDITABLE.has(a.status) && (a.grade_entry_open || access.manager) && (access.manager || access.teacher);
  res.json({
    assessment: { ...a, ...meta.rows[0] },
    roster: roster.rows,
    permissions: {
      edit: editable,
      correct: a.status === 'published' && has(req, 'grades.correct'),
      submit: EDITABLE.has(a.status) && (access.manager || access.teacher),
      approve: a.status === 'submitted' && has(req, 'grades.approve'),
      return: ['submitted', 'approved'].includes(a.status) && has(req, 'grades.approve'),
      publish: a.status === 'approved' && has(req, 'grades.publish'),
      unpublish: a.status === 'published' && has(req, 'grades.publish'),
    },
    policy: { allow_decimals: settings.allow_decimals, decimal_places: settings.decimal_places },
  });
}));

router.put('/:id', ah(async (req, res) => {
  const aid = parse(id, req.params.id);
  const b = parse(metaSchema.pick({ category_id: true, title: true, week_no: true, max_score: true, assessed_on: true })
    .extend({ version: z.coerce.number().int() }), req.body);
  const out = await db.tx(async (c) => {
    const a = await loadAssessment(c, aid, true);
    const access = await assertAssessmentAccess(req, a, { write: true });
    if (!EDITABLE.has(a.status)) throw conflict('assessment_locked');
    if (!a.grade_entry_open && !access.manager) throw forbidden('grade_entry_closed');
    if (a.version !== b.version) throw conflict('stale_version', 'This assessment was changed by someone else. Reload.');
    const over = await c.query('SELECT count(*)::int n FROM grade_records WHERE assessment_id = $1 AND score > $2', [aid, b.max_score]);
    if (over.rows[0].n) throw badRequest('existing_scores_exceed_new_max');
    const r = await c.query(
      `UPDATE assessments SET category_id=$2, title=$3, week_no=$4, max_score=$5, assessed_on=$6, version=version+1, updated_at=now()
        WHERE id=$1 RETURNING *`, [aid, b.category_id, b.title, b.week_no ?? null, b.max_score, b.assessed_on ?? null]).catch(pgConflict);
    await audit(req, 'assessment.update', { entityType: 'assessment', entityId: aid, details: b, client: c });
    return r.rows[0];
  });
  res.json(out);
}));

router.delete('/:id', ah(async (req, res) => {
  const aid = parse(id, req.params.id);
  await db.tx(async (c) => {
    const a = await loadAssessment(c, aid, true);
    await assertAssessmentAccess(req, a, { write: true });
    if (a.status !== 'draft') throw conflict('only_draft_can_be_deleted');
    const n = (await c.query('SELECT count(*)::int n FROM grade_records WHERE assessment_id = $1', [aid])).rows[0].n;
    if (n > 0) throw conflict('assessment_has_grades', 'Clear the grades before deleting this assessment');
    await c.query('DELETE FROM assessments WHERE id = $1', [aid]);
    await audit(req, 'assessment.delete', { entityType: 'assessment', entityId: aid, details: { title: a.title }, client: c });
  });
  res.json({ ok: true });
}));

// ---------- Bulk grade save (transactional, optimistic concurrency per row) ----------
const rowSchema = z.object({
  student_id: id,
  score: z.union([z.number(), z.string().trim().max(10), z.null()]).optional(),
  status: z.enum(['graded', 'missing', 'excused']).default('graded'),
  comment: z.string().trim().max(500).nullable().optional(),
  version: z.number().int().nullable().optional(),   // null/undefined = row is new
  clear: z.boolean().optional(),                       // explicit removal of an existing record
});

router.put('/:id/grades', ah(async (req, res) => {
  const aid = parse(id, req.params.id);
  const b = parse(z.object({ rows: z.array(rowSchema).min(1).max(500), reason: optText(500) }), req.body);
  const policy = (await getSettings()).grading;
  const result = await db.tx(async (c) => {
    // Row lock serialises concurrent saves on the same sheet; never wait long for it (pool connections are precious).
    await c.query("SET LOCAL lock_timeout = '3s'");
    const a = await loadAssessment(c, aid, true);
    const access = await assertAssessmentAccess(req, a, { write: a.status !== 'published' });
    const isCorrection = a.status === 'published';
    if (isCorrection) {
      if (!has(req, 'grades.correct')) throw forbidden('published_grades_locked');
      if (!b.reason || b.reason.length < 5) throw badRequest('correction_reason_required');
    } else {
      if (!EDITABLE.has(a.status)) throw conflict('assessment_locked', 'Grades are locked while awaiting approval');
      if (!a.grade_entry_open && !access.manager) throw forbidden('grade_entry_closed');
    }
    const eligible = new Set((await c.query(
      `SELECT student_id FROM enrollments WHERE section_id = $1 AND status = 'active'
       UNION SELECT student_id FROM grade_records WHERE assessment_id = $2`, [a.section_id, aid])).rows.map((r) => r.student_id));
    const existing = new Map((await c.query(
      'SELECT * FROM grade_records WHERE assessment_id = $1 FOR UPDATE', [aid])).rows.map((r) => [r.student_id, r]));

    const errors = [];
    const conflicts = [];
    const ops = [];
    const seen = new Set();
    for (const row of b.rows) {
      if (seen.has(row.student_id)) { errors.push({ student_id: row.student_id, code: 'duplicate_row' }); continue; }
      seen.add(row.student_id);
      if (!eligible.has(row.student_id)) { errors.push({ student_id: row.student_id, code: 'student_not_in_section' }); continue; }
      const cur = existing.get(row.student_id);
      if (cur && row.version !== cur.version) { conflicts.push({ student_id: row.student_id, current: cur }); continue; }
      if (!cur && row.version != null) { conflicts.push({ student_id: row.student_id, current: null }); continue; }
      if (row.clear) {
        if (!cur) continue;
        if (isCorrection) { errors.push({ student_id: row.student_id, code: 'cannot_clear_published' }); continue; }
        ops.push({ kind: 'delete', cur });
        continue;
      }
      let score = null;
      if (row.status === 'graded') {
        // A blank score is never silently treated as "delete" or "0".
        const err = validateScore(row.score, a.max_score, { allowDecimals: policy.allow_decimals, decimalPlaces: policy.decimal_places });
        if (err) { errors.push({ student_id: row.student_id, code: err }); continue; }
        score = Number(row.score);
      }
      const comment = row.comment || null;
      if (cur && cur.status === row.status && Number(cur.score) === Number(score) && (cur.score === null) === (score === null)
          && (cur.comment || null) === comment) continue; // unchanged
      ops.push({ kind: cur ? 'update' : 'insert', cur, student_id: row.student_id, score, status: row.status, comment });
    }
    if (errors.length) throw badRequest('grade_validation_failed', 'Some grades are invalid', errors);
    if (conflicts.length) throw conflict('grade_conflict', 'Another user changed some grades. Review and retry.', conflicts);

    // Set-based writes: a constant number of statements regardless of class size keeps the row lock short.
    const ins = ops.filter((o) => o.kind === 'insert');
    const upd = ops.filter((o) => o.kind === 'update');
    const del = ops.filter((o) => o.kind === 'delete');
    if (ins.length) {
      await c.query(
        `INSERT INTO grade_records (assessment_id, student_id, score, status, comment, entered_by)
         SELECT $1, x.student_id, x.score, x.status, x.comment, $6
           FROM unnest($2::bigint[], $3::numeric[], $4::text[], $5::text[]) AS x(student_id, score, status, comment)`,
        [aid, ins.map((o) => o.student_id), ins.map((o) => o.score), ins.map((o) => o.status), ins.map((o) => o.comment), req.user.id]);
    }
    if (upd.length) {
      await c.query(
        `INSERT INTO grade_record_history (grade_record_id, old_score, new_score, old_status, new_status, reason, is_correction, changed_by)
         SELECT x.id, g.score, x.score, g.status, x.status, $5, $6, $7
           FROM unnest($1::bigint[], $2::numeric[], $3::text[], $4::text[]) AS x(id, score, status, comment)
           JOIN grade_records g ON g.id = x.id`,
        [upd.map((o) => o.cur.id), upd.map((o) => o.score), upd.map((o) => o.status), upd.map((o) => o.comment),
          isCorrection ? b.reason : null, isCorrection, req.user.id]);
      await c.query(
        `UPDATE grade_records g SET score = x.score, status = x.status, comment = x.comment, version = g.version + 1,
                entered_by = $5, updated_at = now()
           FROM unnest($1::bigint[], $2::numeric[], $3::text[], $4::text[]) AS x(id, score, status, comment)
          WHERE g.id = x.id`,
        [upd.map((o) => o.cur.id), upd.map((o) => o.score), upd.map((o) => o.status), upd.map((o) => o.comment), req.user.id]);
    }
    if (del.length) await c.query('DELETE FROM grade_records WHERE id = ANY($1::bigint[])', [del.map((o) => o.cur.id)]);
    if (ops.length) {
      await c.query('UPDATE assessments SET version = version + 1, updated_at = now() WHERE id = $1', [aid]);
      if (isCorrection) {
        await c.query(`INSERT INTO grade_approvals (assessment_id, action, from_status, to_status, comment, acted_by)
                       VALUES ($1,'correct','published','published',$2,$3)`, [aid, b.reason, req.user.id]);
      }
      await audit(req, isCorrection ? 'grades.correct' : 'grades.save', {
        entityType: 'assessment', entityId: aid, client: c,
        details: { changes: ops.map((o) => ({ student_id: o.student_id ?? o.cur.student_id, kind: o.kind, from: o.cur ? { score: o.cur.score, status: o.cur.status } : null, to: o.kind === 'delete' ? null : { score: o.score, status: o.status } })), reason: b.reason },
      });
    }
    return { changed: ops.length };
  });
  res.json(result);
}));

// ---------- Workflow transitions ----------
const TRANSITIONS = {
  submit: { from: ['draft', 'returned'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved', perm: 'grades.approve' },
  return: { from: ['submitted', 'approved'], to: 'returned', perm: 'grades.approve', needsComment: true },
  publish: { from: ['approved'], to: 'published', perm: 'grades.publish' },
  unpublish: { from: ['published'], to: 'approved', perm: 'grades.publish', needsComment: true },
};

router.post('/:id/transition', ah(async (req, res) => {
  const aid = parse(id, req.params.id);
  const b = parse(z.object({ action: z.enum(Object.keys(TRANSITIONS)), comment: optText(500), version: z.coerce.number().int() }), req.body);
  const t = TRANSITIONS[b.action];
  const out = await db.tx(async (c) => {
    const a = await loadAssessment(c, aid, true);
    if (t.perm) { if (!has(req, t.perm)) throw forbidden(); } else { await assertAssessmentAccess(req, a, { write: true }); }
    if (a.version !== b.version) throw conflict('stale_version', 'This assessment was changed by someone else. Reload.');
    if (!t.from.includes(a.status)) throw conflict('invalid_transition', `Cannot ${b.action} from ${a.status}`);
    if (t.needsComment && !b.comment) throw badRequest('comment_required');
    if (b.action === 'submit') {
      const pending = (await c.query(
        `SELECT count(*)::int n FROM enrollments e WHERE e.section_id = $1 AND e.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM grade_records g WHERE g.assessment_id = $2 AND g.student_id = e.student_id)`,
        [a.section_id, aid])).rows[0].n;
      if (pending > 0) throw badRequest('grades_incomplete', `${pending} student(s) have no grade. Mark them as missing or excused.`, { pending });
    }
    await c.query('UPDATE assessments SET status=$2, version=version+1, updated_at=now() WHERE id=$1', [aid, t.to]);
    await c.query(`INSERT INTO grade_approvals (assessment_id, action, from_status, to_status, comment, acted_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [aid, b.action, a.status, t.to, b.comment, req.user.id]);
    const payload = { assessment_id: aid, title: a.title, action: b.action };
    if (b.action === 'submit') {
      const approvers = await c.query(
        `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
          WHERE p.key = 'grades.approve' AND u.status = 'active'`);
      await notify(c, approvers.rows.map((r) => r.user_id), 'grades.submitted', payload);
    } else if (b.action === 'return') {
      const teachers = await c.query(
        `SELECT t.user_id FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id WHERE ta.section_id=$1 AND ta.subject_id=$2`,
        [a.section_id, a.subject_id]);
      await notify(c, teachers.rows.map((r) => r.user_id), 'grades.returned', { ...payload, comment: b.comment });
    } else if (b.action === 'publish') {
      const students = await c.query(
        `SELECT s.user_id FROM grade_records g JOIN students s ON s.id = g.student_id WHERE g.assessment_id = $1 AND s.user_id IS NOT NULL`, [aid]);
      await notify(c, students.rows.map((r) => r.user_id), 'grades.published', payload);
    }
    await audit(req, `assessment.${b.action}`, { entityType: 'assessment', entityId: aid, details: { from: a.status, to: t.to, comment: b.comment }, client: c });
    return { status: t.to };
  });
  res.json(out);
}));

// Approve (and optionally publish) several submitted sheets at once — one transaction, all-or-nothing per sheet.
router.post('/bulk-approve', requirePerm('grades.approve'), ah(async (req, res) => {
  const b = parse(z.object({ ids: z.array(id).min(1).max(200), publish: z.boolean().default(true) }), req.body);
  if (b.publish && !has(req, 'grades.publish')) throw forbidden();
  const done = []; const skipped = [];
  for (const aid of [...new Set(b.ids)]) {
    try {
      await db.tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        const a = await loadAssessment(c, aid, true);
        let status = a.status;
        if (status !== 'submitted' && !(b.publish && status === 'approved')) throw conflict('invalid_transition');
        const steps = status === 'submitted' ? ['approve'] : [];
        if (b.publish) steps.push('publish');
        for (const action of steps) {
          const to = TRANSITIONS[action].to;
          await c.query('INSERT INTO grade_approvals (assessment_id, action, from_status, to_status, acted_by) VALUES ($1,$2,$3,$4,$5)', [aid, action, status, to, req.user.id]);
          status = to;
        }
        await c.query('UPDATE assessments SET status=$2, version=version+1, updated_at=now() WHERE id=$1', [aid, status]);
        if (status === 'published') {
          const st = await c.query('SELECT s.user_id FROM grade_records g JOIN students s ON s.id = g.student_id WHERE g.assessment_id = $1 AND s.user_id IS NOT NULL', [aid]);
          await notify(c, st.rows.map((r) => r.user_id), 'grades.published', { assessment_id: aid, title: a.title, action: 'publish' });
        }
        await audit(req, b.publish ? 'assessment.approve_publish' : 'assessment.approve', { entityType: 'assessment', entityId: aid, details: { from: a.status, to: status, bulk: true }, client: c });
      });
      done.push(aid);
    } catch (err) {
      skipped.push({ id: aid, code: err.code || 'error' });
    }
  }
  res.json({ done, skipped });
}));

router.get('/:id/history', ah(async (req, res) => {
  const aid = parse(id, req.params.id);
  const a = await loadAssessment(db, aid);
  await assertAssessmentAccess(req, a);
  const approvals = await db.query(
    `SELECT ga.*, u.full_name AS actor_name FROM grade_approvals ga JOIN users u ON u.id = ga.acted_by
      WHERE ga.assessment_id = $1 ORDER BY ga.acted_at DESC`, [aid]);
  const changes = await db.query(
    `SELECT h.*, g.student_id, s.full_name_ckb, s.student_no, u.full_name AS actor_name
       FROM grade_record_history h JOIN grade_records g ON g.id = h.grade_record_id JOIN students s ON s.id = g.student_id
       LEFT JOIN users u ON u.id = h.changed_by WHERE g.assessment_id = $1 ORDER BY h.changed_at DESC LIMIT 500`, [aid]);
  res.json({ approvals: approvals.rows, changes: changes.rows });
}));

module.exports = router;
