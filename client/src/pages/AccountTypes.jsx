import { useState } from 'react';
import { Plus, Pencil, Trash2, PauseCircle, PlayCircle, Lock, EyeOff, Eye, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { ErrorState, Field, Loading, Modal, PageHead, useConfirm, useToast } from '../components/ui';

const LEVEL_ICON = { hidden: EyeOff, view: Eye, manage: ShieldCheck };
const LEVEL_BADGE = { hidden: 'badge-neutral', view: 'badge-info', manage: 'badge-ok' };

export function roleLabel(t, pick, r) {
  return r.is_system !== false && !String(r.key).startsWith('custom_') ? t(`role_${r.key}`) : pick(r);
}

/** Super administrator: decide which sections each account type can see and use. */
export default function AccountTypesPage() {
  const { t, pick, fmtNum, errorText } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useApi('/roles');
  const [edit, setEdit] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const act = async (fn, msg) => { try { await fn(); toast(msg || t('saved')); reload(); } catch (ex) { toast(errorText(ex), 'bad'); } };
  return (
    <>
      <PageHead title={t('typesTitle')} sub={t('typesHelp')}>
        <button type="button" className="btn btn-primary" onClick={() => setEdit({ name_en: '', name_ckb: '', description: '', sections: {} })}><Plus size={18} />{t('newType')}</button>
      </PageHead>
      <div className="types-grid">
        {data.items.map((r) => (
          <section key={r.key} className={`card type-card ${r.is_active ? '' : 'suspended'}`}>
            <div className="card-head">
              <div>
                <h2>{roleLabel(t, pick, r)} {r.locked && <Lock size={15} aria-label={t('locked')} />}</h2>
                <p className="muted small">{t('usersN', { n: fmtNum(r.user_count) })} · {r.is_system ? t('builtIn') : t('custom')}{!r.is_active && <> · <span className="badge badge-bad">{t('suspended')}</span></>}</p>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {!r.locked && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit(r)}><Pencil size={15} />{t('edit')}</button>}
                {r.key !== 'super_admin' && (r.is_active
                  ? <button type="button" className="btn btn-ghost btn-sm" title={t('suspend')} aria-label={t('suspend')} onClick={async () => { if (await confirm({ message: t('suspendConfirm', { name: roleLabel(t, pick, r) }), danger: true })) act(() => api(`/roles/${r.key}/status`, { method: 'POST', body: { active: false } })); }}><PauseCircle size={17} /></button>
                  : <button type="button" className="btn btn-ghost btn-sm" title={t('activate')} aria-label={t('activate')} onClick={() => act(() => api(`/roles/${r.key}/status`, { method: 'POST', body: { active: true } }))}><PlayCircle size={17} /></button>)}
                {!r.is_system && <button type="button" className="btn btn-ghost btn-sm" title={t('delete')} aria-label={t('delete')} onClick={async () => { if (await confirm({ message: t('deleteTypeConfirm', { name: pick(r) }), danger: true })) act(() => api(`/roles/${r.key}`, { method: 'DELETE' })); }}><Trash2 size={16} /></button>}
              </div>
            </div>
            <ul className="type-sections">
              {r.key === 'super_admin' ? <li className="muted small">{t('superAdminAll')}</li> : data.sections.map((s) => {
                const lvl = r.sections[s.key];
                const Icon = LEVEL_ICON[lvl];
                return <li key={s.key} className={lvl === 'hidden' ? 'off' : ''}><span>{t(`sec_${s.key}`)}</span><span className={`badge ${LEVEL_BADGE[lvl]}`}><Icon size={12} aria-hidden="true" />{t(`lvl_${lvl}`)}</span></li>;
              })}
            </ul>
          </section>
        ))}
      </div>
      {edit && <TypeEditor role={edit} sections={data.sections} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function TypeEditor({ role, sections, onClose, onSaved }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const isNew = !role.key;
  const [f, setF] = useState({
    name_en: isNew ? '' : role.name_en, name_ckb: isNew ? '' : role.name_ckb, description: role.description || '',
    sections: Object.fromEntries(sections.map((s) => [s.key, role.sections?.[s.key] || 'hidden'])),
  });
  const [err, setErr] = useState(null);
  const save = async () => {
    try {
      const body = { name_en: f.name_en, name_ckb: f.name_ckb, description: f.description || null, sections: f.sections };
      if (isNew) await api('/roles', { method: 'POST', body }); else await api(`/roles/${role.key}`, { method: 'PUT', body });
      toast(t('saved')); onSaved();
    } catch (ex) { setErr(ex); }
  };
  return (
    <Modal size="wide" title={isNew ? t('newType') : `${t('edit')}: ${role.is_system ? t(`role_${role.key}`) : role.name_en}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button><button type="button" className="btn btn-primary" disabled={!f.name_en.trim() || !f.name_ckb.trim()} onClick={save}>{t('save')}</button></>}>
      {err && <div className="alert alert-bad" style={{ marginBlockEnd: 12 }}>{errorText(err)}</div>}
      <div className="form-grid" style={{ marginBlockEnd: 16 }}>
        <Field label={t('nameCkb')} required>{(p) => <input {...p} className="input" maxLength={60} value={f.name_ckb} onChange={(e) => setF({ ...f, name_ckb: e.target.value })} autoFocus />}</Field>
        <Field label={t('nameEn')} required>{(p) => <input {...p} className="input" dir="ltr" maxLength={60} value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} />}</Field>
      </div>
      {!isNew && <div className="alert alert-info" style={{ marginBlockEnd: 12 }}>{t('typeChangeNote')}</div>}
      <ul className="section-picker">
        {sections.map((s) => (
          <li key={s.key}>
            <div><strong>{t(`sec_${s.key}`)}</strong><span className="muted small">{t(`sec_${s.key}_hint`)}</span></div>
            <div className="segmented" role="radiogroup" aria-label={t(`sec_${s.key}`)}>
              {s.levels.map((lvl) => (
                <button key={lvl} type="button" role="radio" aria-checked={f.sections[s.key] === lvl} className={f.sections[s.key] === lvl ? `on ${lvl}` : ''}
                  onClick={() => setF({ ...f, sections: { ...f.sections, [s.key]: lvl } })}>{t(`lvl_${lvl}`)}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
