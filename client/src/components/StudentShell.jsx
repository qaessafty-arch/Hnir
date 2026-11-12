import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Globe, LogOut, UserRound, ShieldCheck, GraduationCap } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import Logo from './Logo';
import InstallButton from './InstallButton';

/** Student layout: the full-width navy school header from the reference design (no admin sidebar). */
export default function StudentShell() {
  const { t, lang, setLang } = useI18n();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const switchLang = () => {
    const next = lang === 'ckb' ? 'en' : 'ckb';
    setLang(next);
    api('/auth/me', { method: 'PATCH', body: { preferred_lang: next } }).catch(() => {});
  };
  return (
    <div className="st-app">
      <a href="#main" className="skip-link">{t('skip')}</a>
      <header className="st-header">
        <div className="st-header-in">
          <div className="st-brand">
            <span className="logo-plate"><Logo size={46} /></span>
            <div>
              <span className="st-word" dir="ltr">DARWAZA</span>
              <strong>{t('schoolCkb')}</strong>
              <span dir="ltr">Darwaza Private School • {t('gradeSystemEn')}</span>
            </div>
          </div>
          <div className="st-actions">
            <InstallButton compact />
            <span className="st-user"><UserRound size={15} aria-hidden="true" /><span>{user.full_name}</span></span>
            <button type="button" className="st-btn st-lang" onClick={switchLang} lang={lang === 'ckb' ? 'en' : 'ckb'}><Globe size={16} />{t('switchLang')}</button>
            <button type="button" className="st-btn st-logout" onClick={async () => { await logout(); nav('/login'); }}><LogOut size={16} className="flip-rtl" />{t('signOut')}</button>
          </div>
        </div>
        <nav className="st-tabs" aria-label={t('menu')}>
          <NavLink to="/" end><GraduationCap size={16} aria-hidden="true" />{t('navMyGrades')}</NavLink>
          <NavLink to="/account"><ShieldCheck size={16} aria-hidden="true" />{t('navAccount')}</NavLink>
        </nav>
      </header>
      <main id="main" className="st-main" tabIndex={-1}><Outlet /></main>
      <footer className="st-footer no-print">{t('school')} © {new Date().getFullYear()} · Darwaza Private School</footer>
    </div>
  );
}
