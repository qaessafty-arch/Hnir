import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, KeyRound, ShieldOff, UserX, UserCheck, Link2, Star } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api, normalizeDigits, ltr } from '../lib/api';
import { useApi, useDebounced, useYears } from '../lib/hooks';
import { Code, Empty, ErrorState, Field, Loading, Modal, PageHead, Pagination, SkeletonRows, StatusBadge, useConfirm, useToast } from '../components/ui';
import { CredentialsModal, sectionLabel } from './Students';

/** Generic modal form driven by a field list. */
function FormModal({ title, fields, initial, onSubmit, onClose }) {
  const { t, errorText } = useI18n();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await onSubmit(f); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button><button type="submit" form="fm" className="btn btn-primary" disabled={busy}>{busy ? t('saving') : t('save')}</button></>}>
      {err && <div className="alert alert-bad" role="alert" style={{ marginBlockEnd: 12 }}>{errorText(err)}{err.details?.length ? <div className="small"><bdi dir="ltr">{err.details.map((d) => d.path).filter(Boolean).join(', ')}</bdi></div> : null}</div>}
      <form id="fm" className="form-grid" onSubmit={submit}>
        {fields.map((fd) => (
          <Field key={fd.name} label={fd.label} hint={fd.hint} required={fd.required}>{(p) => {
            const common = { ...p, value: f[fd.name] ?? '', required: fd.required, onChange: (e) => setF({ ...f, [fd.name]: fd.type === 'checkbox' ? e.target.checked : e.target.value }) };
            if (fd.type === 'select') return <select {...common} className="select">{fd.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
            if (fd.type === 'checkbox') return <label className="checkbox"><input type="checkbox" id={p.id} checked={!!f[fd.name]} onChange={common.onChange} />{fd.label}</label>;
            if (fd.type === 'multi') return (
              <div className="stack" style={{ gap: 6 }}>{fd.options.map((o) => (
                <label key={o.value} className="checkbox"><input type="checkbox" checked={(f[fd.name] || []).includes(o.value)}
                  onChange={(e) => setF({ ...f, [fd.name]: e.target.checked ? [...(f[fd.name] || []), o.value] : (f[fd.name] || []).filter((x) => x !== o.value) })} />{o.label}</label>))}</div>);
            return <input {...common} className="input" type={fd.type || 'text'} dir={fd.ltr ? 'ltr' : undefined} maxLength={fd.max || 200} inputMode={fd.inputMode} />;
          }}</Field>
        ))}
      </form>
    </Modal>
  );
}

