import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api, normalizeDigits } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Empty, ErrorState, Field, Loading, Modal, PageHead, Pagination, SkeletonRows, useToast } from '../components/ui';
import { MfaEnroll, PasswordForm } from './Auth';

export function AuditPage() {
  const { t, fmtDateTime } = useI18n();
  const [f, setF] = useState({ action: '', entityType: '', entityId: '', from: '', to: '', page: 1, pageSize: 50 });
  const [applied, setApplied] = useState(f);
  const { data, loading, error, reload } = useApi('/audit', applied);
  const [detail, setDetail] = useState(null);
  const submit = (e) => { e.preventDefault(); setApplied({ ...f, page: 1 }); };
  return (
    <>
      <PageHead title={t('auditTitle')} sub={t('auditSub')} />
      <div className="card">
        <form className="filters" onSubmit={submit}>
          <Field label={t('action')}>{(p) => <input {...p} className="input" dir="ltr" placeholder="grades." value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />}</Field>
          <Field label={t('entity')}>{(p) => <input {...p} className="input" dir="ltr" placeholder="student" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} />}</Field>
          <Field label="ID">{(p) => <input {...p} className="input" dir="ltr" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })} />}</Field>
          <Field label={t('from')}>{(p) => <input {...p} className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
          <Field label={t('to')}>{(p) => <input {...p} className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
          <button className="btn btn-primary">{t('filter')}</button>
        </form>
        {error ? <ErrorState error={error} onRetry={reload} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('when')}</th><th>{t('actor')}</th><th>{t('action')}</th><th>{t('entity')}</th><th>{t('ip')}</th><th /></tr></thead>
            {loading && !data ? <SkeletonRows cols={6} /> : <tbody>
              {data.items.length === 0 && <tr><td colSpan={6}><Empty title={t('noActivity')} /></td></tr>}
              {data.items.map((l) => (
                <tr key={l.id}><td className="small nowrap">{fmtDateTime(l.created_at)}</td><td>{l.actor_name || '—'}</td><td><bdi dir="ltr" className="mono small">{l.action}</bdi></td>
                  <td><bdi dir="ltr" className="mono small">{l.entity_type ? `${l.entity_type}#${l.entity_id ?? ''}` : '—'}</bdi></td><td><bdi dir="ltr" className="mono small">{l.ip || '—'}</bdi></td>
                  <td>{Object.keys(l.details || {}).length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(l)}>{t('details')}</button>}</td></tr>
              ))}
            </tbody>}
          </table></div>
        )}
        {data && <Pagination page={applied.page} pageSize={applied.pageSize} total={data.total} onPage={(page) => setApplied({ ...applied, page })} />}
      </div>
      {detail && <Modal size="wide" title={detail.action} onClose={() => setDetail(null)}><pre dir="ltr" className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(detail.details, null, 2)}</pre></Modal>}
    </>
  );
}

const BAND_KEYS = ['excellent', 'very_good', 'good', 'pass', 'needs_improvement'];
const MFA_ROLES = ['super_admin', 'principal', 'registrar', 'auditor', 'teacher'];

