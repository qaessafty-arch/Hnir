import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer, Download, Search, FileText, GraduationCap } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { download, ltr } from '../lib/api';
import { useApi, useDebounced, useYears } from '../lib/hooks';
import Logo from '../components/Logo';
import { BandBadge, Code, Empty, ErrorState, Field, Loading, PageHead, Pagination, Progress, SheetStatus, SkeletonRows, SortHeader, StudentAvatar, useToast } from '../components/ui';
import { sectionLabel } from './Students';

// ---------------- Report card (shared by staff and student views) ----------------
export function ReportCard({ studentId, showControls = true }) {
  const { t, fmtNum, fmtPct, fmtDate, fmtDateTime, pick, errorText } = useI18n();
  const toast = useToast();
  const [termId, setTermId] = useState('');
  const terms = useApi(`/portal/students/${studentId}/terms`);
  const { data, loading, error, reload } = useApi(`/reports/student/${studentId}`, { termId });
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const exportCsv = () => download(`/reports/student/${studentId}`, { termId, format: 'csv' }, `report-${data.student.student_no}.csv`).catch((e) => toast(errorText(e), 'bad'));
  const byAssessment = data.assessments;
  return (
    <div className="stack">
      {showControls && (
        <div className="card card-pad no-print row" style={{ justifyContent: 'space-between' }}>
          <Field label={t('term')}>{(p) => (
            <select {...p} className="select" value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">{t('wholeYear')}</option>
              {(terms.data?.items || []).map((x) => <option key={x.id} value={x.id}>{pick(x)} — {ltr(x.year_name)}</option>)}
            </select>)}
          </Field>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={exportCsv}><Download size={16} />{t('exportCsv')}</button>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={16} />{t('print')}</button>
          </div>
        </div>
      )}
      <article className="card card-pad report" aria-label={t('reportCard')}>
        <header className="report-head">
          <Logo size={84} />
          <div className="titles">
            <h2>{pick(data.school)}</h2>
            <p className="muted">{lang2(data.school, pick)}</p>
            <p style={{ fontWeight: 700, marginBlockStart: 4 }}>{t('reportCard')} — {data.term ? pick(data.term) : t('wholeYear')}</p>
          </div>
          <StudentAvatar student={data.student} size="avatar-lg" />
        </header>
        <div className="report-meta">
          <div><span>{t('name')}</span><strong>{data.student.full_name_ckb}</strong>{data.student.full_name_en && <div className="small" dir="ltr">{data.student.full_name_en}</div>}</div>
          <div><span>{t('studentNo')}</span><strong><Code>{data.student.student_no}</Code></strong></div>
          <div><span>{t('class')}</span><strong>{data.student.grade_level ? sectionLabel(t, fmtNum, data.student) : '—'}</strong></div>
          <div><span>{t('year')}</span><strong><bdi dir="ltr">{data.student.year_name || '—'}</bdi></strong></div>
        </div>
        {data.scope.teacherScoped && <div className="alert alert-info no-print" style={{ marginBlockStart: 12 }}>{t('teacherScopeNote')}</div>}
        {data.subjects.length === 0 ? <Empty icon={GraduationCap} title={t('noGrades')} hint={t('noGradesHint')} /> : (
          <>
            <div className="grid grid-3" style={{ marginBlock: 16 }}>
              <div className="card stat"><div><div className="stat-label">{t('overallAverage')}</div><div className="stat-value num">{fmtPct(data.overall_percent)}</div><Progress value={data.overall_percent} /></div></div>
              <div className="card stat"><div><div className="stat-label">{t('performance')}</div><div style={{ marginBlockStart: 6 }}><BandBadge band={data.overall_band} /></div></div></div>
              <div className="card stat"><div><div className="stat-label">{t('subjectsPassed')} / {t('subjectsFailed')}</div><div className="stat-value num">{fmtNum(data.subjects_passed)} / <span style={{ color: data.subjects_failed ? 'var(--bad)' : undefined }}>{fmtNum(data.subjects_failed)}</span></div></div></div>
            </div>
            <h3 style={{ marginBlockEnd: 8 }}>{t('subjectPerformance')}</h3>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('subject')}</th><th>{t('totalScore')}</th><th>{t('percent')}</th><th>{t('passMark')}</th><th>{t('performance')}</th><th>{t('status')}</th></tr></thead>
              <tbody>{data.subjects.map((s) => (
                <tr key={s.subject_id} className={s.passed === false ? 'row-fail' : ''}>
                  <td><strong>{pick(s)}</strong></td>
                  <td className="num">{fmtNum(s.total_score)} / {fmtNum(s.total_max)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmtPct(s.percent)}</td>
                  <td className="num muted">{fmtPct(s.pass_mark_percent)}</td>
                  <td><BandBadge band={s.band} /></td>
                  <td>{s.passed === null ? '—' : s.passed ? <span className="badge badge-ok">{t('passed')}</span> : <span className="badge badge-bad">{t('failed')}</span>}
                    {(s.missing > 0 || s.excused > 0) && <div className="muted small">{s.missing > 0 && `${t('rs_missing')}: ${fmtNum(s.missing)} `}{s.excused > 0 && `${t('rs_excused')}: ${fmtNum(s.excused)}`}</div>}</td>
                </tr>))}</tbody>
            </table></div>
            <h3 style={{ marginBlock: '20px 8px' }}>{t('assessmentHistory')}</h3>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('subject')}</th><th>{t('term')}</th><th>{t('assessment')}</th><th>{t('score')}</th><th>{t('percent')}</th><th>{t('teacherFeedback')}</th>{!data.scope.publishedOnly && <th className="no-print">{t('status')}</th>}</tr></thead>
              <tbody>{byAssessment.map((x) => {
                const subj = data.subjects.find((s) => s.subject_id === x.subject_id);
                const pct = x.status === 'graded' ? (x.score / x.max_score) * 100 : null;
                return (
                  <tr key={x.assessment_id}>
                    <td>{pick(subj)}</td><td className="small">{pick(x, 'term_name')}</td>
                    <td>{x.title}<div className="muted small">{pick(x, 'category_name')}{x.assessed_on ? ` · ${fmtDate(x.assessed_on)}` : ''}</div></td>
                    <td className="num">{x.status === 'graded' ? `${fmtNum(x.score)} / ${fmtNum(x.max_score)}` : <span className="badge badge-warn">{t(`rs_${x.status}`)}</span>}</td>
                    <td className="num">{pct === null ? '—' : fmtPct(Math.round(pct * 10) / 10)}</td>
                    <td className="small">{x.comment || '—'}</td>
                    {!data.scope.publishedOnly && <td className="no-print"><SheetStatus status={x.assessment_status} /></td>}
                  </tr>);
              })}</tbody>
            </table></div>
          </>
        )}
        <p className="muted small" style={{ marginBlockStart: 14 }}>{data.policy.mode === 'unweighted' ? t('formulaNoteUnweighted') : t('formulaNote')}</p>
        <div className="signatures">
          <div>{t('signatureTeacher')}</div><div>{t('signaturePrincipal')}</div>
        </div>
        <p className="muted small" style={{ marginBlockStart: 16 }}>{t('generatedOn')}: {fmtDateTime(data.generated_at)}</p>
      </article>
    </div>
  );
}
function lang2(school, pick) { return school ? (pick(school) === school.name_en ? school.name_ckb : school.name_en) : ''; }

