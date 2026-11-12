import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TrendingUp, CheckCircle2, LifeBuoy, GraduationCap, FileText, Download } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { csvBlob, ltr, saveBlob } from '../lib/api';
import { useApi, useYears } from '../lib/hooks';
import Hub from '../components/Hub';
import { HBarChart, Kpi } from '../components/charts';
import { BandBadge, Code, Empty, ErrorState, Field, Loading, StudentAvatar } from '../components/ui';
import { ClassSummary, GradeOverviewPage, ReportCardSearch } from './Reports';
import { sectionLabel } from './Students';

/** Shared filter row for analysis views. */
function useAnalysisFilters() {
  const { current: year } = useYears();
  const [f, setF] = useState({ termId: '', classId: '', publishedOnly: '0' });
  const data = useApi('/analytics', { ...f, yearId: year?.id }, { skip: !year });
  return { year, f, setF, ...data };
}

function Filters({ f, setF }) {
  const { t, fmtNum, pick } = useI18n();
  const { current: year } = useYears();
  const terms = useApi('/academic/terms', { yearId: year?.id }, { skip: !year });
  const classes = useApi('/academic/classes');
  return (
    <div className="card filters no-print" style={{ borderRadius: 'var(--radius)', marginBlockEnd: 16 }}>
      <Field label={t('term')}>{(p) => <select {...p} className="select" value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}><option value="">{t('wholeYear')}</option>{(terms.data?.items || []).map((x) => <option key={x.id} value={x.id}>{pick(x)}</option>)}</select>}</Field>
      <Field label={t('grade')}>{(p) => <select {...p} className="select" value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">{t('all')}</option>{(classes.data?.items || []).map((c) => <option key={c.id} value={c.id}>{t('gradeN', { n: fmtNum(c.grade_level) })}</option>)}</select>}</Field>
      <label className="checkbox" style={{ paddingBlockEnd: 8 }}><input type="checkbox" checked={f.publishedOnly === '1'} onChange={(e) => setF({ ...f, publishedOnly: e.target.checked ? '1' : '0' })} />{t('publishedOnly')}</label>
    </div>
  );
}

export function KpiRow({ k }) {
  const { t, fmtNum, fmtPct } = useI18n();
  return (
    <div className="grid grid-4" style={{ marginBlockEnd: 16 }}>
      <Kpi icon={GraduationCap} label={t('kpiStudents')} value={fmtNum(k.students)} caption={t('withGrades', { n: fmtNum(k.graded) })} />
      <Kpi icon={TrendingUp} label={t('kpiAverage')} value={fmtPct(k.average)} caption={k.average_band ? t(`band_${k.average_band}`) : t('kpiAverageCaption')} tone="gold" />
      <Kpi icon={CheckCircle2} label={t('kpiPassRate')} value={fmtPct(k.pass_rate)} caption={t('kpiPassRateCaption', { n: fmtNum(k.graded - k.at_risk), total: fmtNum(k.graded) })} tone="ok" />
      <Kpi icon={LifeBuoy} label={t('kpiAtRisk')} value={fmtNum(k.at_risk)} caption={t('kpiAtRiskCaption')} tone={k.at_risk ? 'warn' : 'ok'} />
    </div>
  );
}

function ChartCard({ title, hint, children, action }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <div className="card-head"><div><h2>{title}</h2>{hint && <p className="muted small">{hint}</p>}</div>{action}</div>
      <div className="card-body">
        {children}
        <div className="chart-legend" aria-hidden="true"><span><i style={{ background: 'var(--navy-800)' }} />{t('legendBar')}</span><span><i style={{ background: 'var(--bad)' }} />{t('legendBad')}</span><span><i className="tick" />{t('legendTick')}</span></div>
      </div>
    </section>
  );
}

export function SubjectChart({ subjects }) {
  const { t, pick, fmtNum } = useI18n();
  const items = [...subjects].sort((a, b) => a.average - b.average)
    .map((s) => ({ key: s.id, label: pick(s), value: s.average, passMark: s.pass_mark_percent, note: t('passRateN', { n: fmtNum(s.pass_rate) }) }));
  return <ChartCard title={t('chartSubjects')} hint={t('chartSubjectsHint')}><HBarChart items={items} emptyText={t('noData')} /></ChartCard>;
}

export function ClassChart({ sections, onSelect }) {
  const { t, fmtNum } = useI18n();
  const items = sections.filter((s) => s.average != null)
    .map((s) => ({ key: s.id, id: s.id, label: sectionLabel(t, fmtNum, s), value: s.average, note: t('passRateN', { n: fmtNum(s.pass_rate) }) }));
  return <ChartCard title={t('chartClasses')} hint={t('chartClassesHint')}><HBarChart items={items} emptyText={t('noData')} onSelect={onSelect} /></ChartCard>;
}

function BandChart({ bands, total }) {
  const { t, fmtNum, fmtPct } = useI18n();
  return (
    <section className="card">
      <div className="card-head"><h2>{t('chartBands')}</h2></div>
      <div className="card-body">
        <HBarChart unit="" max={Math.max(1, ...bands.map((b) => b.count))}
          items={bands.map((b) => ({ key: b.key, label: `${t(`band_${b.key}`)} (${ltr(`≥${fmtNum(b.min)}%`)})`, value: b.count, note: total ? fmtPct(Math.round((b.count / total) * 100)) : null }))} />
      </div>
    </section>
  );
}

