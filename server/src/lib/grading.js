'use strict';
/**
 * Darwaza grading engine — pure functions, no I/O.
 *
 * DEFINITIONS (documented in docs/GRADING_POLICY.md):
 *
 *  Assessment percentage   p_i = score_i / max_i × 100
 *
 *  Status handling
 *    graded   → counted with its score
 *    missing  → counted as 0 if policy.missing_counts_as_zero, otherwise excluded
 *    excused  → always excluded (neither numerator nor denominator)
 *    no record (not yet entered) → excluded and reported as "pending"
 *
 *  Category percentage     P_c = Σ score_i / Σ max_i   over counted assessments in category c
 *                          (points-based, so a 20-point exam weighs twice a 10-point quiz inside c)
 *
 *  Subject percentage
 *    mode "weighted":   S = Σ_c (w_c × P_c) / Σ_c w_c     over categories with ≥1 counted assessment
 *    mode "unweighted": S = Σ score_i / Σ max_i            over all counted assessments
 *
 *  Overall percentage      O = mean of subject percentages (each subject weighs equally)
 *
 *  Pass/fail               subject passes when S ≥ subject.pass_mark_percent
 *  Rounding                applied ONLY to final displayed values, never to intermediates
 */

function round(value, places = 1, mode = 'half_up') {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** places;
  // Add a tiny epsilon to avoid 1.005 → 1.00 floating point artefacts.
  const scaled = value * f;
  if (mode === 'floor') return Math.floor(scaled + 1e-9) / f;
  if (mode === 'half_even') {
    const r = Math.round(scaled);
    const diff = Math.abs(scaled - Math.trunc(scaled));
    if (Math.abs(diff - 0.5) < 1e-9) return (Math.trunc(scaled) % 2 === 0 ? Math.trunc(scaled) : Math.trunc(scaled) + Math.sign(scaled)) / f;
    return r / f;
  }
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-9) / f;
}

/** Validate one score against an assessment's maximum. Returns error code or null. */
function validateScore(score, maxScore, { allowDecimals = true, decimalPlaces = 2 } = {}) {
  if (score === null || score === undefined || score === '') return 'score_required';
  const n = typeof score === 'number' ? score : Number(String(score).trim());
  if (!Number.isFinite(n)) return 'score_not_a_number';
  if (n < 0) return 'score_below_zero';
  if (n > maxScore) return 'score_above_max';
  if (!allowDecimals && !Number.isInteger(n)) return 'score_must_be_integer';
  const factor = 10 ** decimalPlaces;
  if (Math.abs(Math.round(n * factor) - n * factor) > 1e-6) return 'score_too_many_decimals';
  return null;
}

function bandFor(percent, bands) {
  if (percent === null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return (sorted.find((b) => percent >= b.min) || sorted[sorted.length - 1]).key;
}

/**
 * @param items  [{ score, max_score, status, category_id, category_weight }]  status ∈ graded|missing|excused|null
 * @param policy { mode, missing_counts_as_zero }
 * @returns { percent (unrounded) | null, counted, excused, missing, pending }
 */
function subjectPercent(items, policy) {
  const counted = [];
  let excused = 0, missing = 0, pending = 0;
  for (const it of items) {
    if (!it.status) { pending++; continue; }
    if (it.status === 'excused') { excused++; continue; }
    if (it.status === 'missing') {
      missing++;
      if (policy.missing_counts_as_zero) counted.push({ ...it, score: 0 });
      continue;
    }
    counted.push(it);
  }
  if (counted.length === 0) return { percent: null, counted: 0, excused, missing, pending };

  let percent;
  if (policy.mode === 'unweighted') {
    const s = counted.reduce((a, i) => a + Number(i.score), 0);
    const m = counted.reduce((a, i) => a + Number(i.max_score), 0);
    percent = (s / m) * 100;
  } else {
    const byCat = new Map();
    for (const i of counted) {
      const c = byCat.get(i.category_id) || { s: 0, m: 0, w: Number(i.category_weight ?? 1) };
      c.s += Number(i.score); c.m += Number(i.max_score);
      byCat.set(i.category_id, c);
    }
    let num = 0, den = 0;
    for (const c of byCat.values()) { num += c.w * (c.s / c.m) * 100; den += c.w; }
    percent = den > 0 ? num / den : null;
  }
  return { percent, counted: counted.length, excused, missing, pending };
}

/**
 * Build a full report for one student.
 * @param subjects [{ id, name_en, name_ckb, pass_mark_percent }]
 * @param rows     [{ subject_id, score, max_score, status, category_id, category_weight }]
 * @param policy   grading settings
 */
function buildReport(subjects, rows, policy) {
  const places = policy.display_decimals ?? 1;
  const mode = policy.rounding || 'half_up';
  const out = [];
  for (const subj of subjects) {
    const items = rows.filter((r) => r.subject_id === subj.id);
    if (items.length === 0) continue;
    const r = subjectPercent(items, policy);
    const totalScore = items.filter((i) => i.status === 'graded').reduce((a, i) => a + Number(i.score), 0);
    const totalMax = items.filter((i) => i.status === 'graded' || (i.status === 'missing' && policy.missing_counts_as_zero))
      .reduce((a, i) => a + Number(i.max_score), 0);
    out.push({
      subject_id: subj.id,
      name_en: subj.name_en,
      name_ckb: subj.name_ckb,
      total_score: round(totalScore, 2),
      total_max: round(totalMax, 2),
      percent: round(r.percent, places, mode),
      passed: r.percent === null ? null : r.percent + 1e-9 >= Number(subj.pass_mark_percent),
      pass_mark_percent: Number(subj.pass_mark_percent),
      band: bandFor(r.percent, policy.bands),
      counted: r.counted, excused: r.excused, missing: r.missing, pending: r.pending,
      _raw: r.percent,
    });
  }
  const valid = out.filter((s) => s._raw !== null);
  const overallRaw = valid.length ? valid.reduce((a, s) => a + s._raw, 0) / valid.length : null;
  out.forEach((s) => delete s._raw);
  return {
    subjects: out,
    overall_percent: round(overallRaw, places, mode),
    overall_band: bandFor(overallRaw, policy.bands),
    subjects_passed: out.filter((s) => s.passed === true).length,
    subjects_failed: out.filter((s) => s.passed === false).length,
  };
}

module.exports = { round, validateScore, subjectPercent, buildReport, bandFor };