export function StudentReportPage() {
  const { id } = useParams();
  const { t } = useI18n();
  return <><PageHead title={t('studentReport')} /><ReportCard studentId={id} /></>;
}

// ---------------- Reports landing ----------------
/** Class results table: one row per student, one column per subject (embedded in Results). */
export function ClassSummary({ initialSectionId }) {
  const { t, fmtNum, pick, errorText } = useI18n();
  const toast = useToast();
  const { current: year } = useYears();
  const sections = useApi('/academic/sections', { yearId: year?.id }, { skip: !year });
  const terms = useApi('/academic/terms', { yearId: year?.id }, { skip: !year });
  const [sectionId, setSectionId] = useState(initialSectionId ? String(initialSectionId) : '');
  const [termId, setTermId] = useState('');
  useEffect(() => { if (!sectionId && sections.data?.items[0]) setSectionId(String(sections.data.items[0].id)); }, [sections.data, sectionId]);
  const rep = useApi(`/reports/section/${sectionId}`, { termId }, { skip: !sectionId });
  const exportCsv = () => download(`/reports/section/${sectionId}`, { termId, format: 'csv' }, 'class-summary.csv').catch((e) => toast(errorText(e), 'bad'));
  return (
    <div className="card">
      <div className="filters">
        <Field label={t('section')}>{(p) => <select {...p} className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{(sections.data?.items || []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(t, fmtNum, s)}</option>)}</select>}</Field>
        <Field label={t('term')}>{(p) => <select {...p} className="select" value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">{t('wholeYear')}</option>{(terms.data?.items || []).map((x) => <option key={x.id} value={x.id}>{pick(x)}</option>)}</select>}</Field>
        <div className="row" style={{ marginInlineStart: 'auto' }}>
          <button type="button" className="btn btn-secondary" disabled={!sectionId} onClick={exportCsv}><Download size={16} />{t('exportCsv')}</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={16} />{t('print')}</button>
        </div>
      </div>
      {rep.error ? <ErrorState error={rep.error} onRetry={rep.reload} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('name')}</th>{(rep.data?.subjects || []).map((s) => <th key={s.id}>{pick(s)}</th>)}<th>{t('overall')}</th><th>{t('performance')}</th></tr></thead>
          {rep.loading && !rep.data ? <SkeletonRows cols={6} /> : (
            <tbody>
              {rep.data?.items.length === 0 && <tr><td colSpan={20}><Empty title={t('noStudents')} /></td></tr>}
              {rep.data?.items.map((i) => (
                <tr key={i.id}>
                  <td><Link to={`/reports/student/${i.id}`}>{i.full_name_ckb}</Link><div className="small"><Code>{i.student_no}</Code></div></td>
                  {rep.data.subjects.map((s) => { const v = i.by_subject[s.id]; const low = v != null && v < s.pass_mark_percent; return <td key={s.id} className="num" style={{ color: low ? 'var(--bad)' : undefined, fontWeight: low ? 700 : undefined }}>{v == null ? '—' : fmtNum(v)}</td>; })}
                  <td className="num" style={{ fontWeight: 700 }}>{i.overall_percent == null ? '—' : fmtNum(i.overall_percent)}</td>
                  <td><BandBadge band={i.overall_band} /></td>
                </tr>
              ))}
            </tbody>
          )}
        </table></div>
      )}
    </div>
  );
}

