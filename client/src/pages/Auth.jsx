import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Globe, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api, normalizeDigits } from '../lib/api';
import Logo from '../components/Logo';
import { Field } from '../components/ui';

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
          <div className="auth-top">
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
  const [form, setForm] = useState({ username: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await login(form.username.trim(), form.password); nav('/', { replace: true }); }
    catch (ex) { setErr(ex); setForm((f) => ({ ...f, password: '' })); }
    finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h2 style={{ fontSize: '1.3rem' }}>{t('loginTitle')}</h2>
      <p className="muted" style={{ marginBlock: '4px 20px' }}>{t('loginSub')}</p>
      {expired && !err && <div className="alert alert-info" style={{ marginBlockEnd: 14 }}>{t('sessionExpired')}</div>}
      {err && <div className="alert alert-bad" role="alert" style={{ marginBlockEnd: 14 }}>{errorText(err)}</div>}
      <form onSubmit={submit} className="stack" noValidate>
        <Field label={t('username')} hint={t('usernameHint')} required>
          {(p) => <input {...p} className="input" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus
            value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}
        </Field>
        <Field label={t('password')} required>
          {(p) => <input {...p} className="input" type="password" dir="ltr" autoComplete="current-password" required
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !form.username || !form.password}><LogIn size={18} className="flip-rtl" />{busy ? t('signingIn') : t('signIn')}</button>
      </form>
      <p className="muted small" style={{ marginBlockStart: 18 }}>{t('forgotPassword')} <Link to="/reset">{t('haveResetToken')}</Link></p>
    </AuthShell>
  );
}

export function ResetPage() {
  const { t, errorText } = useI18n();
  const [sp] = useSearchParams();
  const [form, setForm] = useState({ token: sp.get('token') || '', pw: '', pw2: '' });
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (form.pw !== form.pw2) { setErr({ message: t('passwordsDontMatch') }); return; }
    try { await api('/auth/reset-password', { method: 'POST', body: { token: form.token.trim(), newPassword: form.pw } }); setDone(true); }
    catch (ex) { setErr(ex); }
  };
  return (
    <AuthShell>
      <h2 style={{ fontSize: '1.3rem', marginBlockEnd: 16 }}><KeyRound size={20} /> {t('resetTitle')}</h2>
      {done ? (
        <><div className="alert alert-ok">{t('resetDone')}</div><Link className="btn btn-primary btn-block" style={{ marginBlockStart: 16 }} to="/login">{t('signIn')}</Link></>
      ) : (
        <form className="stack" onSubmit={submit}>
          {err && <div className="alert alert-bad" role="alert">{err.code ? errorText(err) : err.message}</div>}
          <Field label={t('resetCode')} required>{(p) => <input {...p} className="input mono" dir="ltr" required value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />}</Field>
          <Field label={t('newPassword')} hint={t('passwordRules')} required>{(p) => <input {...p} className="input" type="password" dir="ltr" autoComplete="new-password" required value={form.pw} onChange={(e) => setForm({ ...form, pw: e.target.value })} />}</Field>
          <Field label={t('confirmPassword')} required>{(p) => <input {...p} className="input" type="password" dir="ltr" autoComplete="new-password" required value={form.pw2} onChange={(e) => setForm({ ...form, pw2: e.target.value })} />}</Field>
          <button className="btn btn-primary btn-block">{t('save')}</button>
          <Link to="/login" className="small">{t('back')}</Link>
        </form>
      )}
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

export function PasswordForm({ onDone }) {
  const { t, errorText } = useI18n();
  const [f, setF] = useState({ cur: '', pw: '', pw2: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (f.pw !== f.pw2) { setErr({ message: t('passwordsDontMatch') }); return; }
    setBusy(true);
    try { await api('/auth/password', { method: 'POST', body: { currentPassword: f.cur, newPassword: f.pw } }); setF({ cur: '', pw: '', pw2: '' }); await onDone?.(); }
    catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {err && <div className="alert alert-bad" role="alert">{err.code ? errorText(err) : err.message}</div>}
      <Field label={t('currentPassword')} required>{(p) => <input {...p} className="input" type="password" dir="ltr" autoComplete="current-password" required value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} />}</Field>
      <Field label={t('newPassword')} hint={t('passwordRules')} required>{(p) => <input {...p} className="input" type="password" dir="ltr" autoComplete="new-password" required minLength={10} value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />}</Field>
      <Field label={t('confirmPassword')} required>{(p) => <input {...p} className="input" type="password" dir="ltr" autoComplete="new-password" required value={f.pw2} onChange={(e) => setF({ ...f, pw2: e.target.value })} />}</Field>
      <div><button className="btn btn-primary" disabled={busy}>{busy ? t('saving') : t('changePassword')}</button></div>
    </form>
  );
}

export function ForcePasswordPage() {
  const { t } = useI18n();
  const { refresh, logout } = useAuth();
  return (
    <AuthShell>
      <h2 style={{ fontSize: '1.3rem' }}><KeyRound size={20} /> {t('changePassword')}</h2>
      <div className="alert alert-info" style={{ marginBlock: '12px 16px' }}>{t('changePasswordForced')}</div>
      <PasswordForm onDone={refresh} />
      <button type="button" className="btn btn-ghost btn-block" style={{ marginBlockStart: 8 }} onClick={logout}>{t('signOut')}</button>
    </AuthShell>
  );
}
