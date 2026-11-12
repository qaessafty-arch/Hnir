import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Printer, ChevronLeft, ChevronRight, ClipboardList, LineChart } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/hooks';
import { ltr } from '../lib/api';
import { HBarChart } from '../components/charts';
import { Code, Empty, ErrorState, Field, Loading, StudentAvatar } from '../components/ui';

/** Percentage badge tiers: 90–100 green · 70–89 light green · 50–69 amber · below 50 light red. */
export function pctTier(p) {
  if (p === null || p === undefined) return 'pct-none';
  if (p >= 90) return 'pct-a';
  if (p >= 70) return 'pct-b';
  if (p >= 50) return 'pct-c';
  return 'pct-d';
}
export function PctBadge({ value }) {
  const { fmtPct } = useI18n();
  return <span className={`pct ${pctTier(value)}`}>{value === null || value === undefined ? '—' : fmtPct(value)}</span>;
}
export function subjectNames(pick, lang, r, base = 'subject_name') {
  const main = pick(r, base);
  const other = lang === 'ckb' ? r[`${base}_en`] : r[`${base}_ckb`];
  return { main, other: other && other !== main ? other : null };
}

/**
 * Weekly Student Grade Card (the student-facing reference design).
 * Used by the student portal and by staff (Students → open student → Weekly grade card).
 */