/** Find a student and open their report card (embedded in Results). */
export function ReportCardSearch() {
  const { t, fmtNum } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const students = useApi('/students', { q: dq, pageSize: 15 });
  return (
    <div className="card">
      <div className="filters"><Field label={t('search')} className="grow">{(p) => <input {...p} className="input" type="search" placeholder={t('searchStudents')} value={q} onChange={(e) => setQ(e.target.value)} />}</Field></div>
      <div className="table-wrap"><table className="table"><tbody>
        {(students.data?.items || []).map((s) => (
          <tr key={s.id}><td><div className="cell-person"><StudentAvatar student={s} /><div><strong>{s.full_name_ckb}</strong><small><Code>{s.student_no}</Code></small></div></div></td>
            <td className="nowrap">{s.grade_level ? sectionLabel(t, fmtNum, s) : '—'}</td>
            <td><div className="actions"><Link className="btn btn-secondary btn-sm" to={`/reports/student/${s.id}`}><FileText size={15} />{t('reportCard')}</Link></div></td></tr>
        ))}
      </tbody></table></div>
    </div>
  );
}

// ---------------- Grade overview ----------------
export function GradeOverviewPage() {
  const { t, fmtNum, fmtPct, fmtDateTime, pick, errorText } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { current: year } = useYears();
  const sections = useApi('/academic/sections', { yearId: year?.id }, { skip: !year });
  const terms = useApi('/academic/terms', { yearId: year?.id }, { skip: !year });
  const subjects = useApi('/academic/subjects');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [f, setF] = useState({ termId: '', sectionId: '', subjectId: '', status: '', failingOnly: '0', page: 1, pageSize: 25, sort: 'updated', dir: 'desc' });
  useEffect(() => setF((x) => ({ ...x, page: 1 })), [dq]);
  const params = { ...f, q: dq, yearId: year?.id };
  const { data, loading, error, reload } = useApi('/reports/grades', params, { skip: !year });
  const missing = useApi('/reports/missing', { termId: f.termId });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, page: 1 });
  const sortProps = { sort: f.sort, dir: f.dir, onSort: (sort, dir) => setF({ ...f, sort, dir }) };
  const exportCsv = () => download('/reports/grades', { ...params, format: 'csv', page: undefined, pageSize: undefined }, 'grades.csv').catch((e) => toast(errorText(e), 'bad'));
  return (
    <>
      <PageHead title={t('gradeOverviewTitle')} sub={t('gradeOverviewSub')}>
        {(can('exports.csv') || can('reports.class')) && <button type="button" className="btn btn-secondary" onClick={exportCsv}><Download size={16} />{t('exportCsv')}</button>}
      </PageHead>
      {missing.data?.items.length > 0 && (
        <details className="card" style={{ marginBlockEnd: 16 }}>
          <summary className="card-head" style={{ cursor: 'pointer' }}><strong>{t('missingTracker')}</strong><span className="badge badge-warn">{fmtNum(missing.data.items.reduce((a, x) => a + x.missing, 0))}</span></summary>
          <div className="table-wrap"><table className="table"><thead><tr><th>{t('assessment')}</th><th>{t('subject')}</th><th>{t('class')}</th><th>{t('status')}</th><th>{t('missingCount')}</th></tr></thead>
            <tbody>{missing.data.items.map((m) => <tr key={m.assessment_id}><td><Link to={`/grades/sheet/${m.assessment_id}`}>{m.title}</Link></td><td>{pick(m, 'subject_name')}</td><td>{sectionLabel(t, fmtNum, m)}</td><td><SheetStatus status={m.status} /></td><td className="num">{fmtNum(m.missing)}</td></tr>)}</tbody></table></div>
        </details>
      )}
      <div className="card">
        <div className="filters">
          <Field label={t('search')} className="grow">{(p) => <div style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', insetInlineStart: 12, insetBlockStart: 12, color: 'var(--ink-3)' }} aria-hidden="true" /><input {...p} className="input" style={{ paddingInlineStart: 36 }} type="search" placeholder={t('searchStudents')} value={q} onChange={(e) => setQ(e.target.value)} /></div>}</Field>
          <Field label={t('term')}>{(p) => <select {...p} className="select" value={f.termId} onChange={set('termId')}><option value="">{t('all')}</option>{(terms.data?.items || []).map((x) => <option key={x.id} value={x.id}>{pick(x)}</option>)}</select>}</Field>
          <Field label={t('section')}>{(p) => <select {...p} className="select" value={f.sectionId} onChange={set('sectionId')}><option value="">{t('all')}</option>{(sections.data?.items || []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(t, fmtNum, s)}</option>)}</select>}</Field>
          <Field label={t('subject')}>{(p) => <select {...p} className="select" value={f.subjectId} onChange={set('subjectId')}><option value="">{t('all')}</option>{(subjects.data?.items || []).map((s) => <option key={s.id} value={s.id}>{pick(s)}</option>)}</select>}</Field>
          <Field label={t('status')}>{(p) => <select {...p} className="select" value={f.status} onChange={set('status')}><option value="">{t('all')}</option>{['draft', 'submitted', 'approved', 'published', 'returned'].map((s) => <option key={s} value={s}>{t(`gs_${s}`)}</option>)}</select>}</Field>
          <label className="checkbox" style={{ paddingBlockEnd: 8 }}><input type="checkbox" checked={f.failingOnly === '1'} onChange={(e) => setF({ ...f, failingOnly: e.target.checked ? '1' : '0', page: 1 })} />{t('failingOnly')}</label>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <SortHeader label={t('name')} field="student" {...sortProps} /><th>{t('studentNo')}</th><SortHeader label={t('class')} field="grade" {...sortProps} />
              <SortHeader label={t('subject')} field="subject" {...sortProps} /><th>{t('assessment')}</th><SortHeader label={t('score')} field="score" {...sortProps} />
              <SortHeader label={t('percent')} field="percent" {...sortProps} /><th>{t('enteredBy')}</th><SortHeader label={t('status')} field="status" {...sortProps} /><SortHeader label={t('lastModified')} field="updated" {...sortProps} />
            </tr></thead>
            {loading && !data ? <SkeletonRows cols={10} /> : (
              <tbody>
                {data?.items.length === 0 && <tr><td colSpan={10}><Empty title={t('noGrades')} /></td></tr>}
                {data?.items.map((g) => {
                  const fail = g.record_status === 'missing' || (g.percent != null && g.percent < g.pass_mark_percent);
                  return (
                    <tr key={g.id} className={fail ? 'row-fail' : ''}>
                      <td>{g.full_name_ckb}</td><td><Code>{g.student_no}</Code></td><td className="nowrap">{sectionLabel(t, fmtNum, g)}</td>
                      <td>{pick(g, 'subject_name')}</td><td><Link to={`/grades/sheet/${g.assessment_id}`}>{g.title}</Link><div className="muted small">{pick(g, 'term_name')}</div></td>
                      <td className="num nowrap">{g.record_status === 'graded' ? `${fmtNum(g.score)} / ${fmtNum(g.max_score)}` : <span className="badge badge-warn">{t(`rs_${g.record_status}`)}</span>}</td>
                      <td className="num">{fmtPct(g.percent)}</td><td className="small">{g.entered_by_name || '—'}</td><td><SheetStatus status={g.status} /></td><td className="small nowrap">{fmtDateTime(g.updated_at)}</td>
                    </tr>);
                })}
              </tbody>
            )}
          </table></div>
        )}
        {data && <Pagination page={f.page} pageSize={f.pageSize} total={data.total} onPage={(page) => setF({ ...f, page })} onPageSize={(pageSize) => setF({ ...f, pageSize, page: 1 })} />}
      </div>
    </>
  );
}

// ---------------- Student portal ----------------
export function PortalPage() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useApi('/portal/me');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const me = data.students[0];
  if (!me) return <><PageHead title={t('navMyGrades')} /><div className="card"><Empty title={t('noGrades')} /></div></>;
  return <><PageHead title={t('navMyGrades')} /><ReportCard studentId={me.id} /></>;
}