// ---------------- Teachers ----------------
export function TeachersPage() {
  const { t, fmtNum, fmtDateTime } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi('/teachers', { q: dq, status: 'all' });
  const [edit, setEdit] = useState(null);
  const [creds, setCreds] = useState(null);
  const fields = (isNew) => [
    ...(isNew ? [{ name: 'username', label: t('username'), required: true, ltr: true, max: 50 }] : []),
    { name: 'full_name', label: t('name'), required: true, max: 120 },
    { name: 'email', label: t('email'), type: 'email', ltr: true }, { name: 'phone', label: t('phone'), type: 'tel', ltr: true, max: 30 },
    ...(!isNew ? [{ name: 'status', label: t('status'), type: 'select', options: [{ value: 'active', label: t('st_active') }, { value: 'inactive', label: t('st_inactive') }] }] : []),
  ];
  return (
    <>
      <PageHead title={t('teachersTitle')} sub={t('teachersSub')}>
        {can('teachers.write') && <button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Plus size={18} />{t('addTeacher')}</button>}
      </PageHead>
      <div className="card">
        <div className="filters"><Field label={t('search')} className="grow">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field></div>
        {error ? <ErrorState error={error} onRetry={reload} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('name')}</th><th>{t('staffNo')}</th><th>{t('username')}</th><th>{t('phone')}</th><th>{t('assignments')}</th><th>{t('lastLogin')}</th><th>{t('status')}</th><th /></tr></thead>
            {loading && !data ? <SkeletonRows cols={8} /> : <tbody>
              {data.items.length === 0 && <tr><td colSpan={8}><Empty title={t('noStudentsHint')} /></td></tr>}
              {data.items.map((x) => (
                <tr key={x.id}><td><strong>{x.full_name}</strong>{x.email && <div className="small muted"><bdi dir="ltr">{x.email}</bdi></div>}</td><td><Code>{x.staff_no}</Code></td><td><Code>{x.username}</Code></td>
                  <td>{x.phone ? <bdi dir="ltr">{x.phone}</bdi> : '—'}</td><td className="num">{fmtNum(x.assignment_count)}</td><td className="small">{x.last_login_at ? fmtDateTime(x.last_login_at) : t('never')}</td>
                  <td><StatusBadge status={x.status} /></td>
                  <td>{can('teachers.write') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(x)} aria-label={t('edit')}><Pencil size={15} /></button>}</td></tr>
              ))}
            </tbody>}
          </table></div>
        )}
      </div>
      {edit && <FormModal title={edit.id ? t('edit') : t('addTeacher')} fields={fields(!edit.id)} initial={{ status: 'active', ...edit }} onClose={() => setEdit(null)}
        onSubmit={async (f) => {
          if (edit.id) { await api(`/teachers/${edit.id}`, { method: 'PUT', body: { full_name: f.full_name, email: f.email || null, phone: f.phone || null, status: f.status } }); toast(t('saved')); }
          else { const r = await api('/teachers', { method: 'POST', body: { username: f.username, full_name: f.full_name, email: f.email || null, phone: f.phone || null } }); setCreds(r); }
          setEdit(null); reload();
        }} />}
      {creds && <CredentialsModal creds={creds} onClose={() => setCreds(null)} />}
    </>
  );
}

