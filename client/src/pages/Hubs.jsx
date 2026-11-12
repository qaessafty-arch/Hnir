import { useI18n } from '../i18n';
import Hub from '../components/Hub';
import { AssignmentsPage, SectionsPage, SubjectsPage, TeachersPage, UsersPage, YearsPage } from './Admin';
import { AuditPage, SettingsPage } from './System';
import AccountTypesPage from './AccountTypes';

export function StaffHub() {
  const { t } = useI18n();
  return <Hub title={t('staffTitle')} help={t('staffHelp')} tabs={[
    { key: 'teachers', label: t('tabTeachers'), perms: ['teachers.read'], render: () => <TeachersPage /> },
    { key: 'assignments', label: t('tabAssignments'), perms: ['assignments.manage'], render: () => <AssignmentsPage /> },
    { key: 'accounts', label: t('tabAccounts'), perms: ['users.manage', 'roles.manage'], render: () => <UsersPage /> },
  ]} />;
}

export function SetupHub() {
  const { t } = useI18n();
  return <Hub title={t('setupTitle')} help={t('setupHelp')} tabs={[
    { key: 'years', label: t('tabYears'), render: () => <YearsPage /> },
    { key: 'classes', label: t('tabClassesSetup'), render: () => <SectionsPage /> },
    { key: 'subjects', label: t('tabSubjects'), render: () => <SubjectsPage /> },
  ]} />;
}

export function SystemHub() {
  const { t } = useI18n();
  return <Hub title={t('systemTitle')} help={t('systemHelp')} tabs={[
    { key: 'types', label: t('tabTypes'), perms: ['roles.manage'], render: () => <AccountTypesPage /> },
    { key: 'settings', label: t('tabSettings'), perms: ['system.settings'], render: () => <SettingsPage /> },
    { key: 'audit', label: t('tabAudit'), perms: ['audit.read'], render: () => <AuditPage /> },
  ]} />;
}
