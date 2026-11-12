import { Link } from 'react-router-dom';
import { ClipboardCheck, Globe2, Undo2, ListTodo, UserX, Users, CheckCircle2, ClipboardList, ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { useApi, useYears } from '../lib/hooks';
import { Empty, ErrorState, Loading, PageHead } from '../components/ui';
import { ClassChart, KpiRow, SubjectChart } from './Results';
import { ltr } from '../lib/api';

/** Plain-language to-do list: one line per thing that needs action, each with a button that goes straight there. */
const ATTENTION = [
  { key: 'awaiting_approval', icon: ClipboardCheck, tone: 'att-warn', to: '/approvals', action: 'review' },
  { key: 'approved_not_published', icon: Globe2, tone: 'att-info', to: '/approvals', action: 'review' },
  { key: 'returned', icon: Undo2, tone: 'att-warn', to: '/grades?status=returned', action: 'open_' },
  { key: 'sheets_missing_grades', icon: ListTodo, tone: 'att-info', to: '/results?tab=grades', action: 'open_' },
  { key: 'students_without_class', icon: UserX, tone: 'att-bad', to: '/students', action: 'fix' },
  { key: 'teachers_without_classes', icon: Users, tone: 'att-info', to: '/staff?tab=assignments', action: 'fix' },
];

export function Attention({ items }) {
  const { t, fmtNum } = useI18n();
  const list = ATTENTION.filter((a) => items[a.key] > 0);
  return (
    <section className="card" style={{ marginBlockEnd: 16 }}>
      <div className="card-head"><h2>{t('attentionTitle')}</h2></div>
      {list.length === 0 ? <div className="all-good"><CheckCircle2 size={22} />{t('allGood')}</div> : (
        <ul className="attention">
          {list.map((a) => (
            <li key={a.key}>
              <span className={`att-icon ${a.tone}`}><a.icon size={20} aria-hidden="true" /></span>
              <span className="att-text"><strong>{t(`att_${a.key}`, { n: fmtNum(items[a.key]) })}</strong><span>{t(`att_${a.key}_hint`)}</span></span>
              <Link className="btn btn-primary btn-sm" to={a.to}>{t(a.action)}<ArrowRight size={15} className="flip-rtl" /></Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SchoolHome() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { current: year } = useYears();
  const att = useApi('/analytics/attention');
  const an = useApi('/analytics', { yearId: year?.id }, { skip: !year });
  return (
    <>
      <PageHead title={t('greeting', { name: user.full_name })} sub={year ? t('dashSub', { year: ltr(year.name) }) : t('noCurrentYear')}>
        <Link className="btn btn-secondary" to="/results">{t('navResults')}<ArrowRight size={15} className="flip-rtl" /></Link>
      </PageHead>
      {att.error ? <ErrorState error={att.error} onRetry={att.reload} /> : att.data ? <Attention items={att.data.items} /> : <Loading />}
      {an.data?.kpis && (
        <>
          <KpiRow k={an.data.kpis} />
          <div className="grid grid-2">
            <SubjectChart subjects={an.data.subjects} />
            <ClassChart sections={an.data.sections} />
          </div>
        </>
      )}
    </>
  );
}

function TeacherHome() {
  const { t, fmtNum, pick } = useI18n();
  const { user } = useAuth();
  const att = useApi('/analytics/attention');
  const { data, loading, error, reload } = useApi('/dashboard/teacher');
  return (
    <>
      <PageHead title={t('greeting', { name: user.full_name })} sub={t('teacherHomeSub')}>
        <Link className="btn btn-secondary" to="/results">{t('myResults')}<ArrowRight size={15} className="flip-rtl" /></Link>
      </PageHead>
      {att.data && <Attention items={att.data.items} />}
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : data.assignments.length === 0 ? <div className="card"><Empty icon={ClipboardList} title={t('noAssignments')} /></div> : (
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

export default function Home() {
  const { can } = useAuth();
  return can('dashboard.school') ? <SchoolHome /> : <TeacherHome />;
}