// ---------------- Users ----------------
const ROLE_KEYS = ['super_admin', 'principal', 'registrar', 'teacher', 'parent', 'auditor'];
export function UsersPage() {
  const { t, fmtDateTime, errorText } = useI18n();
  const { can, user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [f, setF] = useState({ role: '', includeStudents: '0', page: 1, pageSize: 25 });
  useEffect(() => setF((x) => ({ ...x, page: 1 })), [dq]);
  const { data, loading, error, reload } = useApi('/users', { ...f, q: dq });
  const [edit, setEdit] = useState(null);
  const [rolesFor, setRolesFor] = useState(null);
  const [creds, setCreds] = useState(null);
  const [token, setToken] = useState(null);
  const [childrenFor, setChildrenFor] = useState(null);
  const assignable = ROLE_KEYS.filter((r) => can('roles.manage') || !['super_admin', 'principal'].includes(r));
  const act = async (fn, msg) => { try { await fn(); toast(msg || t('saved')); reload(); } catch (ex) { toast(errorText(ex), 'bad'); } };
  return (
    <>
      <PageHead title={t('usersTitle')} sub={t('usersSub')}><button type="button" className="btn btn-primary" onClick={() => setEdit({ roles: ['teacher'] })}><Plus size={18} />{t('addUser')}</button></PageHead>
      <div className="card">
        <div className="filters">
          <Field label={t('search')} className="grow">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          <Field label={t('roles')}>{(p) => <select {...p} className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, page: 1 })}><option value="">{t('all')}</option>{[...ROLE_KEYS, 'student'].map((r) => <option key={r} value={r}>{t(`role_${r}`)}</option>)}</select>}</Field>
          <label className="checkbox" style={{ paddingBlockEnd: 8 }}><input type="checkbox" checked={f.includeStudents === '1'} onChange={(e) => setF({ ...f, includeStudents: e.target.checked ? '1' : '0', page: 1 })} />{t('includeStudents')}</label>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('name')}</th><th>{t('username')}</th><th>{t('roles')}</th><th>{t('mfa')}</th><th>{t('lastLogin')}</th><th>{t('status')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead>
            {loading && !data ? <SkeletonRows cols={7} /> : <tbody>
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.full_name}</strong>{u.email && <div className="small muted"><bdi dir="ltr">{u.email}</bdi></div>}</td><td><Code>{u.username}</Code></td>
                  <td><div className="row" style={{ gap: 4 }}>{(u.roles || []).map((r) => <span key={r} className="badge badge-navy">{t(`role_${r}`)}</span>)}</div></td>
                  <td>{u.mfa_enabled ? <span className="badge badge-ok">{t('yes')}</span> : <span className="badge badge-neutral">{t('no')}</span>}</td>
                  <td className="small">{u.last_login_at ? fmtDateTime(u.last_login_at) : t('never')}{u.locked_until && new Date(u.locked_until) > new Date() && <span className="badge badge-bad"> {t('locked')}</span>}</td>
                  <td>{u.status === 'active' ? <span className="badge badge-ok">{t('st_active')}</span> : <span className="badge badge-bad">{t('disable')}</span>}</td>
                  <td><div className="actions">
                    <button type="button" className="btn btn-ghost btn-sm" title={t('edit')} aria-label={t('edit')} onClick={() => setEdit(u)}><Pencil size={15} /></button>
                    {!u.roles?.includes('student') && <button type="button" className="btn btn-ghost btn-sm" title={t('roles')} aria-label={t('roles')} onClick={() => setRolesFor(u)}><Star size={15} /></button>}
                    {u.roles?.includes('parent') && <button type="button" className="btn btn-ghost btn-sm" title={t('linkedChildren')} aria-label={t('linkedChildren')} onClick={() => setChildrenFor(u)}><Link2 size={15} /></button>}
                    <button type="button" className="btn btn-ghost btn-sm" title={t('issueReset')} aria-label={t('issueReset')} onClick={() => act(async () => setToken((await api(`/users/${u.id}/reset-token`, { method: 'POST', body: {} })).token))}><KeyRound size={15} /></button>
                    {u.mfa_enabled && <button type="button" className="btn btn-ghost btn-sm" title={t('resetMfa')} aria-label={t('resetMfa')} onClick={async () => { if (await confirm({ message: t('resetMfaConfirm'), danger: true })) act(() => api(`/users/${u.id}/mfa-reset`, { method: 'POST', body: {} })); }}><ShieldOff size={15} /></button>}
                    {u.id !== me.id && (u.status === 'active'
                      ? <button type="button" className="btn btn-ghost btn-sm" title={t('disable')} aria-label={t('disable')} onClick={async () => { if (await confirm({ message: t('disableConfirm'), danger: true })) act(() => api(`/users/${u.id}/status`, { method: 'POST', body: { status: 'disabled' } })); }}><UserX size={15} /></button>
                      : <button type="button" className="btn btn-ghost btn-sm" title={t('enable')} aria-label={t('enable')} onClick={() => act(() => api(`/users/${u.id}/status`, { method: 'POST', body: { status: 'active' } }))}><UserCheck size={15} /></button>)}
                  </div></td>
                </tr>
              ))}
            </tbody>}
          </table></div>
        )}
        {data && <Pagination page={f.page} pageSize={f.pageSize} total={data.total} onPage={(page) => setF({ ...f, page })} onPageSize={(pageSize) => setF({ ...f, pageSize, page: 1 })} />}
      </div>
      {edit && <FormModal title={edit.id ? t('edit') : t('addUser')} initial={edit} onClose={() => setEdit(null)}
        fields={[...(edit.id ? [] : [{ name: 'username', label: t('username'), required: true, ltr: true, max: 50 }]), { name: 'full_name', label: t('name'), required: true, max: 120 },
          { name: 'email', label: t('email'), type: 'email', ltr: true }, ...(edit.id ? [] : [{ name: 'phone', label: t('phone'), type: 'tel', ltr: true, max: 30 },
          { name: 'roles', label: t('roles'), type: 'multi', options: assignable.map((r) => ({ value: r, label: t(`role_${r}`) })) }])]}
        onSubmit={async (v) => {
          if (edit.id) { await api(`/users/${edit.id}`, { method: 'PUT', body: { full_name: v.full_name, email: v.email || null } }); toast(t('saved')); }
          else { setCreds(await api('/users', { method: 'POST', body: { username: v.username, full_name: v.full_name, email: v.email || null, phone: v.phone || null, roles: v.roles } })); }
          setEdit(null); reload();
        }} />}
      {rolesFor && <FormModal title={`${t('roles')} — ${rolesFor.full_name}`} initial={{ roles: rolesFor.roles || [] }} onClose={() => setRolesFor(null)}
        fields={[{ name: 'roles', label: t('roles'), type: 'multi', options: assignable.map((r) => ({ value: r, label: t(`role_${r}`) })) }]}
        onSubmit={async (v) => { await api(`/users/${rolesFor.id}/roles`, { method: 'PUT', body: { roles: v.roles } }); toast(t('saved')); setRolesFor(null); reload(); }} />}
      {creds && <CredentialsModal creds={creds} onClose={() => setCreds(null)} />}
      {token && <Modal size="narrow" title={t('issueReset')} onClose={() => setToken(null)} footer={<button type="button" className="btn btn-primary" onClick={() => setToken(null)}>{t('close')}</button>}>
        <p className="small" style={{ marginBlockEnd: 10 }}>{t('resetIssued')}</p><p style={{ wordBreak: 'break-all', userSelect: 'all' }}><Code>{token}</Code></p>
        <p className="small muted" style={{ marginBlockStart: 10 }}><bdi dir="ltr">{window.location.origin}/reset</bdi></p></Modal>}
      {childrenFor && <ChildrenModal user={childrenFor} onClose={() => setChildrenFor(null)} />}
    </>
  );
}

