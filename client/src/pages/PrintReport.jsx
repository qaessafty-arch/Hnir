import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Printer, ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/hooks';
import { ltr } from '../lib/api';
import Logo from '../components/Logo';
import { Code, ErrorState, Loading, StudentAvatar } from '../components/ui';
import { PctBadge, subjectNames } from './WeeklyCard';

/** Dedicated A4 report card for one student and one week (no app navigation; prints cleanly). */
export default function PrintReport() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { t, lang, pick, fmtNum, fmtPct, fmtDateTime } = useI18n();
  const params = { yearId: sp.get('yearId') || '', termId: sp.get('termId') || '', week: sp.get('week') || '' };
  const { data, loading, error, reload } = useApi(`/weekly/students/${id}`, params);
  useEffect(() => {
    if (data && sp.get('autoprint') === '1') { const timer = setTimeout(() => window.print(), 600); return () => clearTimeout(timer); }
    return undefined;
  }, [data, sp]);
  if (loading && !data) return <div className="print-page"><Loading /></div>;
  if (error) return <div className="print-page"><ErrorState error={error} onRetry={reload} /></div>;
  const d = data; const s = d.student;
  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => nav(-1)}><ArrowRight size={16} className="flip-ltr" />{t('back')}</button>
        <button type="button" className="btn btn-gold" onClick={() => window.print()}><Printer size={16} />{t('print')}</button>
      </div>
      <article className="a4">
        <header className="a4-head">
          <Logo size={86} />
          <div className="a4-titles">
            <h1>{d.school?.name_ckb}</h1>
            <p dir="ltr">{d.school?.name_en}</p>
            <h2>{t('weeklyReportTitle')}</h2>
          </div>
          <StudentAvatar student={s} size="avatar-xl" />
        </header>
        <dl className="a4-info">
          <div><dt>{t('name')}</dt><dd>{s.full_name_ckb}{s.full_name_en && <span className="a4-en" dir="ltr">{s.full_name_en}</span>}</dd></div>
          <div><dt>{t('studentNo')}</dt><dd><Code>{s.student_no}</Code></dd></div>
          <div><dt>{t('class')}</dt><dd>{s.grade_level ? `${t('gradeN', { n: fmtNum(s.grade_level) })} – ${s.section_name}` : '—'}</dd></div>
          <div><dt>{t('year')}</dt><dd>{d.year ? ltr(d.year.name) : '—'}</dd></div>
          <div><dt>{t('term')}</dt><dd>{d.term ? pick(d.term) : '—'}</dd></div>
          <div><dt>{t('week')}</dt><dd>{d.week ? t('weekN', { n: fmtNum(d.week) }) : '—'}</dd></div>
        </dl>
        <table className="a4-table">
          <thead><tr><th>{t('subject')}</th><th>{t('obtainedMarks')}</th><th>{t('maximumMarks')}</th><th>{t('percentage')}</th><th>{t('teacherComments')}</th></tr></thead>
          <tbody>
            {d.rows.length === 0 && <tr><td colSpan={5} className="c">{t('noGrades')}</td></tr>}
            {d.rows.map((r) => { const n = subjectNames(pick, lang, r); return (
              <tr key={r.assessment_id}><td>{n.main}{n.other && <span className="a4-sub"> / {n.other}</span>}</td>
                <td className="c num">{r.score !== null ? fmtNum(r.score) : t(`rs_${r.status}`)}</td><td className="c num">{fmtNum(r.max_score)}</td>
                <td className="c"><PctBadge value={r.percent} /></td><td>{r.comment || ''}</td></tr>); })}
          </tbody>
        </table>
        <div className="a4-summary">
          <div><span>{t('weeklyAverage')}</span><strong>{fmtPct(d.week_summary?.average_percent)}</strong>{d.week_summary?.scale_max && <em>{t('onScale', { v: fmtNum(d.week_summary.average_on_scale), max: fmtNum(d.week_summary.scale_max) })}</em>}</div>
          <div><span>{t('overallPerformance')}</span><strong>{fmtPct(d.overall?.percent)}</strong>{d.overall?.band && <em>{t(`band_${d.overall.band}`)}</em>}</div>
          <div><span>{t('behaviorEvaluation')}</span><strong className="small-text">{d.behavior ? t(`beh_${d.behavior.rating}`) : '—'}</strong>{d.behavior?.comment && <em>{d.behavior.comment}</em>}</div>
        </div>
        <div className="a4-signs"><div>{t('signatureTeacher')}</div><div>{t('signaturePrincipal')}</div><div>{t('schoolStamp')}</div></div>
        <footer className="a4-foot">{t('generatedOn')}: {fmtDateTime(d.generated_at)} · {d.school?.name_en}</footer>
      </article>
    </div>
  );
}
