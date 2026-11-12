import { useEffect, useState } from 'react';
import { Save, Globe2, Info } from 'lucide-react';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useApi, useYears } from '../lib/hooks';
import { Code, Empty, ErrorState, Field, PageHead, SkeletonRows, StudentAvatar, useToast } from '../components/ui';
import { sectionLabel } from './Students';

const RATINGS = ['excellent', 'very_good', 'good', 'average', 'needs_improvement'];

/** Weekly behavior evaluation for one class (principal or the class's homeroom teacher). */
export default function BehaviorPage() {
  const { t, fmtNum, pick, errorText } = useI18n();
  const toast = useToast();
  const { current: year } = useYears();
  const sections = useApi('/behavior/sections');
  const terms = useApi('/academic/terms', { yearId: year?.id }, { skip: !year });
  const [f, setF] = useState({ sectionId: '', termId: '', week: '1' });
  useEffect(() => { if (!f.sectionId && sections.data?.items[0]) setF((x) => ({ ...x, sectionId: String(sections.data.items[0].id) })); }, [sections.data, f.sectionId]);
  useEffect(() => { if (!f.termId && terms.data?.items[0]) setF((x) => ({ ...x, termId: String(terms.data.items[0].id) })); }, [terms.data, f.termId]);
  const ready = f.sectionId && f.termId && f.week;
  const list = useApi('/behavior', { sectionId: f.sectionId, termId: f.termId, week: f.week }, { skip: !ready });
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setEdits({}), [list.data]);
  const rows = list.data?.items || [];
  const val = (r, k) => (edits[r.student_id] && k in edits[r.student_id] ? edits[r.student_id][k] : r[k] || '');
  const set = (r, k, v) => setEdits((e) => ({ ...e, [r.student_id]: { ...(e[r.student_id] || {}), [k]: v } }));
  const save = async (publish) => {
    setBusy(true);
    try {
      const body = { section_id: Number(f.sectionId), term_id: Number(f.termId), week_no: Number(f.week), publish,
        rows: rows.filter((r) => val(r, 'rating')).map((r) => ({ student_id: r.student_id, rating: val(r, 'rating'), comment: val(r, 'comment') || null })) };
      if (!body.rows.length) { toast(t('nothingToSave')); return; }
      const res = await api('/behavior', { method: 'PUT', body });
      toast(publish ? t('behaviorPublished', { n: fmtNum(res.saved) }) : t('saved'));
      list.reload();
    } catch (ex) { toast(errorText(ex), 'bad'); } finally { setBusy(false); }
  };
  const fillAll = (rating) => rows.forEach((r) => { if (!val(r, 'rating')) set(r, 'rating', rating); });
  if (sections.data && sections.data.items.length === 0) return <><PageHead title={t('behaviorTitle')} /><div className="card"><Empty title={t('behaviorNoClasses')} /></div></>;
  return (
    <>
      <PageHead title={t('behaviorTitle')} />
      <div className="help"><Info size={18} aria-hidden="true" style={{ flexShrink: 0 }} /><span>{t('behaviorHelp')}</span></div>
      <div className="card">
        <div className="filters">
          <Field label={t('section')}>{(p) => <select {...p} className="select" value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>{(sections.data?.items || []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(t, fmtNum, s)}</option>)}</select>}</Field>
          <Field label={t('term')}>{(p) => <select {...p} className="select" value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}>{(terms.data?.items || []).map((x) => <option key={x.id} value={x.id}>{pick(x)}</option>)}</select>}</Field>
          <Field label={t('week')}>{(p) => <select {...p} className="select" value={f.week} onChange={(e) => setF({ ...f, week: e.target.value })}>{Array.from({ length: 40 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>{t('weekN', { n: fmtNum(w) })}</option>)}</select>}</Field>
          <Field label={t('fillEmptyWith')}>{(p) => <select {...p} className="select" value="" onChange={(e) => e.target.value && fillAll(e.target.value)}><option value="">—</option>{RATINGS.map((r) => <option key={r} value={r}>{t(`beh_${r}`)}</option>)}</select>}</Field>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('name')}</th><th>{t('behaviorEvaluation')}</th><th>{t('comment')}</th><th>{t('status')}</th></tr></thead>
            {list.loading && !list.data ? <SkeletonRows cols={4} /> : <tbody>
              {rows.length === 0 && <tr><td colSpan={4}><Empty title={t('noStudents')} /></td></tr>}
              {rows.map((r) => (
                <tr key={r.student_id} className={edits[r.student_id] ? 'dirty' : ''}>
                  <td><div className="cell-person"><StudentAvatar student={{ id: r.student_id, ...r }} /><div><strong>{r.full_name_ckb}</strong><small><Code>{r.student_no}</Code></small></div></div></td>
                  <td><select className="select input-sm" style={{ inlineSize: 'auto' }} aria-label={`${t('behaviorEvaluation')} — ${r.full_name_ckb}`} value={val(r, 'rating')} onChange={(e) => set(r, 'rating', e.target.value)}>
                    <option value="">—</option>{RATINGS.map((x) => <option key={x} value={x}>{t(`beh_${x}`)}</option>)}</select></td>
                  <td><input className="input input-sm" maxLength={300} aria-label={`${t('comment')} — ${r.full_name_ckb}`} value={val(r, 'comment')} onChange={(e) => set(r, 'comment', e.target.value)} /></td>
                  <td>{r.status ? <span className={`badge ${r.status === 'published' ? 'badge-ok' : 'badge-neutral'}`}>{t(r.status === 'published' ? 'gs_published' : 'gs_draft')}</span> : <span className="muted small">{t('notEvaluated')}</span>}</td>
                </tr>
              ))}
            </tbody>}
          </table></div>
        )}
        <div className="sticky-bar no-print">
          <span className="muted small">{Object.keys(edits).length ? t('unsavedChanges', { n: fmtNum(Object.keys(edits).length) }) : ''}</span>
          <div className="row">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(false)}><Save size={16} />{t('saveDraft')}</button>
            <button type="button" className="btn btn-gold" disabled={busy} onClick={() => save(true)}><Globe2 size={16} />{t('publishBehavior')}</button>
          </div>
        </div>
      </div>
    </>
  );
}