function ChildrenModal({ user, onClose }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const list = useApi(`/users/${user.id}/children`);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const found = useApi('/students', { q: dq, pageSize: 8 }, { skip: dq.length < 2 });
  const [rel, setRel] = useState('guardian');
  const link = async (sid) => { try { await api(`/users/${user.id}/children`, { method: 'POST', body: { student_id: sid, relationship: rel } }); toast(t('saved')); list.reload(); } catch (ex) { toast(errorText(ex), 'bad'); } };
  const unlink = async (sid) => { try { await api(`/users/${user.id}/children/${sid}`, { method: 'DELETE' }); list.reload(); } catch (ex) { toast(errorText(ex), 'bad'); } };
  return (
    <Modal title={`${t('linkedChildren')} — ${user.full_name}`} onClose={onClose}>
      {list.loading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : (
        <table className="table"><tbody>{list.data.items.length === 0 && <tr><td className="muted">—</td></tr>}
          {list.data.items.map((c) => <tr key={c.id}><td>{c.full_name_ckb} <Code>{c.student_no}</Code></td><td>{t(`rel_${c.relationship}`)}</td><td>{c.verified_at ? <span className="badge badge-ok">{t('verified')}</span> : <span className="badge badge-warn">{t('unverified')}</span>}</td>
            <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => unlink(c.id)} aria-label={t('remove')}><Trash2 size={15} /></button></td></tr>)}</tbody></table>
      )}
      <h3 style={{ marginBlock: '18px 8px' }}>{t('linkChild')}</h3>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label={t('search')} className="grow">{(p) => <input {...p} className="input" type="search" placeholder={t('searchStudents')} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label={t('relationship')}>{(p) => <select {...p} className="select" value={rel} onChange={(e) => setRel(e.target.value)}>{['father', 'mother', 'guardian', 'other'].map((r) => <option key={r} value={r}>{t(`rel_${r}`)}</option>)}</select>}</Field>
      </div>
      <table className="table"><tbody>{(found.data?.items || []).map((s) => <tr key={s.id}><td>{s.full_name_ckb} <Code>{s.student_no}</Code></td><td><button type="button" className="btn btn-secondary btn-sm" onClick={() => link(s.id)}><Plus size={15} />{t('add')}</button></td></tr>)}</tbody></table>
    </Modal>
  );
}