function StudentList({ items, showFailed = false, pageSize = 25 }) {
  const { t, fmtNum, fmtPct, pick } = useI18n();
  const [shown, setShown] = useState(pageSize);
  if (!items.length) return <Empty icon={CheckCircle2} title={t('noData')} />;
  return (
    <>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>{t('name')}</th><th>{t('class')}</th><th>{t('overall')}</th>{showFailed && <th>{t('failedSubjects')}</th>}<th><span className="sr-only">{t('actions')}</span></th></tr></thead>
      <tbody>{items.slice(0, shown).map((s) => (
        <tr key={s.id}>
          <td><div className="cell-person"><StudentAvatar student={s} /><div><strong>{s.full_name_ckb}</strong><small><Code>{s.student_no}</Code></small></div></div></td>
          <td className="nowrap">{sectionLabel(t, fmtNum, s)}</td>
          <td><span className="num" style={{ fontWeight: 700 }}>{fmtPct(s.overall_percent)}</span> <BandBadge band={s.overall_band} /></td>
          {showFailed && <td><div className="chips">{s.failed_subjects.map((f) => <span key={f.id} className="badge badge-bad">{pick(f)} {fmtNum(f.percent)}%</span>)}</div></td>}
          <td><div className="actions"><Link className="btn btn-secondary btn-sm" to={`/reports/student/${s.id}`}><FileText size={15} />{t('reportCard')}</Link></div></td>
        </tr>))}
      </tbody>
    </table></div>
    {items.length > shown && (
      <div className="pagination"><span className="muted small">{fmtNum(shown)} / {fmtNum(items.length)}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShown((n) => n + pageSize)}>{t('showMore')}</button></div>
    )}
    </>
  );
}

function Overview({ goClass }) {
  const { t } = useI18n();
  const a = useAnalysisFilters();
  return (
    <>
      <Filters f={a.f} setF={a.setF} />
      {a.loading && !a.data ? <Loading /> : a.error ? <ErrorState error={a.error} onRetry={a.reload} /> : !a.data?.kpis ? <div className="card"><Empty title={t('noCurrentYear')} /></div> : (
        <>
          {a.f.publishedOnly !== '1' && <p className="muted small" style={{ marginBlockEnd: 10 }}>{t('includesUnpublished')}</p>}
          <KpiRow k={a.data.kpis} />
          <div className="grid grid-2">
            <SubjectChart subjects={a.data.subjects} />
            <ClassChart sections={a.data.sections} onSelect={goClass} />
            <BandChart bands={a.data.bands} total={a.data.kpis.graded} />
            <section className="card"><div className="card-head"><h2>{t('topStudents')}</h2></div><StudentList items={a.data.top} /></section>
          </div>
        </>
      )}
    </>
  );
}

function AtRisk() {
  const { t, fmtNum, pick } = useI18n();
  const a = useAnalysisFilters();
  const exportCsv = () => saveBlob(csvBlob(['student_no', 'name', 'class', 'overall_percent', 'subjects_below_pass'],
    a.data.at_risk.map((s) => [s.student_no, s.full_name_ckb, sectionLabel(t, fmtNum, s), s.overall_percent, s.failed_subjects.map((f) => `${pick(f)} ${f.percent}%`).join('; ')])), 'students-needing-help.csv');
  return (
    <>
      <Filters f={a.f} setF={a.setF} />
      <section className="card">
        <div className="card-head"><div><h2>{t('atRiskTitle')} {a.data?.at_risk_total != null && <span className="badge badge-warn">{fmtNum(a.data.at_risk_total)}</span>}</h2><p className="muted small">{t('atRiskHint')}</p></div>
          {a.data?.at_risk?.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}><Download size={15} />{t('exportCsv')}</button>}</div>
        {a.loading && !a.data ? <Loading /> : a.error ? <ErrorState error={a.error} onRetry={a.reload} /> : <StudentList items={a.data?.at_risk || []} showFailed />}
      </section>
    </>
  );
}

export default function ResultsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [classFocus, setClassFocus] = useState(null);
  const [, setSp] = useSearchParams();
  return (
    <Hub title={t('navResults')} help={t('resultsSub')} tabs={[
      { key: 'overview', label: t('tabOverview'), render: () => <Overview goClass={(it) => { setClassFocus(it.id); setSp({ tab: 'classes' }); }} /> },
      { key: 'help', label: t('tabAtRisk'), render: () => <AtRisk /> },
      { key: 'classes', label: t('tabClasses'), render: () => <ClassSummary key={classFocus || 'x'} initialSectionId={classFocus} /> },
      { key: 'grades', label: t('tabAllGrades'), perms: ['grades.read_all', 'grades.enter'], render: () => <GradeOverviewPage /> },
      { key: 'cards', label: t('tabReportCards'), perms: ['students.read'], render: () => <ReportCardSearch /> },
    ].filter((x) => x.key !== 'cards' || can('students.read'))} />
  );
}
