import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, GraduationCap, School, ClipboardList, ClipboardCheck, BarChart3,
  UserCog, Settings, Menu, Bell, Globe, LogOut, ShieldCheck, UserRound,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import Logo from './Logo';
import InstallButton from './InstallButton';

export const NAV = [
  { section: 'navOverview', items: [
    { to: '/', key: 'navHome', icon: LayoutDashboard, perms: ['dashboard.school', 'grades.enter'], end: true },
    { to: '/portal', key: 'navMyGrades', icon: GraduationCap, perms: ['self.grades'] },
  ] },
  { section: 'navGrades', items: [
    { to: '/approvals', key: 'navApprovals', icon: ClipboardCheck, perms: ['grades.approve'], badge: 'approvals' },
    { to: '/grades', key: 'navGradeSheets', icon: ClipboardList, perms: ['grades.enter', 'grades.manage_all'], end: true },
    { to: '/students', key: 'navStudents', icon: Users, perms: ['students.read'] },
    { to: '/results', key: 'navResults', icon: BarChart3, perms: ['reports.school', 'reports.class'] },
  ] },
  { section: 'navAdmin', items: [
    { to: '/staff', key: 'navStaff', icon: UserCog, perms: ['teachers.read', 'users.manage', 'assignments.manage'] },
    { to: '/setup', key: 'navSetup', icon: School, perms: ['academic.manage'] },
    { to: '/system', key: 'navSystem', icon: Settings, perms: ['system.settings', 'audit.read'] },
    { to: '/account', key: 'navAccount', icon: ShieldCheck, perms: null },
  ] },
];

function Notifications() {
  const { t, fmtDateTime } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const ref = useRef(null);
  const load = () => api('/notifications').then(setData).catch(() => {});
  useEffect(() => { load(); const i = setInterval(load, 60_000); return () => clearInterval(i); }, []);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const markAll = async () => { await api('/notifications/read', { method: 'POST', body: {} }).catch(() => {}); load(); };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost btn-icon" aria-label={`${t('notifications')} (${data.unread})`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={19} />
        {data.unread > 0 && <span className="badge badge-bad" style={{ position: 'absolute', insetBlockStart: 2, insetInlineEnd: 0, padding: '0 5px', fontSize: 10 }}>{data.unread}</span>}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', insetInlineEnd: 0, insetBlockStart: 44, inlineSize: 320, maxInlineSize: '90vw', zIndex: 40, boxShadow: 'var(--shadow-lg)' }}>
          <div className="card-head"><strong>{t('notifications')}</strong>{data.unread > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={markAll}>{t('markAllRead')}</button>}</div>
          <div style={{ maxBlockSize: 360, overflowY: 'auto' }}>
            {data.items.length === 0 ? <p className="muted small" style={{ padding: 18 }}>{t('noNotifications')}</p> : data.items.map((n) => (
              <div key={n.id} style={{ padding: '10px 16px', borderBlockEnd: '1px solid var(--line)', background: n.read_at ? undefined : 'var(--navy-50)' }}>
                <div className="small">{t(`n_${n.kind.replace('.', '_')}`, { title: n.payload?.title || '' })}</div>
                <div className="muted small">{fmtDateTime(n.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { t, lang, setLang, fmtNum } = useI18n();
  const { user, can, logout } = useAuth();
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);
  // Count of sheets waiting for approval, shown next to "Approvals" in the menu.
  useEffect(() => {
    if (!can('grades.approve')) return;
    api('/analytics/attention').then((r) => setPending((r.items.awaiting_approval || 0) + (r.items.approved_not_published || 0))).catch(() => {});
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchLang = () => {
    const next = lang === 'ckb' ? 'en' : 'ckb';
    setLang(next);
    api('/auth/me', { method: 'PATCH', body: { preferred_lang: next } }).catch(() => {});
  };
  const doLogout = async () => { await logout(); nav('/login'); };
  return (
    <div className="app">
      <a href="#main" className="skip-link">{t('skip')}</a>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label={t('menu')}>
        <div className="sidebar-brand">
          <Logo size={46} plate />
          <div><strong>{t('school')}</strong><span>{t('appName')}</span></div>
        </div>
        <nav className="nav">
          {NAV.map((sec) => {
            const items = sec.items.filter((i) => !i.perms || can(...i.perms));
            if (!items.length) return null;
            return (
              <div key={sec.section}>
                <div className="nav-section">{t(sec.section)}</div>
                {items.map((i) => (
                  <NavLink key={i.key} to={i.to} end={i.end}><i.icon size={18} aria-hidden="true" />{t(i.key)}
                    {i.badge === 'approvals' && pending > 0 && <span className="badge badge-warn" style={{ marginInlineStart: 'auto' }}>{fmtNum(pending)}</span>}</NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">{t('schoolAlt')} · 2019</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-icon menu-btn" onClick={() => setOpen(true)} aria-label={t('menu')}><Menu size={20} /></button>
          <div className="spacer" />
          <InstallButton compact />
          <Notifications />
          <button type="button" className="btn btn-secondary btn-sm" onClick={switchLang} lang={lang === 'ckb' ? 'en' : 'ckb'}><Globe size={16} />{t('switchLang')}</button>
          <div className="row" style={{ gap: 8 }}>
            <span className="avatar" aria-hidden="true"><UserRound size={18} /></span>
            <div className="small who" style={{ lineHeight: 1.25 }}>
              <strong style={{ display: 'block' }}>{user.full_name}</strong>
              <span className="muted">{user.roles.map((r) => t(`role_${r}`)).join(' · ')}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={doLogout} aria-label={t('signOut')} title={t('signOut')}><LogOut size={18} className="flip-rtl" /></button>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