// ---------------- Academic years & terms ----------------
export function YearsPage() {
  const { t, fmtDate, fmtNum, pick, errorText } = useI18n();
  const toast = useToast();
  const years = useApi('/academic/years');
  const terms = useApi('/academic/terms');
  const [ey, setEy] = useState(null);
  const [et, setEt] = useState(null);
  if (years.loading && !years.data) return <Loading />;
  if (years.error) return <ErrorState error={years.error} onRetry={years.reload} />;
  const setCurrent = async (id) => { try { await api(`/academic/years/${id}/set-current`, { method: 'POST', body: {} }); toast(t('saved')); years.reload(); } catch (ex) { toast(errorText(ex), 'bad'); } };
  return (
    <>
      <PageHead title={t('yearsTitle')}><button type="button" className="btn btn-primary" onClick={() => setEy({ status: 'active' })}><Plus size={18} />{t('addYear')}</button></PageHead>
      <div className="stack">
        {years.data.items.length === 0 && <div className="card"><Empty title={t('noCurrentYear')} /></div>}
        {years.data.items.map((y) => (
          <section key={y.id} className="card">
            <div className="card-head">
              <div className="row"><h2><bdi dir="ltr">{y.name}</bdi></h2>{y.is_current && <span className="badge badge-gold">{t('current')}</span>}<span className="muted small">{fmtDate(y.starts_on)} – {fmtDate(y.ends_on)}</span></div>
              <div className="row">
                {!y.is_current && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCurrent(y.id)}>{t('setCurrent')}</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEy(y)}><Pencil size={15} />{t('edit')}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEt({ academic_year_id: y.id, ordinal: 1, grade_entry_open: true, starts_on: y.starts_on, ends_on: y.ends_on })}><Plus size={15} />{t('addTerm')}</button>
              </div>
            </div>
            <div className="table-wrap"><table className="table"><thead><tr><th>{t('ordinal')}</th><th>{t('term')}</th><th>{t('startsOn')}</th><th>{t('endsOn')}</th><th>{t('gradeEntryOpen')}</th><th /></tr></thead>
              <tbody>{(terms.data?.items || []).filter((x) => x.academic_year_id === y.id).map((x) => (
                <tr key={x.id}><td className="num">{fmtNum(x.ordinal)}</td><td>{pick(x)}</td><td>{fmtDate(x.starts_on)}</td><td>{fmtDate(x.ends_on)}</td>
                  <td>{x.grade_entry_open ? <span className="badge badge-ok">{t('open')}</span> : <span className="badge badge-neutral">{t('closed')}</span>}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEt(x)} aria-label={t('edit')}><Pencil size={15} /></button></td></tr>))}</tbody></table></div>
          </section>
        ))}
      </div>
      {ey && <FormModal title={ey.id ? t('edit') : t('addYear')} initial={ey} onClose={() => setEy(null)}
        fields={[{ name: 'name', label: t('name'), required: true, hint: '2026-2027', ltr: true }, { name: 'starts_on', label: t('startsOn'), type: 'date', required: true }, { name: 'ends_on', label: t('endsOn'), type: 'date', required: true },
          { name: 'status', label: t('status'), type: 'select', options: ['planned', 'active', 'closed'].map((s) => ({ value: s, label: t(s === 'active' ? 'st_active' : s) })) }]}
        onSubmit={async (v) => { const body = { name: v.name, starts_on: v.starts_on, ends_on: v.ends_on, status: v.status }; await api(ey.id ? `/academic/years/${ey.id}` : '/academic/years', { method: ey.id ? 'PUT' : 'POST', body }); toast(t('saved')); setEy(null); years.reload(); }} />}
      {et && <FormModal title={et.id ? t('edit') : t('addTerm')} initial={et} onClose={() => setEt(null)}
        fields={[{ name: 'name_en', label: t('nameEn'), required: true, ltr: true }, { name: 'name_ckb', label: t('nameCkb'), required: true }, { name: 'ordinal', label: t('ordinal'), required: true, inputMode: 'numeric' },
          { name: 'starts_on', label: t('startsOn'), type: 'date', required: true }, { name: 'ends_on', label: t('endsOn'), type: 'date', required: true }, { name: 'grade_entry_open', label: t('gradeEntryOpen'), type: 'checkbox' }]}
        onSubmit={async (v) => { const body = { academic_year_id: v.academic_year_id, name_en: v.name_en, name_ckb: v.name_ckb, ordinal: Number(normalizeDigits(v.ordinal)), starts_on: v.starts_on, ends_on: v.ends_on, grade_entry_open: !!v.grade_entry_open };
          await api(et.id ? `/academic/terms/${et.id}` : '/academic/terms', { method: et.id ? 'PUT' : 'POST', body }); toast(t('saved')); setEt(null); terms.reload(); }} />}
    </>
  );
}