export function SettingsPage() {
  const { t, fmtNum, errorText } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/settings');
  const backups = useApi('/system/backups');
  const [g, setG] = useState(null);
  const [s, setS] = useState(null);
  const [sc, setSc] = useState(null);
  useEffect(() => { if (data) { setG(data.grading); setS(data.security); setSc(data.school); } }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!g || !s || !sc) return <Loading />;
  const save = async (key, value) => {
    try { await api(`/settings/${key}`, { method: 'PUT', body: value }); toast(t('settingsSaved')); reload(); }
    catch (ex) { toast(errorText(ex), 'bad'); }
  };
  const num = (v) => Number(normalizeDigits(v));
  return (
    <>
      <PageHead title={t('settingsTitle')} />
      <div className="stack">
        <section className="card">
          <div className="card-head"><h2>{t('gradingPolicy')}</h2></div>
          <div className="card-body">
            <div className="form-grid">
              <Field label={t('mode')}>{(p) => <select {...p} className="select" value={g.mode} onChange={(e) => setG({ ...g, mode: e.target.value })}><option value="weighted">{t('mode_weighted')}</option><option value="unweighted">{t('mode_unweighted')}</option></select>}</Field>
              <Field label={t('rounding')}>{(p) => <select {...p} className="select" value={g.rounding} onChange={(e) => setG({ ...g, rounding: e.target.value })}>{['half_up', 'half_even', 'floor'].map((r) => <option key={r} value={r}>{t(`rounding_${r}`)}</option>)}</select>}</Field>
              <Field label={t('decimalPlaces')}>{(p) => <select {...p} className="select" value={g.decimal_places} onChange={(e) => setG({ ...g, decimal_places: num(e.target.value) })}>{[0, 1, 2].map((n) => <option key={n} value={n}>{fmtNum(n)}</option>)}</select>}</Field>
              <Field label={t('displayDecimals')}>{(p) => <select {...p} className="select" value={g.display_decimals} onChange={(e) => setG({ ...g, display_decimals: num(e.target.value) })}>{[0, 1, 2].map((n) => <option key={n} value={n}>{fmtNum(n)}</option>)}</select>}</Field>
            </div>
            <div className="row" style={{ marginBlock: 14, gap: 20 }}>
              <label className="checkbox"><input type="checkbox" checked={g.allow_decimals} onChange={(e) => setG({ ...g, allow_decimals: e.target.checked })} />{t('allowDecimals')}</label>
              <label className="checkbox"><input type="checkbox" checked={g.missing_counts_as_zero} onChange={(e) => setG({ ...g, missing_counts_as_zero: e.target.checked })} />{t('missingZero')}</label>
            </div>
            <h3 style={{ marginBlockEnd: 8 }}>{t('bands')}</h3>
            <div className="form-grid">{BAND_KEYS.map((k) => {
              const b = g.bands.find((x) => x.key === k) || { key: k, min: 0 };
              return <Field key={k} label={t(`band_${k}`)}>{(p) => <input {...p} className="input" inputMode="numeric" value={b.min} disabled={k === 'needs_improvement'}
                onChange={(e) => setG({ ...g, bands: BAND_KEYS.map((kk) => (kk === k ? { key: k, min: num(e.target.value) || 0 } : g.bands.find((x) => x.key === kk) || { key: kk, min: 0 })) })} />}</Field>;
            })}</div>
            <div className="form-actions"><button type="button" className="btn btn-primary" onClick={() => save('grading', g)}>{t('save')}</button></div>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>{t('securityPolicy')}</h2></div>
          <div className="card-body">
            <Field label={t('mfaRoles')}>{() => <div className="row" style={{ gap: 16 }}>{MFA_ROLES.map((r) => (
              <label key={r} className="checkbox"><input type="checkbox" disabled={r === 'super_admin'} checked={s.mfa_required_roles.includes(r)}
                onChange={(e) => setS({ ...s, mfa_required_roles: e.target.checked ? [...s.mfa_required_roles, r] : s.mfa_required_roles.filter((x) => x !== r) })} />{t(`role_${r}`)}</label>))}</div>}</Field>
            <div className="form-grid" style={{ marginBlockStart: 14 }}>
              {[['session_idle_minutes', 'idleMinutes'], ['session_absolute_hours', 'absoluteHours'], ['max_failed_logins', 'maxFailed'], ['lockout_minutes', 'lockoutMinutes']].map(([k, l]) => (
                <Field key={k} label={t(l)}>{(p) => <input {...p} className="input" inputMode="numeric" value={s[k]} onChange={(e) => setS({ ...s, [k]: num(e.target.value) || 0 })} />}</Field>))}
            </div>
            <div className="form-actions"><button type="button" className="btn btn-primary" onClick={() => save('security', s)}>{t('save')}</button></div>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>{t('schoolInfo')}</h2></div>
          <div className="card-body">
            <div className="form-grid">
              <Field label={t('nameCkb')}>{(p) => <input {...p} className="input" value={sc.name_ckb} onChange={(e) => setSc({ ...sc, name_ckb: e.target.value })} />}</Field>
              <Field label={t('nameEn')}>{(p) => <input {...p} className="input" dir="ltr" value={sc.name_en} onChange={(e) => setSc({ ...sc, name_en: e.target.value })} />}</Field>
              <Field label={t('founded')}>{(p) => <input {...p} className="input" inputMode="numeric" value={sc.founded} onChange={(e) => setSc({ ...sc, founded: num(e.target.value) || 0 })} />}</Field>
            </div>
            <div className="form-actions"><button type="button" className="btn btn-primary" onClick={() => save('school', sc)}>{t('save')}</button></div>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>{t('backups')}</h2></div>
          <div className="card-body">
            <p className="muted small" style={{ marginBlockEnd: 10 }}>{t('backupsNote')}</p>
            {backups.data?.items.length ? <ul className="small mono" dir="ltr">{backups.data.items.slice(0, 10).map((b) => <li key={b.file}>{b.file} — {(b.size / 1048576).toFixed(1)} MB — {new Date(b.created_at).toISOString()}</li>)}</ul>
              : <p className="muted">{t('noBackups')}</p>}
          </div>
        </section>
      </div>
    </>
  );
}

export function AccountPage() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [enrolling, setEnrolling] = useState(false);
  return (
    <>
      <PageHead title={t('accountTitle')} sub={`${user.full_name} · ${user.username}`} />
      <div className="grid grid-2">
        <section className="card"><div className="card-head"><h2>{t('changePassword')}</h2></div><div className="card-body"><PasswordForm onDone={async () => { toast(t('passwordChanged')); await refresh(); }} /></div></section>
        <section className="card"><div className="card-head"><h2><ShieldCheck size={18} /> {t('mfaTitle')}</h2></div><div className="card-body stack">
          {user.mfa_enabled ? <div className="alert alert-ok">{t('mfaEnabled')}</div> : (
            <>
              <div className="alert alert-info">{t('mfaDisabled')}</div>
              {enrolling ? <MfaEnroll embedded onDone={async () => { setEnrolling(false); toast(t('mfaEnabled')); await refresh(); }} />
                : <div><button type="button" className="btn btn-primary" onClick={() => setEnrolling(true)}>{t('mfaEnable')}</button></div>}
            </>
          )}
        </div></section>
      </div>
    </>
  );
}