export default function WeeklyCard({ studentId, printBase = '/print/report' }) {
  const { t, lang, pick, fmtNum, fmtPct, fmtDate } = useI18n();
  const nav = useNavigate();
  const [sel, setSel] = useState({ yearId: '', termId: '', week: '' });
  const { data, loading, error, reload } = useApi(`/weekly/students/${studentId}`, sel);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const d = data;
  const s = d.student;
  const weeks = d.weeks || [];
  const idx = weeks.indexOf(d.week);
  const go = (patch) => setSel((x) => ({ ...x, ...patch }));
  const printUrl = `${printBase}/${studentId}?${new URLSearchParams({ ...(d.year ? { yearId: d.year.id } : {}), ...(d.term ? { termId: d.term.id } : {}), ...(d.week ? { week: d.week } : {}), autoprint: '1' })}`;
  const overallGood = d.overall?.percent != null && d.overall.percent >= 50;

  return (
    <div className="wk">
      {/* Profile card */}
      <section className="card wk-profile">
        <div className="wk-person">
          <StudentAvatar student={s} size="avatar-xl" />
          <div className="wk-person-text">
            <h1>{s.full_name_ckb}</h1>
            {s.full_name_en && <p className="wk-en" dir="ltr">{s.full_name_en}</p>}
            <p className="wk-meta">
              <span className="wk-id"><Code>{s.student_no}</Code></span>
              {s.grade_level && <span>{t('gradeN', { n: fmtNum(s.grade_level) })} – {s.section_name}</span>}
              {d.year && <span>{ltr(d.year.name)}</span>}
              {d.term && <span>{pick(d.term)}</span>}
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-gold wk-print no-print" onClick={() => nav(printUrl)} disabled={!d.week}>
          <Printer size={18} />{t('printGradeCard')}
        </button>
      </section>

      {/* Three summary cards */}
      <div className="wk-stats">
        <div className={`card wk-stat ${overallGood ? 'acc-ok' : 'acc-bad'}`}>
          <span className="wk-stat-label">{t('overallPerformance')}</span>
          <span className={`wk-stat-value ${overallGood ? 'ok' : 'bad'}`}>{fmtPct(d.overall?.percent)}</span>
          <span className="wk-stat-sub">{d.overall?.band ? t(`band_${d.overall.band}`) : t('noGradesShort')}</span>
        </div>
        <div className="card wk-stat acc-navy">
          <span className="wk-stat-label">{t('weeklyAverage')}{d.week ? ` · ${t('weekN', { n: fmtNum(d.week) })}` : ''}</span>
          <span className="wk-stat-value">{fmtPct(d.week_summary?.average_percent)}</span>
          <span className="wk-stat-sub">{d.week_summary?.scale_max ? t('onScale', { v: fmtNum(d.week_summary.average_on_scale), max: fmtNum(d.week_summary.scale_max) }) : d.week_summary?.subjects ? t('subjectsN', { n: fmtNum(d.week_summary.subjects) }) : '—'}</span>
        </div>
        <div className="card wk-stat acc-gold">
          <span className="wk-stat-label">{t('behaviorEvaluation')}</span>
          <span className={`wk-stat-value beh ${d.behavior ? `beh-${d.behavior.rating}` : ''}`}>{d.behavior ? t(`beh_${d.behavior.rating}`) : '—'}</span>
          <span className="wk-stat-sub">{d.behavior?.comment || (d.behavior ? '' : t('notEvaluated'))}</span>
        </div>
      </div>

      {/* Week navigation */}
      <section className="card wk-nav no-print" aria-label={t('weekNavigation')}>
        <Field label={t('year')}>{(p) => <select {...p} className="select" value={d.year?.id || ''} onChange={(e) => go({ yearId: e.target.value, termId: '', week: '' })}>{d.years.map((y) => <option key={y.id} value={y.id}>{ltr(y.name)}</option>)}</select>}</Field>
        <Field label={t('term')}>{(p) => <select {...p} className="select" value={d.term?.id || ''} onChange={(e) => go({ termId: e.target.value, week: '' })}>{d.terms.map((x) => <option key={x.id} value={x.id}>{pick(x)}</option>)}</select>}</Field>
        <div className="wk-weekpick">
          <button type="button" className="btn btn-secondary btn-icon" aria-label={t('previousWeek')} disabled={idx <= 0} onClick={() => go({ week: weeks[idx - 1] })}><ChevronRight size={18} className="flip-ltr" /></button>
          <Field label={t('week')}>{(p) => <select {...p} className="select" value={d.week || ''} onChange={(e) => go({ week: e.target.value })} disabled={!weeks.length}>
            {weeks.length === 0 && <option value="">—</option>}
            {weeks.map((w) => <option key={w} value={w}>{t('weekN', { n: fmtNum(w) })}</option>)}</select>}</Field>
          <button type="button" className="btn btn-secondary btn-icon" aria-label={t('nextWeek')} disabled={idx < 0 || idx >= weeks.length - 1} onClick={() => go({ week: weeks[idx + 1] })}><ChevronLeft size={18} className="flip-ltr" /></button>
        </div>
      </section>

      {/* Weekly grade table */}
      <section className="card wk-table">
        <div className="wk-table-head">
          <h2>{t('weeklyGradeCard')}</h2>
          <span className="wk-school">{d.school?.name_en}</span>
        </div>
        {d.rows.length === 0 ? <Empty icon={ClipboardList} title={t('noGrades')} hint={t('noGradesHint')} /> : (
          <div className="table-wrap"><table className="table wk-grid">
            <thead><tr><th>{t('subject')}</th><th>{t('week')}</th><th className="c">{t('obtainedMarks')}</th><th className="c">{t('maximumMarks')}</th><th className="c">{t('percentage')}</th><th>{t('teacherComments')}</th></tr></thead>
            <tbody>
              {d.rows.map((r) => {
                const low = r.percent !== null && r.percent < r.pass_mark_percent;
                const n = subjectNames(pick, lang, r);
                return (
                  <tr key={r.assessment_id} className={low ? 'wk-low' : ''}>
                    <td><strong className="wk-subj">{n.main}</strong>{n.other && <span className="wk-subj2">{n.other}</span>}{r.title && !/^(week|هەفتە)/i.test(r.title) && <span className="wk-subj2">{r.title}</span>}</td>
                    <td className="muted nowrap">{t('weekN', { n: fmtNum(r.week_no) })}</td>
                    <td className="c"><span className={`wk-score ${low ? 'low' : ''}`}>{r.score !== null ? fmtNum(r.score) : t(`rs_${r.status}`)}</span></td>
                    <td className="c muted num">/ {fmtNum(r.max_score)}</td>
                    <td className="c"><PctBadge value={r.percent} /></td>
                    <td className="wk-comment">{r.comment || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </section>

      {/* Performance history */}
      {d.history.length > 0 && (
        <details className="card wk-history">
          <summary><LineChart size={18} aria-hidden="true" /><span>{t('performanceHistory')}<small className="wk-history-hint">{t('performanceHistoryHint')}</small></span></summary>
          <div className="wk-history-body">
            <div className="wk-chips">
              {d.term_averages.map((ta) => <span key={ta.term_id} className="wk-chip">{t('termAverage')} · {pick(ta)}: <strong>{fmtPct(ta.average_percent)}</strong></span>)}
              <span className="wk-chip">{t('overallPerformance')}: <strong>{fmtPct(d.overall.percent)}</strong></span>
            </div>
            <h3>{t('weeklyAverageHistory')}</h3>
            <HBarChart items={d.history.map((h) => ({ key: h.week_no, label: t('weekN', { n: fmtNum(h.week_no) }), value: h.average_percent, passMark: 50 }))} />
            <h3 style={{ marginBlockStart: 18 }}>{t('subjectProgress')}</h3>
            <div className="table-wrap"><table className="table no-stack wk-progress">
              <thead><tr><th>{t('subject')}</th>{d.history.map((h) => <th key={h.week_no} className="c">{t('weekN', { n: fmtNum(h.week_no) })}</th>)}<th className="c">{t('change')}</th></tr></thead>
              <tbody>{d.by_subject.map((sj) => {
                const vals = d.history.map((h) => sj.weeks[h.week_no]).filter((v) => v !== null && v !== undefined);
                const delta = vals.length >= 2 ? vals[vals.length - 1] - vals[vals.length - 2] : null;
                return (
                  <tr key={sj.subject_id}><td>{pick(sj)}</td>
                    {d.history.map((h) => <td key={h.week_no} className="c"><PctBadge value={sj.weeks[h.week_no]} /></td>)}
                    <td className={`c num ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>{delta === null ? '—' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${fmtNum(Math.abs(Math.round(delta)))}`}</td></tr>
                );
              })}</tbody>
            </table></div>
          </div>
        </details>
      )}
      <p className="muted small wk-foot">{t('generatedOn')}: {fmtDate(d.generated_at)}{d.scope.publishedOnly ? '' : ` · ${t('includesUnpublished')}`}</p>
    </div>
  );
}

export function StaffWeeklyPage({ id }) {
  const { t } = useI18n();
  return (
    <>
      <div className="no-print" style={{ marginBlockEnd: 12 }}><Link to={`/students/${id}`} className="btn btn-ghost btn-sm">{t('back')}</Link></div>
      <WeeklyCard studentId={id} />
    </>
  );
}