// ---------------- Sections ----------------
export function SectionsPage() {
  const { t, fmtNum, errorText } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  const yid = yearId || current?.id;
  const { data, loading, error, reload } = useApi('/academic/sections', { yearId: yid }, { skip: !yid });
  const classes = useApi('/academic/classes');
  const teachers = useApi('/teachers');
  const [edit, setEdit] = useState(null);
  const del = async (s) => { if (!(await confirm({ message: `${t('delete')}: ${sectionLabel(t, fmtNum, s)}?`, danger: true }))) return; try { await api(`/academic/sections/${s.id}`, { method: 'DELETE' }); reload(); } catch (ex) { toast(errorText(ex), 'bad'); } };
  return (
    <>
      <PageHead title={t('sectionsTitle')}>
        <select className="select" style={{ inlineSize: 'auto' }} aria-label={t('year')} value={yid || ''} onChange={(e) => setYearId(e.target.value)}>{years.map((y) => <option key={y.id} value={y.id}>{ltr(y.name)}</option>)}</select>
        <button type="button" className="btn btn-primary" disabled={!yid} onClick={() => setEdit({ academic_year_id: yid, class_id: classes.data?.items[0]?.id, name: 'A' })}><Plus size={18} />{t('addSection')}</button>
      </PageHead>
      <div className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>{t('class')}</th><th>{t('homeroom')}</th><th>{t('students')}</th><th>{t('capacity')}</th><th /></tr></thead>
            {loading && !data ? <SkeletonRows cols={5} /> : <tbody>
              {data?.items.length === 0 && <tr><td colSpan={5}><Empty title={t('noAssessmentsHint')} /></td></tr>}
              {data?.items.map((s) => (
                <tr key={s.id}><td><strong>{sectionLabel(t, fmtNum, s)}</strong></td><td>{s.homeroom_teacher_name || '—'}</td><td className="num">{fmtNum(s.student_count)}</td><td className="num">{s.capacity ? fmtNum(s.capacity) : '—'}</td>
                  <td><div className="actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(s)} aria-label={t('edit')}><Pencil size={15} /></button><button type="button" className="btn btn-ghost btn-sm" onClick={() => del(s)} aria-label={t('delete')}><Trash2 size={15} /></button></div></td></tr>
              ))}
            </tbody>}
          </table></div>
        )}
      </div>
      {edit && <FormModal title={edit.id ? t('edit') : t('addSection')} initial={{ ...edit, homeroom_teacher_id: edit.homeroom_teacher_id || '' }} onClose={() => setEdit(null)}
        fields={[{ name: 'class_id', label: t('class'), type: 'select', required: true, options: (classes.data?.items || []).map((c) => ({ value: c.id, label: t('gradeN', { n: fmtNum(c.grade_level) }) })) },
          { name: 'name', label: t('section'), required: true, max: 20 },
          { name: 'homeroom_teacher_id', label: t('homeroom'), type: 'select', options: [{ value: '', label: '—' }, ...(teachers.data?.items || []).map((x) => ({ value: x.id, label: x.full_name }))] },
          { name: 'capacity', label: t('capacity'), inputMode: 'numeric' }]}
        onSubmit={async (v) => { const body = { class_id: Number(v.class_id), academic_year_id: Number(v.academic_year_id), name: v.name, homeroom_teacher_id: v.homeroom_teacher_id ? Number(v.homeroom_teacher_id) : null, capacity: v.capacity ? Number(normalizeDigits(v.capacity)) : null };
          await api(edit.id ? `/academic/sections/${edit.id}` : '/academic/sections', { method: edit.id ? 'PUT' : 'POST', body }); toast(t('saved')); setEdit(null); reload(); }} />}
    </>
  );
}

