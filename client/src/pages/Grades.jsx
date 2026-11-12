import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Smile, Search, Plus, History, Save, Send, CheckCircle2, Undo2, Globe2, EyeOff, Trash2, RefreshCw, AlertTriangle, ClipboardList } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api, normalizeDigits, ltr } from '../lib/api';
import { useApi, useYears } from '../lib/hooks';
import { Code, Empty, ErrorState, Field, Loading, Modal, PageHead, Pagination, Progress, SheetStatus, SkeletonRows, useConfirm, useToast } from '../components/ui';
import { sectionLabel } from './Students';

/** Same rules as the server (src/lib/grading.js validateScore). */
export function validateScore(raw, max, policy) {
  const s = normalizeDigits(raw).trim();
  if (s === '') return 'score_required';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'score_not_a_number';
  if (n < 0) return 'score_below_zero';
  if (n > max) return 'score_above_max';
  if (!policy.allow_decimals && !Number.isInteger(n)) return 'score_must_be_integer';
  const f = 10 ** policy.decimal_places;
  if (Math.abs(Math.round(n * f) - n * f) > 1e-6) return 'score_too_many_decimals';
  return null;
}

// ---------------- Sheet list ----------------
export function GradesPage() {
  const { t, fmtNum, pick } = useI18n();
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { years, current } = useYears();
  const year = years.find((y) => String(y.id) === sp.get('yearId')) || current;
  const terms = useApi('/academic/terms', { yearId: year?.id }, { skip: !year });
  const sections = useApi('/academic/sections', { yearId: year?.id }, { skip: !year });
  const subjects = useApi('/academic/subjects');
  const assignments = useApi('/academic/assignments', { yearId: year?.id }, { skip: !year || can('grades.manage_all') });
  const sectionId = sp.get('sectionId') || '';
  const subjectId = sp.get('subjectId') || '';
  const termId = sp.get('termId') || '';
  const status = sp.get('status') || '';
  const week = sp.get('week') || '';
  const page = Number(sp.get('page') || 1);
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const list = useApi('/assessments', { sectionId, subjectId, termId, status, week, yearId: year?.id, page, pageSize: 25 }, { skip: !year });
  const [creating, setCreating] = useState(false);
  const allowedSubjects = useMemo(() => {
    const all = (subjects.data?.items || []).filter((s) => s.is_active);
    if (can('grades.manage_all') || !assignments.data) return all;
    const mine = assignments.data.items.filter((a) => !sectionId || String(a.section_id) === sectionId).map((a) => a.subject_id);
    return all.filter((s) => mine.includes(s.id));
  }, [subjects.data, assignments.data, sectionId, can]);
  const canCreate = sectionId && subjectId && (can('grades.manage_all') || allowedSubjects.some((s) => String(s.id) === subjectId));
  return (
    <>
      <PageHead title={t('navGradeSheets')} sub={t('gradesHelp')}>
        <Link className="btn btn-secondary" to="/grades/behavior"><Smile size={18} />{t('behaviorTitle')}</Link>
        <button type="button" className="btn btn-primary" disabled={!canCreate} onClick={() => setCreating(true)} title={!canCreate ? t('selectClassSubject') : undefined}><Plus size={18} />{t('newAssessment')}</button>
      </PageHead>
      <div className="card">
        <div className="filters">
          <Field label={t('year')}>{(p) => <select {...p} className="select" value={year?.id || ''} onChange={(e) => { const n = new URLSearchParams(); n.set('yearId', e.target.value); setSp(n, { replace: true }); }}>{years.map((y) => <option key={y.id} value={y.id}>{ltr(y.name)}</option>)}</select>}</Field>
          <Field label={t('term')}>{(p) => <select {...p} className="select" value={termId} onChange={(e) => set('termId', e.target.value)}><option value="">{t('all')}</option>{(terms.data?.items || []).map((x) => <option key={x.id} value={x.id}>{pick(x)}</option>)}</select>}</Field>
          <Field label={t('section')}>{(p) => <select {...p} className="select" value={sectionId} onChange={(e) => set('sectionId', e.target.value)}><option value="">{t('all')}</option>{(sections.data?.items || []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(t, fmtNum, s)}</option>)}</select>}</Field>
          <Field label={t('subject')}>{(p) => <select {...p} className="select" value={subjectId} onChange={(e) => set('subjectId', e.target.value)}><option value="">{t('all')}</option>{allowedSubjects.map((s) => <option key={s.id} value={s.id}>{pick(s)}</option>)}</select>}</Field>
          <Field label={t('week')}>{(p) => <select {...p} className="select" value={week} onChange={(e) => set('week', e.target.value)}><option value="">{t('all')}</option>{Array.from({ length: 40 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>{t('weekN', { n: fmtNum(w) })}</option>)}</select>}</Field>
          <Field label={t('status')}>{(p) => <select {...p} className="select" value={status} onChange={(e) => set('status', e.target.value)}><option value="">{t('all')}</option>{['draft', 'returned', 'submitted', 'approved', 'published'].map((x) => <option key={x} value={x}>{t(`gs_${x}`)}</option>)}</select>}</Field>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('assessment')}</th><th>{t('subject')}</th><th>{t('class')}</th><th>{t('term')}</th><th>{t('maxScore')}</th><th>{t('progress')}</th><th>{t('status')}</th></tr></thead>
            {list.loading && !list.data ? <SkeletonRows cols={7} /> : (
              <tbody>
                {list.data?.items.length === 0 && <tr><td colSpan={7}><Empty icon={ClipboardList} title={t('noAssessments')} hint={canCreate ? t('noAssessmentsHint') : t('selectClassSubject')} /></td></tr>}
                {list.data?.items.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/grades/sheet/${a.id}`}><strong>{a.title}</strong></Link><div className="muted small">{pick(a, 'category_name')}{a.week_no ? ` · ${t('weekN', { n: fmtNum(a.week_no) })}` : ''}</div></td>
                    <td>{pick(a, 'subject_name')}</td>
                    <td className="nowrap">{sectionLabel(t, fmtNum, a)}</td>
                    <td>{pick(a, 'term_name')}</td>
                    <td className="num">{fmtNum(a.max_score)}</td>
                    <td style={{ minInlineSize: 140 }}><div className="small muted num">{fmtNum(a.entered_count)} / {fmtNum(a.roster_count)}</div><Progress value={a.roster_count ? (a.entered_count / a.roster_count) * 100 : 0} /></td>
                    <td><SheetStatus status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table></div>
        )}
        {list.data && <Pagination page={page} pageSize={25} total={list.data.total} onPage={(p) => set('page', String(p))} />}
      </div>
      {creating && <NewSheetModal termOptions={terms.data?.items || []} defaultTerm={termId} sectionId={Number(sectionId)} subject={(subjects.data?.items || []).find((s) => String(s.id) === subjectId)}
        onClose={() => setCreating(false)} />}
    </>
  );
}

function NewSheetModal({ termOptions, defaultTerm, sectionId, subject, onClose }) {
  const { t, pick, errorText, fmtNum } = useI18n();
  const cats = useApi('/academic/categories');
  const [f, setF] = useState({ term_id: defaultTerm || termOptions[0]?.id || '', category_id: '', week_no: '', title: '', max_score: subject?.default_max_score ?? 10, assessed_on: '' });
  const [err, setErr] = useState(null);
  const nav = useNavigate();
  useEffect(() => { if (cats.data && !f.category_id) setF((x) => ({ ...x, category_id: cats.data.items[0]?.id })); }, [cats.data, f.category_id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr(null);
    try {
      const title = f.title.trim() || (f.week_no ? t('weekN', { n: normalizeDigits(f.week_no) }) : '');
      const r = await api('/assessments', { method: 'POST', body: { ...f, title, section_id: sectionId, subject_id: subject.id, week_no: f.week_no ? Number(normalizeDigits(f.week_no)) : null, max_score: Number(normalizeDigits(f.max_score)), assessed_on: f.assessed_on || null } });
      nav(`/grades/sheet/${r.id}`);
    } catch (ex) { setErr(ex); }
  };
  return (
    <Modal title={`${t('newAssessment')} — ${pick(subject)}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button><button type="submit" form="nsf" className="btn btn-primary">{t('create')}</button></>}>
      {err && <div className="alert alert-bad" style={{ marginBlockEnd: 12 }}>{errorText(err)}</div>}
      <form id="nsf" className="form-grid" onSubmit={save}>
        <Field label={t('term')} required>{(p) => <select {...p} className="select" required value={f.term_id} onChange={set('term_id')}>{termOptions.map((x) => <option key={x.id} value={x.id}>{pick(x)}</option>)}</select>}</Field>
        <Field label={t('category')} required>{(p) => <select {...p} className="select" required value={f.category_id} onChange={set('category_id')}>{(cats.data?.items || []).map((c) => <option key={c.id} value={c.id}>{pick(c)} (×{fmtNum(c.weight)})</option>)}</select>}</Field>
        <Field label={t('week')}>{(p) => <input {...p} className="input" inputMode="numeric" value={f.week_no} onChange={set('week_no')} />}</Field>
        <Field label={t('title')} hint={f.week_no && !f.title ? t('weekN', { n: f.week_no }) : undefined} required={!f.week_no}>{(p) => <input {...p} className="input" maxLength={100} value={f.title} onChange={set('title')} />}</Field>
        <Field label={t('maxScore')} required>{(p) => <input {...p} className="input" inputMode="decimal" required value={f.max_score} onChange={set('max_score')} />}</Field>
        <Field label={t('assessedOn')}>{(p) => <input {...p} className="input" type="date" value={f.assessed_on} onChange={set('assessed_on')} />}</Field>
      </form>
    </Modal>
  );
}

// ---------------- Grade sheet (roster entry) ----------------
const STEPS = ['draft', 'submitted', 'approved', 'published'];

export function GradeSheetPage() {
  const { id } = useParams();
  const { t, fmtNum, fmtPct, pick, errorText } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useApi(`/assessments/${id}`);
  const [edits, setEdits] = useState({});          // student_id -> { score, status, comment, clear }
  const [conflicts, setConflicts] = useState(new Set());
  const [rowErrors, setRowErrors] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [transition, setTransition] = useState(null);
  const inputs = useRef({});
  const [find, setFind] = useState('');

  const dirtyCount = Object.keys(edits).length;
  useEffect(() => {
    const h = (e) => { if (dirtyCount) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirtyCount]);

  const a = data?.assessment;
  const perms = data?.permissions || {};
  const editable = perms.edit || perms.correct;
  const roster = data?.roster || [];

  const valueOf = useCallback((r) => {
    const e = edits[r.student_id];
    return {
      score: e && 'score' in e ? e.score : r.score ?? '',
      status: e?.status ?? r.status ?? (r.record_id ? 'graded' : 'graded'),
      comment: e && 'comment' in e ? e.comment : r.comment ?? '',
      clear: !!e?.clear,
    };
  }, [edits]);

  const edit = (r, patch) => {
    setEdits((prev) => {
      const cur = { ...(prev[r.student_id] || {}), ...patch };
      if (patch.clear === undefined) delete cur.clear;
      const v = { score: 'score' in cur ? cur.score : r.score ?? '', status: cur.status ?? r.status ?? 'graded', comment: 'comment' in cur ? cur.comment : r.comment ?? '' };
      const same = !cur.clear && r.record_id && String(v.score) === String(r.score ?? '') && v.status === r.status && (v.comment || '') === (r.comment || '');
      const untouchedNew = !cur.clear && !r.record_id && String(v.score).trim() === '' && v.status === 'graded' && !v.comment;
      const next = { ...prev };
      if (same || untouchedNew) delete next[r.student_id]; else next[r.student_id] = cur;
      return next;
    });
    setRowErrors((x) => { const n = { ...x }; delete n[r.student_id]; return n; });
  };

  const clientErrors = useMemo(() => {
    if (!a) return {};
    const out = {};
    for (const r of roster) {
      if (!edits[r.student_id] || edits[r.student_id].clear) continue;
      const v = valueOf(r);
      if (v.status === 'graded') { const e = validateScore(v.score, a.max_score, data.policy); if (e) out[r.student_id] = e; }
    }
    return out;
  }, [edits, roster, a, data, valueOf]);

  const save = async () => {
    if (!dirtyCount) { toast(t('nothingToSave')); return true; }
    if (Object.keys(clientErrors).length) { setRowErrors(clientErrors); toast(t('e_grade_validation_failed'), 'bad'); return false; }
    const rows = roster.filter((r) => edits[r.student_id]).map((r) => {
      const v = valueOf(r);
      if (v.clear) return { student_id: r.student_id, clear: true, version: r.version ?? null };
      return { student_id: r.student_id, status: v.status, score: v.status === 'graded' ? Number(normalizeDigits(v.score)) : null, comment: v.comment || null, version: r.record_id ? r.version : null };
    });
    setBusy(true);
    try {
      await api(`/assessments/${id}/grades`, { method: 'PUT', body: { rows, reason: perms.correct ? reason : undefined } });
      setEdits({}); setConflicts(new Set()); setRowErrors({}); setReason('');
      toast(t('saved')); await reload();
      return true;
    } catch (ex) {
      if (ex.code === 'grade_conflict') {
        const ids = new Set(ex.details.map((d) => d.student_id));
        setConflicts(ids);
        // Keep the user's other edits; drop edits on rows someone else changed (their value is shown instead).
        setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !ids.has(Number(k)))));
        await reload();
      } else if (ex.code === 'grade_validation_failed' && Array.isArray(ex.details)) {
        setRowErrors(Object.fromEntries(ex.details.map((d) => [d.student_id, d.code])));
      }
      toast(errorText(ex), 'bad');
      return false;
    } finally { setBusy(false); }
  };

  const doTransition = async (action, comment) => {
    if (dirtyCount && !(await save())) return;
    try {
      const fresh = await api(`/assessments/${id}`);
      await api(`/assessments/${id}/transition`, { method: 'POST', body: { action, comment: comment || null, version: fresh.assessment.version } });
      toast(t('saved')); setTransition(null); reload();
    } catch (ex) { toast(errorText(ex), 'bad'); }
  };

  const markRestMissing = () => {
    roster.filter((r) => !r.record_id && !edits[r.student_id]).forEach((r) => edit(r, { status: 'missing', score: '' }));
  };
  const deleteSheet = async () => {
    if (!(await confirm({ message: t('deleteAssessmentConfirm'), danger: true }))) return;
    try { await api(`/assessments/${id}`, { method: 'DELETE' }); window.history.back(); } catch (ex) { toast(errorText(ex), 'bad'); }
  };
  const onKey = (e, idx) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); inputs.current[idx + 1]?.focus(); inputs.current[idx + 1]?.select?.(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); inputs.current[idx - 1]?.focus(); inputs.current[idx - 1]?.select?.(); }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const pending = roster.filter((r) => !r.record_id && r.enrollment_status === 'active').length;
  const stepIdx = STEPS.indexOf(a.status === 'returned' ? 'draft' : a.status);
  return (
    <>
      <PageHead title={a.title} sub={`${pick(a, 'subject_name')} · ${t('gradeN', { n: fmtNum(a.grade_level) })} – ${a.section_name} · ${pick(a, 'term_name')} · ${ltr(a.year_name)}`}>
        <button type="button" className="btn btn-secondary" onClick={() => setShowHistory(true)}><History size={16} />{t('history')}</button>
        {a.status === 'draft' && perms.edit && roster.every((r) => !r.record_id) && <button type="button" className="btn btn-secondary" onClick={deleteSheet}><Trash2 size={16} />{t('deleteAssessment')}</button>}
      </PageHead>

      <div className="card card-pad" style={{ marginBlockEnd: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="steps" aria-label={t('workflow')}>
            {STEPS.map((s, i) => <span key={s} className={`step ${i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''}`}>{t(`gs_${s}`)}</span>)}
            {a.status === 'returned' && <SheetStatus status="returned" />}
          </div>
          <div className="row small muted">
            <span>{t('maxScore')}: <strong className="num">{fmtNum(a.max_score)}</strong></span>
            <span>{t('category')}: {pick(a, 'category_name')}</span>
            <span>{t('passMark')}: {fmtPct(a.pass_mark_percent)}</span>
          </div>
        </div>
      </div>

      <div className="stack" style={{ marginBlockEnd: 16, gap: 10 }}>
        {a.status === 'submitted' && <div className="alert alert-info">{t('lockedSubmitted')}</div>}
        {a.status === 'approved' && <div className="alert alert-info">{t('lockedApproved')}</div>}
        {a.status === 'returned' && <div className="alert alert-warn">{t('returnedNote')}</div>}
        {['draft', 'returned'].includes(a.status) && !a.grade_entry_open && <div className="alert alert-warn">{t('entryClosed')}</div>}
        {perms.correct && <div className="alert alert-warn">{t('correctionMode')}</div>}
        {conflicts.size > 0 && (
          <div className="alert alert-warn" role="alert"><AlertTriangle size={18} /><div><strong>{t('conflictTitle')}</strong><p>{t('conflictBody')}</p></div></div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="row">
            {pending > 0 && <span className="badge badge-warn">{t('pendingCount', { n: fmtNum(pending) })}</span>}
            {perms.edit && pending > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={markRestMissing}>{t('markRestMissing')}</button>}
          </div>
          <div className="row">
            <div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', insetInlineStart: 10, insetBlockStart: 10, color: 'var(--ink-3)' }} aria-hidden="true" />
              <input className="input input-sm" style={{ paddingInlineStart: 32, inlineSize: 220 }} type="search" placeholder={t('findStudent')} aria-label={t('findStudent')} value={find} onChange={(e) => setFind(e.target.value)} /></div>
            {editable && <span className="muted small">{t('fillTip')}</span>}
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ inlineSize: 40 }}>#</th><th>{t('name')}</th><th>{t('score')}</th><th>{t('status')}</th><th>{t('percent')}</th><th>{t('comment')}</th>{perms.edit && <th><span className="sr-only">{t('actions')}</span></th>}</tr></thead>
            <tbody>
              {roster.length === 0 && <tr><td colSpan={7}><Empty title={t('noStudents')} /></td></tr>}
              {roster.map((r, idx) => {
                if (find && !`${r.full_name_ckb} ${r.full_name_en || ''} ${r.student_no}`.toLowerCase().includes(find.toLowerCase())) return null;
                const v = valueOf(r);
                const err = rowErrors[r.student_id] || (edits[r.student_id] && clientErrors[r.student_id]);
                const pct = v.status === 'graded' && !validateScore(v.score, a.max_score, data.policy) ? (Number(normalizeDigits(v.score)) / a.max_score) * 100 : null;
                const fail = pct !== null && pct < a.pass_mark_percent;
                const cls = [edits[r.student_id] ? 'dirty' : '', conflicts.has(r.student_id) ? 'row-conflict' : fail ? 'row-fail' : ''].join(' ');
                return (
                  <tr key={r.student_id} className={cls}>
                    <td className="muted num">{fmtNum(idx + 1)}</td>
                    <td><div className="cell-person" style={{ minInlineSize: 160 }}><div><strong>{r.full_name_ckb}</strong><small><Code>{r.student_no}</Code>{r.change_count > 0 && ` · ${t('history')}: ${fmtNum(r.change_count)}`}</small></div></div></td>
                    <td>
                      {editable ? (
                        <>
                          <input ref={(el) => { inputs.current[idx] = el; }} className="input input-sm score-input" dir="ltr" inputMode="decimal"
                            aria-label={`${t('score')} — ${r.full_name_ckb}`} aria-invalid={err ? 'true' : undefined}
                            disabled={v.status !== 'graded' || v.clear} value={v.clear ? '' : v.score}
                            onChange={(e) => edit(r, { score: e.target.value })} onKeyDown={(e) => onKey(e, idx)} />
                          <span className="muted small"> / {fmtNum(a.max_score)}</span>
                          {err && <div className="error-text small" style={{ color: 'var(--bad)' }}>{t(`err_${err}`) !== `err_${err}` ? t(`err_${err}`) : errorText({ code: err })}</div>}
                        </>
                      ) : <span className="num" style={{ fontWeight: 700 }}>{r.record_id ? (r.status === 'graded' ? fmtNum(r.score) : '—') : '—'}</span>}
                    </td>
                    <td>
                      {editable ? (
                        <select className="select input-sm" style={{ inlineSize: 'auto' }} aria-label={`${t('status')} — ${r.full_name_ckb}`} disabled={v.clear}
                          value={v.status} onChange={(e) => edit(r, { status: e.target.value, ...(e.target.value !== 'graded' ? { score: '' } : {}) })}>
                          {['graded', 'missing', 'excused'].map((s) => <option key={s} value={s}>{t(`rs_${s}`)}</option>)}
                        </select>
                      ) : <span className={`badge ${r.record_id ? (r.status === 'graded' ? 'badge-neutral' : 'badge-warn') : 'badge-bad'}`}>{t(`rs_${r.record_id ? r.status : 'pending'}`)}</span>}
                      {editable && !r.record_id && !edits[r.student_id] && <div className="muted small">{t('rs_pending')}</div>}
                    </td>
                    <td className="num">{pct === null ? '—' : <span style={{ color: fail ? 'var(--bad)' : 'var(--ok)', fontWeight: 700 }}>{fmtPct(Math.round(pct * 10) / 10)}</span>}</td>
                    <td style={{ minInlineSize: 180 }}>
                      {editable ? <input className="input input-sm" maxLength={500} aria-label={`${t('comment')} — ${r.full_name_ckb}`} disabled={v.clear} value={v.comment} onChange={(e) => edit(r, { comment: e.target.value })} />
                        : <span className="small">{r.comment || '—'}</span>}
                    </td>
                    {perms.edit && <td>{r.record_id && (
                      <button type="button" className={`btn btn-sm ${v.clear ? 'btn-secondary' : 'btn-ghost'}`} onClick={async () => {
                        if (v.clear) edit(r, { clear: undefined });
                        else if (await confirm({ message: t('clearConfirm'), danger: true })) edit(r, { clear: true });
                      }}>{v.clear ? t('cancel') : t('clearGrade')}</button>)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="sticky-bar no-print">
          <div className="row">
            {dirtyCount > 0 ? <span className="badge badge-gold">{t('unsavedChanges', { n: fmtNum(dirtyCount) })}</span> : <span className="muted small">{t('saved')}</span>}
            {perms.correct && dirtyCount > 0 && <input className="input input-sm" style={{ inlineSize: 260 }} placeholder={t('correctionReason')} aria-label={t('correctionReason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
          </div>
          <div className="row">
            {conflicts.size > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setConflicts(new Set()); reload(); }}><RefreshCw size={16} />{t('reloadSheet')}</button>}
            {editable && <button type="button" className="btn btn-secondary" disabled={busy || !dirtyCount || (perms.correct && reason.trim().length < 5)} onClick={save}><Save size={16} />{busy ? t('saving') : perms.correct ? t('save') : t('saveDraft')}</button>}
            {perms.submit && <button type="button" className="btn btn-primary" disabled={busy || pending > 0} title={pending ? t('e_grades_incomplete') : undefined} onClick={() => doTransition('submit')}><Send size={16} className="flip-rtl" />{t('submitForApproval')}</button>}
            {perms.return && <button type="button" className="btn btn-secondary" onClick={() => setTransition('return')}><Undo2 size={16} />{t('returnForChanges')}</button>}
            {perms.approve && <button type="button" className="btn btn-primary" onClick={() => doTransition('approve')}><CheckCircle2 size={16} />{t('approve')}</button>}
            {perms.publish && <button type="button" className="btn btn-gold" onClick={() => doTransition('publish')}><Globe2 size={16} />{t('publish')}</button>}
            {perms.unpublish && <button type="button" className="btn btn-ghost" onClick={() => setTransition('unpublish')}><EyeOff size={16} />{t('unpublish')}</button>}
          </div>
        </div>
      </div>
      {transition && <CommentModal title={transition === 'return' ? t('returnForChanges') : t('unpublish')} onClose={() => setTransition(null)} onSubmit={(c) => doTransition(transition, c)} />}
      {showHistory && <HistoryModal id={id} onClose={() => setShowHistory(false)} />}
    </>
  );
}

function CommentModal({ title, onClose, onSubmit }) {
  const { t } = useI18n();
  const [c, setC] = useState('');
  return (
    <Modal size="narrow" title={title} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button><button type="button" className="btn btn-primary" disabled={!c.trim()} onClick={() => onSubmit(c.trim())}>{t('confirm')}</button></>}>
      <Field label={t('comment')} required>{(p) => <textarea {...p} className="textarea" maxLength={500} value={c} onChange={(e) => setC(e.target.value)} autoFocus />}</Field>
    </Modal>
  );
}

function HistoryModal({ id, onClose }) {
  const { t, fmtNum, fmtDateTime } = useI18n();
  const { data, loading, error } = useApi(`/assessments/${id}/history`);
  const [tab, setTab] = useState('approvals');
  return (
    <Modal size="wide" title={t('history')} onClose={onClose}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'approvals'} onClick={() => setTab('approvals')}>{t('approvals')}</button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>{t('changes')}</button>
      </div>
      {loading ? <Loading /> : error ? <ErrorState error={error} /> : tab === 'approvals' ? (
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('when')}</th><th>{t('action')}</th><th>{t('by')}</th><th>{t('comment')}</th></tr></thead>
          <tbody>{data.approvals.length === 0 && <tr><td colSpan={4} className="muted">—</td></tr>}
            {data.approvals.map((x) => <tr key={x.id}><td className="nowrap small">{fmtDateTime(x.acted_at)}</td><td>{x.action === 'correct' ? <span className="badge badge-warn">{t('correction')}</span> : <><SheetStatus status={x.from_status} /> → <SheetStatus status={x.to_status} /></>}</td><td>{x.actor_name}</td><td className="small">{x.comment || '—'}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('when')}</th><th>{t('name')}</th><th>{t('from')}</th><th>{t('to')}</th><th>{t('by')}</th><th>{t('reason')}</th></tr></thead>
          <tbody>{data.changes.length === 0 && <tr><td colSpan={6} className="muted">—</td></tr>}
            {data.changes.map((x) => <tr key={x.id}><td className="nowrap small">{fmtDateTime(x.changed_at)}</td><td>{x.full_name_ckb}</td>
              <td className="num">{x.old_status === 'graded' ? fmtNum(x.old_score) : t(`rs_${x.old_status}`)}</td><td className="num">{x.new_status === 'graded' ? fmtNum(x.new_score) : t(`rs_${x.new_status}`)}</td>
              <td>{x.actor_name}</td><td className="small">{x.is_correction && <span className="badge badge-warn">{t('correction')}</span>} {x.reason || ''}</td></tr>)}</tbody></table></div>
      )}
    </Modal>
  );
}
