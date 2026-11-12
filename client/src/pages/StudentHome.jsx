import { useI18n } from '../i18n';
import { useApi } from '../lib/hooks';
import { Empty, ErrorState, Loading } from '../components/ui';
import WeeklyCard from './WeeklyCard';

/** Student portal home: their own Weekly Student Grade Card. */
export default function StudentHome() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useApi('/portal/me');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const me = data.students[0];
  if (!me) return <div className="card"><Empty title={t('noGrades')} /></div>;
  return <WeeklyCard studentId={me.id} />;
}