// ---------------- Subjects & categories ----------------
export function SubjectsPage() {
  const { t, fmtNum, fmtPct, pick } = useI18n();
  const toast = useToast();
  const subjects = useApi('/academic/subjects');
  const cats = useApi('/academic/categories');
  const [edit, setEdit] = useState(null);
  const [ec, setEc] = useState(null);
  return (
    <>
      <PageHead title={t('subjectsTitle')}><button type="button" className="btn btn-primary" onClick={() => setEdit({ default_max_score: 10, pass_mark_percent: 50, sort_order: 0, is_active: true })}><Plus size={18} />{t('addSubject')}</button></PageHead>
      <div className="card" style={{ marginBlockEnd: 16 }}>
        {subjects.error ? <ErrorState error={subjects.error} /> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('code')}</th><th>{t('nameCkb')}</th><th>{t('nameEn')}</th><th>{t('defaultMax')}</th><th>{t('passMark')}</th><th>{t('status')}</th><th /></tr></thead>
          {subjects.loading && !subjects.data ? <SkeletonRows cols={7} /> : <tbody>{subjects.data.items.map((s) => (
            <tr key={s.id}><td><Code>{s.code}</Code></td><td>{s.name_ckb}</td><td dir="ltr" style={{ textAlign: 'start' }}>{s.name_en}</td><td className="num">{fmtNum(s.default_max_score)}</td><td className="num">{fmtPct(s.pass_mark_percent)}</td>
              <td>{s.is_active ? <span className="badge badge-ok">{t('active')}</span> : <span className="badge badge-neutral">{t('st_inactive')}</span>}</td>
              <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(s)} aria-label={t('edit')}><Pencil size={15} /></button></td></tr>))}</tbody>}
        </table></div>}
      </div>
      <section className="card">
        <div className="card-head"><h2>{t('categoriesTitle')}</h2></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('category')}</th><th>{t('weight')}</th><th /></tr></thead>
          <tbody>{(cats.data?.items || []).map((c) => <tr key={c.id}><td>{pick(c)}</td><td className="num">{fmtNum(c.weight)}</td><td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEc(c)} aria-label={t('edit')}><Pencil size={15} /></button></td></tr>)}</tbody></table></div>
      </section>
      {edit && <FormModal title={edit.id ? t('edit') : t('addSubject')} initial={edit} onClose={() => setEdit(null)}
        fields={[{ name: 'code', label: t('code'), required: true, ltr: true, max: 10 }, { name: 'name_ckb', label: t('nameCkb'), required: true, max: 80 }, { name: 'name_en', label: t('nameEn'), required: true, ltr: true, max: 80 },
          { name: 'default_max_score', label: t('defaultMax'), required: true, inputMode: 'decimal' }, { name: 'pass_mark_percent', label: t('passMark'), required: true, inputMode: 'decimal' },
          { name: 'sort_order', label: t('sortOrder'), inputMode: 'numeric' }, { name: 'is_active', label: t('active'), type: 'checkbox' }]}
        onSubmit={async (v) => { const body = { code: v.code, name_ckb: v.name_ckb, name_en: v.name_en, default_max_score: Number(normalizeDigits(v.default_max_score)), pass_mark_percent: Number(normalizeDigits(v.pass_mark_percent)), sort_order: Number(normalizeDigits(v.sort_order || 0)), is_active: !!v.is_active };
          await api(edit.id ? `/academic/subjects/${edit.id}` : '/academic/subjects', { method: edit.id ? 'PUT' : 'POST', body }); toast(t('saved')); setEdit(null); subjects.reload(); }} />}
      {ec && <FormModal title={t('edit')} initial={ec} onClose={() => setEc(null)}
        fields={[{ name: 'name_ckb', label: t('nameCkb'), required: true }, { name: 'name_en', label: t('nameEn'), required: true, ltr: true }, { name: 'weight', label: t('weight'), required: true, inputMode: 'decimal' }]}
        onSubmit={async (v) => { await api(`/academic/categories/${ec.id}`, { method: 'PUT', body: { name_ckb: v.name_ckb, name_en: v.name_en, weight: Number(normalizeDigits(v.weight)) } }); toast(t('saved')); setEc(null); cats.reload(); }} />}
    </>
  );
}

