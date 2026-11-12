import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, LogIn, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api, normalizeDigits } from '../lib/api';
import Logo from '../components/Logo';
import { Field } from '../components/ui';
import InstallButton from '../components/InstallButton';

function AuthShell({ children }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="auth-wrap">
      <section className="auth-brand" aria-hidden="true">
        <Logo size={220} plate />
        <div>
          <h1>{t('school')}</h1>
          <p style={{ marginBlockStart: 6 }}>{t('schoolAlt')}</p>
        </div>
        <p style={{ color: '#dbe3f3', maxInlineSize: 380 }}>{t('brandTagline')}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-top" style={{ gap: 8 }}>
            <InstallButton />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLang(lang === 'ckb' ? 'en' : 'ckb')}><Globe size={16} />{t('switchLang')}</button>
          </div>
          <div className="auth-mobile-logo"><Logo size={120} /></div>
          <div className="card"><div className="card-pad">{children}</div></div>
        </div>
      </section>
    </div>
  );
}

export function LoginPage() {
  const { t, errorText } = useI18n();
  const { login, expired } = useAuth();
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setErr(null);
    try { await login(normalizeDigits(code.trim())); nav('/', { replace: true }); }
    catch (ex) { setErr(ex); }
    finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h2 style={{ fontSize: '1.3rem' }}>{t('loginTitle')}</h2>
      <p className="muted" style={{ marginBlock: '4px 20px' }}>{t('loginSub')}</p>
      {expired && !err && <div className="alert alert-info" style={{ marginBlockEnd: 14 }}>{t('sessionExpired')}</div>}
      {err && <div className="alert alert-bad" role="alert" style={{ marginBlockEnd: 14 }}>{errorText(err)}</div>}
      <form onSubmit={submit} className="stack" noValidate>
        <Field label={t('loginCode')} hint={t('loginCodeHint')} required>
          {(p) => <input {...p} className="input login-code" dir="ltr" autoComplete="username" autoCapitalize="characters" spellCheck={false} required autoFocus
            placeholder="DAR-4821" value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !code.trim()}><LogIn size={18} className="flip-rtl" />{busy ? t('signingIn') : t('signIn')}</button>
      </form>
    </AuthShell>
  );
}

export function MfaVerifyPage() {
  const { t, errorText } = useI18n();
  const { refresh, logout } = useAuth();
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api('/auth/mfa/verify', { method: 'POST', body: { code: normalizeDigits(code) } }); await refresh(); }
    catch (ex) { setErr(ex); setCode(''); }
  };
  return (
    <AuthShell>
      <h2 style={{ fontSize: '1.3rem' }}><ShieldCheck size={20} /> {t('mfaTitle')}</h2>
      <p className="muted" style={{ marginBlock: '4px 18px' }}>{t('mfaSub')}</p>
      <form className="stack" onSubmit={submit}>
        {err && <div className="alert alert-bad" role="alert">{errorText(err)}</div>}
        <Field label={t('mfaCode')}>{(p) => <input {...p} className="input mono" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
          value={code} onChange={(e) => setCode(normalizeDigits(e.target.value).replace(/\D/g, ''))} style={{ fontSize: '1.4rem', letterSpacing: '0.3em', textAlign: 'center' }} />}</Field>
        <button className="btn btn-primary btn-block" disabled={code.length !== 6}>{t('verify')}</button>
        <button type="button" className="btn btn-ghost" onClick={logout}>{t('signOut')}</button>
      </form>
    </AuthShell>
  );
}

export function MfaEnroll({ onDone, embedded = false }) {
  const { t, errorText } = useI18n();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { api('/auth/mfa/setup', { method: 'POST', body: {} }).then(setSetup).catch(setErr); }, []);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api('/auth/mfa/enable', { method: 'POST', body: { code: normalizeDigits(code) } }); await onDone?.(); }
    catch (ex) { setErr(ex); setCode(''); }
  };
  return (
    <div className="stack">
      {!embedded && <h2 style={{ fontSize: '1.2rem' }}><ShieldCheck size={20} /> {t('mfaEnrollTitle')}</h2>}
      <p className="muted small">{t('mfaEnrollSub')}</p>
      {err && <div className="alert alert-bad" role="alert">{errorText(err)}</div>}
      {setup && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center' }}><img src={setup.qr} alt="QR" width={200} height={200} /></div>
          <div className="small muted">{t('mfaManual')}: <bdi dir="ltr" className="mono" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{setup.secret}</bdi></div>
          <form className="stack" onSubmit={submit}>
            <Field label={t('mfaCode')}>{(p) => <input {...p} className="input mono" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(e) => setCode(normalizeDigits(e.target.value).replace(/\D/g, ''))} style={{ fontSize: '1.3rem', letterSpacing: '0.3em', textAlign: 'center' }} />}</Field>
            <button className="btn btn-primary" disabled={code.length !== 6}>{t('mfaEnable')}</button>
          </form>
        </>
      )}
    </div>
  );
}

export function MfaEnrollPage() {
  const { refresh, logout } = useAuth();
  const { t } = useI18n();
  return <AuthShell><MfaEnroll onDone={refresh} /><button type="button" className="btn btn-ghost btn-block" style={{ marginBlockStart: 8 }} onClick={logout}>{t('signOut')}</button></AuthShell>;
}
