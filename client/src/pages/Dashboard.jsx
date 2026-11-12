import { ltr } from '../lib/api';
import { Link } from 'react-router-dom';
import { GraduationCap, Users, School, CheckCircle2, ClipboardList } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { Empty, ErrorState, Loading, PageHead, Progress, SheetStatus } from '../components/ui';

export default function Dashboard() {
  const { can } = useAuth();
  if (can('dashboard.school')) return <SchoolDashboard />;
  return <TeacherDashboard />;
}

function SchoolDashboard() {
  const { t, fmtNum, fmtPct, fmtDateTime, pick } = useI18n();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/dashboard');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const pct = data.completion.expected ? (data.completion.entered / data.completion.expected) * 100 : 0;
  const maxGrade = Math.max(1, ...data.students_by_grade.map((g) => g.n));
  const statusOrder = ['draft', 'returned', 'submitted', 'approved', 'published'];
  return (
    <>
      <PageHead title={t('dashTitle')} sub={data.year ? t('dashSub', { year: ltr(data.year.name) }) : t('noCurrentYear')} />
      <div className="grid grid-4" style={{ marginBlockEnd: 16 }}>
        <div className="card stat"><div className="stat-icon"><GraduationCap size={22} /></div><div><div className="stat-label">{t('statStudents')}</div><div className="stat-value num">{fmtNum(data.students.active)}</div></div></div>
        <div className="card stat"><div className="stat-icon gold"><Users size={22} /></div><div><div className="stat-label">{t('statTeachers')}</div><div className="stat-value num">{fmtNum(data.teachers)}</div></div></div>
        <div className="card stat"><div className="stat-icon"><School size={22} /></div><div><div className="stat-label">{t('statSections')}</div><div className="stat-value num">{fmtNum(data.sections)}</div></div></div>
        <div className="card stat"><div className="stat-icon ok"><CheckCircle2 size={22} /></div><div style={{ flex: 1 }}><div className="stat-label">{t('statCompletion')}</div><div className="stat-value num">{fmtPct(Math.round(pct))}</div><Progress value={pct} /></div></div>
      </div>
      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h2>{t('pendingApprovals')}</h2><span className="badge badge-info">{fmtNum(data.pending_approvals.length)}</span></div>
          {data.pending_approvals.length === 0 ? <Empty icon={CheckCircle2} title={t('noPending')} /> : (
            <div className="table-wrap"><table className="table"><tbody>
              {data.pending_approvals.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/grades/sheet/${a.id}`}><strong>{a.title}</strong></Link><div className="muted small">{pick(a, 'subject_name')} · {t('gradeN', { n: fmtNum(a.grade_level) })} {a.section_name}</div></td>
                  <td className="muted small nowrap">{fmtDateTime(a.updated_at)}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>{t('assessmentStatus')}</h2></div>
          <div className="card-body">
            {statusOrder.map((s) => {
              const n = data.assessments[s] || 0;
              const total = Object.values(data.assessments).reduce((a, b) => a + b, 0) || 1;
              return <div key={s} className="bar-row"><SheetStatus status={s} /><Progress value={(n / total) * 100} tone="ok" /><span className="num small">{fmtNum(n)}</span></div>;
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>{t('studentsByGrade')}</h2></div>
          <div className="card-body">
            {data.students_by_grade.length === 0 ? <p className="muted">—</p> : data.students_by_grade.map((g) => (
              <div key={g.grade_level} className="bar-row"><span>{t('gradeN', { n: fmtNum(g.grade_level) })}</span><Progress value={(g.n / maxGrade) * 100} tone="ok" /><span className="num small">{fmtNum(g.n)}</span></div>
            ))}
          </div>
        </section>
        {can('audit.read') && (
          <section className="card">
            <div className="card-head"><h2>{t('recentActivity')}</h2><Link to="/audit" className="small">{t('navAudit')}</Link></div>
            {data.activity.length === 0 ? <Empty title={t('noActivity')} /> : (
              <div className="table-wrap"><table className="table"><tbody>
                {data.activity.map((a) => (
                  <tr key={a.id}><td><bdi dir="ltr" className="mono small">{a.action}</bdi><div className="muted small">{a.actor_name || '—'}</div></td><td className="muted small nowrap">{fmtDateTime(a.created_at)}</td></tr>
                ))}
              </tbody></table></div>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function TeacherDashboard() {
  const { t, fmtNum, pick } = useI18n();
  const { data, loading, error, reload } = useApi('/dashboard/teacher');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title={t('teacherDashTitle')} sub={t('teacherDashSub')} />
      {data.assignments.length === 0 ? <div className="card"><Empty icon={ClipboardList} title={t('noAssignments')} /></div> : (
        <div className="grid grid-3">
          {data.assignments.map((a) => (
            <div key={a.id} className="card card-pad stack" style={{ gap: 10 }}>
              <div><h3>{pick(a, 'subject_name')}</h3><p className="muted small">{t('gradeN', { n: fmtNum(a.grade_level) })} – {a.section_name} · {fmtNum(a.students)} {t('students')}</p></div>
              <div className="row">
                <span className="badge badge-neutral">{t('openSheets')}: {fmtNum(a.open_sheets)}</span>
                {a.returned_sheets > 0 && <span className="badge badge-warn">{t('returnedSheets')}: {fmtNum(a.returned_sheets)}</span>}
              </div>
              <Link className="btn btn-primary btn-sm" to={`/grades?sectionId=${a.section_id}&subjectId=${a.subject_id}`}>{t('enterGrades')}</Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