// ---------------- Teacher assignments ----------------
export function AssignmentsPage() {
  const { t, fmtNum, pick, errorText } = useI18n();
  const toast = useToast();
  const { current } = useYears();
  const list = useApi('/academic/assignments', { yearId: current?.id }, { skip: !current });
  const teachers = useApi('/teachers');
  const sections = useApi('/academic/sections', { yearId: current?.id }, { skip: !current });
  const subjects = useApi('/academic/subjects');
  const [f, setF] = useState({ teacher_id: '', section_id: '', subject_id: '' });
  const add = async (e) => {
    e.preventDefault();
    try { await api('/academic/assignments', { method: 'POST', body: { teacher_id: Number(f.teacher_id), section_id: Number(f.section_id), subject_id: Number(f.subject_id) } }); toast(t('saved')); list.reload(); }
    catch (ex) { toast(errorText(ex), 'bad'); }
  };
  const del = async (id) => { try { await api(`/academic/assignments/${id}`, { method: 'DELETE' }); list.reload(); } catch (ex) { toast(errorText(ex), 'bad'); } };
  return (
    <>
      <PageHead title={t('assignmentsTitle')} sub={`${t('assignmentsSub')}${current ? ` · ${ltr(current.name)}` : ''}`} />
      <form className="card filters" onSubmit={add} style={{ marginBlockEnd: 16, borderRadius: 'var(--radius)' }}>
        <Field label={t('teacher')}>{(p) => <select {...p} className="select" required value={f.teacher_id} onChange={(e) => setF({ ...f, teacher_id: e.target.value })}><option value="">—</option>{(teachers.data?.items || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select>}</Field>
        <Field label={t('section')}>{(p) => <select {...p} className="select" required value={f.section_id} onChange={(e) => setF({ ...f, section_id: e.target.value })}><option value="">—</option>{(sections.data?.items || []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(t, fmtNum, s)}</option>)}</select>}</Field>
        <Field label={t('subject')}>{(p) => <select {...p} className="select" required value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{(subjects.data?.items || []).filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{pick(s)}</option>)}</select>}</Field>
        <button className="btn btn-primary"><Plus size={18} />{t('addAssignment')}</button>
      </form>
      <div className="card">{list.error ? <ErrorState error={list.error} /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('teacher')}</th><th>{t('class')}</th><th>{t('subject')}</th><th /></tr></thead>
          {list.loading && !list.data ? <SkeletonRows cols={4} /> : <tbody>
            {list.data?.items.length === 0 && <tr><td colSpan={4}><Empty title={t('noAssignments')} /></td></tr>}
            {list.data?.items.map((a) => <tr key={a.id}><td>{a.teacher_name}</td><td>{t('gradeN', { n: fmtNum(a.grade_level) })} – {a.section_name}</td><td>{pick(a, 'subject_name')}</td>
              <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => del(a.id)} aria-label={t('remove')}><Trash2 size={15} /></button></td></tr>)}
          </tbody>}
        </table></div>)}
      </div>
    </>
  );
}
