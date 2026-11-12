'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { round, validateScore, subjectPercent, buildReport } = require('../src/lib/grading');

const policy = { mode: 'weighted', missing_counts_as_zero: true, display_decimals: 1, rounding: 'half_up',
  bands: [{ min: 90, key: 'excellent' }, { min: 75, key: 'very_good' }, { min: 60, key: 'good' }, { min: 50, key: 'pass' }, { min: 0, key: 'needs_improvement' }] };

test('round half-up avoids float artefacts', () => {
  assert.strictEqual(round(1.005, 2), 1.01);
  assert.strictEqual(round(66.66666, 1), 66.7);
  assert.strictEqual(round(2.5, 0), 3);
  assert.strictEqual(round(2.5, 0, 'half_even'), 2);
  assert.strictEqual(round(null), null);
});

test('validateScore', () => {
  assert.strictEqual(validateScore(5, 10), null);
  assert.strictEqual(validateScore('7.5', 10), null);
  assert.strictEqual(validateScore(10, 10), null);
  assert.strictEqual(validateScore(0, 10), null);
  assert.strictEqual(validateScore(10.5, 10), 'score_above_max');
  assert.strictEqual(validateScore(-1, 10), 'score_below_zero');
  assert.strictEqual(validateScore('', 10), 'score_required');
  assert.strictEqual(validateScore(null, 10), 'score_required');
  assert.strictEqual(validateScore('abc', 10), 'score_not_a_number');
  assert.strictEqual(validateScore('Infinity', 10), 'score_not_a_number');
  assert.strictEqual(validateScore(7.5, 10, { allowDecimals: false }), 'score_must_be_integer');
  assert.strictEqual(validateScore(7.555, 10, { decimalPlaces: 2 }), 'score_too_many_decimals');
});

test('unweighted subject percent is points-based', () => {
  const r = subjectPercent([
    { score: 9, max_score: 10, status: 'graded', category_id: 1 },
    { score: 10, max_score: 20, status: 'graded', category_id: 1 },
  ], { ...policy, mode: 'unweighted' });
  assert.strictEqual(round(r.percent, 2), 63.33); // 19/30, NOT the legacy mean-of-percentages (70)
});

test('weighted categories', () => {
  const r = subjectPercent([
    { score: 8, max_score: 10, status: 'graded', category_id: 1, category_weight: 1 },  // 80%
    { score: 30, max_score: 60, status: 'graded', category_id: 2, category_weight: 3 }, // 50%
  ], policy);
  assert.strictEqual(round(r.percent, 2), 57.5); // (1*80 + 3*50) / 4
});

test('missing counts as zero, excused excluded, pending reported', () => {
  const items = [
    { score: 10, max_score: 10, status: 'graded', category_id: 1 },
    { score: null, max_score: 10, status: 'missing', category_id: 1 },
    { score: null, max_score: 10, status: 'excused', category_id: 1 },
    { score: null, max_score: 10, status: null, category_id: 1 },
  ];
  const r = subjectPercent(items, policy);
  assert.strictEqual(r.percent, 50);
  assert.deepStrictEqual([r.counted, r.excused, r.missing, r.pending], [2, 1, 1, 1]);
  assert.strictEqual(subjectPercent(items, { ...policy, missing_counts_as_zero: false }).percent, 100);
});

test('all excused → no percent (not 0)', () => {
  assert.strictEqual(subjectPercent([{ status: 'excused', max_score: 10 }], policy).percent, null);
});

test('buildReport: per-subject pass marks and overall = mean of subjects', () => {
  const subjects = [{ id: 1, name_en: 'Math', pass_mark_percent: 50 }, { id: 2, name_en: 'Eng', pass_mark_percent: 60 }, { id: 3, name_en: 'Art', pass_mark_percent: 50 }];
  const rows = [
    { subject_id: 1, score: 5, max_score: 10, status: 'graded', category_id: 1 },   // 50 → pass exactly at threshold
    { subject_id: 2, score: 11, max_score: 20, status: 'graded', category_id: 1 },  // 55 → fail (needs 60)
  ];
  const r = buildReport(subjects, rows, policy);
  assert.strictEqual(r.subjects.length, 2); // Art has no grades → omitted, not 0
  assert.strictEqual(r.subjects[0].passed, true);
  assert.strictEqual(r.subjects[1].passed, false);
  assert.strictEqual(r.overall_percent, 52.5);
  assert.strictEqual(r.overall_band, 'pass');
  assert.strictEqual(r.subjects_failed, 1);
});
