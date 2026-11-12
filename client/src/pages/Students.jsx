import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Camera, KeyRound, Archive, Pencil, FileText, Copy, Printer } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api, resizeImage } from '../lib/api';
import { useApi, useDebounced, useYears } from '../lib/hooks';
import { Code, Empty, ErrorState, Field, Loading, Modal, PageHead, Pagination, SkeletonRows, SortHeader, StatusBadge, StudentAvatar, useConfirm, useToast } from '../components/ui';

export function sectionLabel(t, fmtNum, s) { return `${t('gradeN', { n: fmtNum(s.grade_level) })} – ${s.section_name ?? s.name}`; }

export function StudentsPage() {
  const { t, fmtNum } = useI18n();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ status: 'active', sectionId: '', classId: '', page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
  const dq = useDebounced(q);
  useEffect(() => setF((x) => ({ ...x, page: 1 })), [dq]);
  const { data, loading, error, reload } = useApi('/students', { ...f, q: dq });
  const { current: year } = useYears();
  const sections = useApi('/academic/sections', { yearId: year?.id }, { skip: !year });
  const classes = useApi('/academic/classes');
  const [editing, setEditing] = useState(null);
  const [creds, setCreds] = useState(null);
  const currentSections = sections.data?.items || [];
  return (
    <>
      <PageHead title={t('studentsTitle')} sub={t('studentsHelp')}>
        {can('students.import') && <Link to="/students/import" className="btn btn-secondary">{t('navImport')}</Link>}
        {can('students.write') && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Plus size={18} />{t('addStudent')}</button>}
      </PageHead>
      <div className="card">
        <div className="filters">
          <Field label={t('search')} className="grow">{(p) => (
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, insetBlockStart: 12, color: 'var(--ink-3)' }} aria-hidden="true" />
              <input {...p} className="input" style={{ paddingInlineStart: 36 }} type="search" placeholder={t('searchStudents')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>)}
          </Field>
          <Field label={t('grade')}>{(p) => (
            <select {...p} className="select" value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value, sectionId: '', page: 1 })}>
              <option value="">{t('all')}</option>
              {(classes.data?.items || []).map((c) => <option key={c.id} value={c.id}>{t('gradeN', { n: fmtNum(c.grade_level) })}</option>)}
            </select>)}
          </Field>
          <Field label={t('section')}>{(p) => (
            <select {...p} className="select" value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value, page: 1 })}>
              <option value="">{t('all')}</option>
              {currentSections.filter((s) => !f.classId || String(s.class_id) === String(f.classId)).map((s) => <option key={s.id} value={s.id}>{sectionLabel(t, fmtNum, s)}</option>)}
            </select>)}
          </Field>
          <Field label={t('status')}>{(p) => (
            <select {...p} className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
              {['active', 'archived', 'transferred', 'graduated', 'all'].map((s) => <option key={s} value={s}>{s === 'all' ? t('all') : t(`st_${s}`)}</option>)}
            </select>)}
          </Field>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <SortHeader label={t('name')} field="name" {...f} onSort={(sort, dir) => setF({ ...f, sort, dir })} />
                <SortHeader label={t('studentNo')} field="student_no" {...f} onSort={(sort, dir) => setF({ ...f, sort, dir })} />
                <SortHeader label={t('class')} field="grade" {...f} onSort={(sort, dir) => setF({ ...f, sort, dir })} />
                <th>{t('guardianPhone')}</th><th>{t('status')}</th><th><span className="sr-only">{t('actions')}</span></th>
              </tr></thead>
              {loading && !data ? <SkeletonRows cols={6} /> : (
                <tbody>
                  {data.items.length === 0 && <tr><td colSpan={6}><Empty title={t('noStudents')} hint={t('noStudentsHint')} /></td></tr>}
                  {data.items.map((s) => (
                    <tr key={s.id}>
                      <td><div className="cell-person"><StudentAvatar student={s} /><div><strong><Link to={`/students/${s.id}`}>{s.full_name_ckb}</Link></strong>{s.full_name_en && <small dir="ltr">{s.full_name_en}</small>}</div></div></td>
                      <td><Code>{s.student_no}</Code></td>
                      <td className="nowrap">{s.grade_level ? sectionLabel(t, fmtNum, s) : <span className="muted small">{t('notEnrolled')}</span>}</td>
                      <td>{s.guardian_phone ? <bdi dir="ltr">{s.guardian_phone}</bdi> : <span className="muted">—</span>}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td><div className="actions"><Link className="btn btn-ghost btn-sm" to={`/students/${s.id}`}>{t('view')}</Link></div></td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}
        {data && <Pagination page={f.page} pageSize={f.pageSize} total={data.total} onPage={(page) => setF({ ...f, page })} onPageSize={(pageSize) => setF({ ...f, pageSize, page: 1 })} />}
      </div>
      {editing && <StudentForm student={editing} sections={currentSections} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); reload(); if (r?.initial_password) setCreds(r); }} />}
      {creds && <CredentialsModal creds={creds} onClose={() => setCreds(null)} />}
    </>
  );
}

export function CredentialsModal({ creds, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${t('username')}: ${creds.username}\n${t('password')}: ${creds.initial_password}`); toast(t('copied')); } catch { /* clipboard blocked */ }
  };
  return (
    <Modal size="narrow" title={t('credentialsTitle')} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} />{t('print')}</button><button type="button" className="btn btn-secondary" onClick={copy}><Copy size={16} />{t('copy')}</button><button type="button" className="btn btn-primary" onClick={onClose}>{t('close')}</button></>}>
      <div className="alert alert-warn" style={{ marginBlockEnd: 14 }}>{t('credentialsNote')}</div>
      <dl className="stack" style={{ gap: 8, margin: 0 }}>
        <div><dt className="label">{t('username')}</dt><dd style={{ margin: 0, fontSize: '1.15rem' }}><Code>{creds.username}</Code></dd></div>
        <div><dt className="label">{t('password')}</dt><dd style={{ margin: 0, fontSize: '1.15rem' }}><Code>{creds.initial_password}</Code></dd></div>
      </dl>
    </Modal>
  );
}

function StudentForm({ student, sections, onClose, onSaved }) {
  const { t, errorText, fmtNum } = useI18n();
  const toast = useToast();
  const isNew = !student.id;
  const [f, setF] = useState({
    full_name_ckb: student.full_name_ckb || '', full_name_en: student.full_name_en || '', date_of_birth: student.date_of_birth || '',
    gender: student.gender || '', guardian_name: student.guardian_name || '', guardian_phone: student.guardian_phone || '', address: student.address || '', section_id: '',
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldErr = (name) => err?.details?.find?.((d) => d.path === name) ? t('required') : null;
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const body = { ...f, date_of_birth: f.date_of_birth || null, gender: f.gender || null, section_id: f.section_id ? Number(f.section_id) : null };
    try {
      if (isNew) { const r = await api('/students', { method: 'POST', body }); toast(t('studentCreated')); onSaved(r); }
      else { delete body.section_id; await api(`/students/${student.id}`, { method: 'PUT', body }); toast(t('saved')); onSaved(); }
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={isNew ? t('addStudent') : t('editStudent')} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button><button type="submit" form="stf" className="btn btn-primary" disabled={busy}>{busy ? t('saving') : t('save')}</button></>}>
      {err && <div className="alert alert-bad" role="alert" style={{ marginBlockEnd: 14 }}>{errorText(err)}</div>}
      <form id="stf" className="form-grid" onSubmit={save}>
        <Field label={t('fullNameCkb')} required error={fieldErr('full_name_ckb')}>{(p) => <input {...p} className="input" required maxLength={120} value={f.full_name_ckb} onChange={set('full_name_ckb')} autoFocus />}</Field>
        <Field label={t('fullNameEn')}>{(p) => <input {...p} className="input" dir="ltr" maxLength={120} value={f.full_name_en} onChange={set('full_name_en')} />}</Field>
        <Field label={t('dob')}>{(p) => <input {...p} className="input" type="date" value={f.date_of_birth} onChange={set('date_of_birth')} />}</Field>
        <Field label={t('gender')}>{(p) => <select {...p} className="select" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="male">{t('male')}</option><option value="female">{t('female')}</option></select>}</Field>
        <Field label={t('guardianName')}>{(p) => <input {...p} className="input" maxLength={120} value={f.guardian_name} onChange={set('guardian_name')} />}</Field>
        <Field label={t('guardianPhone')} error={fieldErr('guardian_phone')}>{(p) => <input {...p} className="input" dir="ltr" type="tel" maxLength={30} value={f.guardian_phone} onChange={set('guardian_phone')} />}</Field>
        <Field label={t('address')}>{(p) => <input {...p} className="input" maxLength={300} value={f.address} onChange={set('address')} />}</Field>
        {isNew && <Field label={t('section')}>{(p) => <select {...p} className="select" value={f.section_id} onChange={set('section_id')}><option value="">{t('noSection')}</option>{sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(t, fmtNum, s)}</option>)}</select>}</Field>}
      </form>
    </Modal>
  );
}

export function StudentDetailPage() {
  const { id } = useParams();
  const { t, fmtNum, fmtDate, errorText } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const { data: s, loading, error, reload } = useApi(`/students/${id}`);
  const { current: year } = useYears();
  const sections = useApi('/academic/sections', { yearId: year?.id }, { skip: !can('students.write') || !year });
  const [editing, setEditing] = useState(false);
  const [creds, setCreds] = useState(null);
  const [statusModal, setStatusModal] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  if (loading && !s) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const currentYearSections = sections.data?.items || [];

  const onPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      const blob = await resizeImage(file);
      const form = new FormData(); form.append('photo', blob, 'photo.jpg');
      await api(`/students/${id}/photo`, { method: 'POST', form });
      toast(t('photoUpdated')); setPhotoKey((k) => k + 1); reload();
    } catch (ex) { toast(errorText(ex), 'bad'); }
  };
  const resetCreds = async () => {
    if (!(await confirm({ message: t('resetCredentialsConfirm'), danger: true }))) return;
    try { setCreds(await api(`/students/${id}/credentials`, { method: 'POST', body: {} })); } catch (ex) { toast(errorText(ex), 'bad'); }
  };
  const move = async (sectionId) => {
    try { await api(`/students/${id}/enroll`, { method: 'POST', body: { section_id: Number(sectionId) } }); toast(t('saved')); reload(); } catch (ex) { toast(errorText(ex), 'bad'); }
  };
  return (
    <>
      <PageHead title={s.full_name_ckb} sub={<><Code>{s.student_no}</Code>{s.full_name_en && <> · <bdi dir="ltr">{s.full_name_en}</bdi></>}</>}>
        <Link className="btn btn-secondary" to={`/reports/student/${s.id}`}><FileText size={16} />{t('reportCard')}</Link>
        {can('students.write') && <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}><Pencil size={16} />{t('edit')}</button>}
        {can('students.write') && <button type="button" className="btn btn-secondary" onClick={resetCreds}><KeyRound size={16} />{t('resetCredentials')}</button>}
        {can('students.archive') && <button type="button" className="btn btn-secondary" onClick={() => setStatusModal(true)}><Archive size={16} />{t('changeStatus')}</button>}
      </PageHead>
      <div className="grid grid-2">
        <section className="card card-pad">
          <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
            <StudentAvatar key={photoKey} student={s} size="avatar-lg" />
            <div className="stack" style={{ gap: 6, flex: 1 }}>
              <div className="row"><StatusBadge status={s.status} />{s.status_reason && <span className="muted small">{s.status_reason}</span>}</div>
              {can('students.write') && (
                <label className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
                  <Camera size={16} />{t('uploadPhoto')}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPhoto} />
                </label>
              )}
              <span className="muted small">{t('photoHint')}</span>
            </div>
          </div>
          <dl className="grid grid-2" style={{ marginBlockStart: 18, gap: 12 }}>
            {[['dob', fmtDate(s.date_of_birth)], ['gender', s.gender ? t(s.gender) : '—'], ['guardianName', s.guardian_name || '—'],
              ['guardianPhone', s.guardian_phone ? <bdi dir="ltr">{s.guardian_phone}</bdi> : '—'], ['address', s.address || '—'], ['username', <Code key="u">{s.username}</Code>]].map(([k, v]) => (
              <div key={k}><dt className="label">{t(k)}</dt><dd style={{ margin: 0 }}>{v}</dd></div>
            ))}
          </dl>
        </section>
        <section className="card">
          <div className="card-head"><h2>{t('enrollmentHistory')}</h2>
            {can('students.write') && s.status === 'active' && currentYearSections.length > 0 && (
              <select className="select input-sm" style={{ inlineSize: 'auto' }} aria-label={t('moveSection')} value="" onChange={(e) => e.target.value && move(e.target.value)}>
                <option value="">{t('moveSection')}…</option>
                {currentYearSections.map((x) => <option key={x.id} value={x.id}>{sectionLabel(t, fmtNum, x)}</option>)}
              </select>
            )}
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('year')}</th><th>{t('class')}</th><th>{t('status')}</th></tr></thead>
            <tbody>
              {s.enrollments.length === 0 && <tr><td colSpan={3} className="muted">{t('notEnrolled')}</td></tr>}
              {s.enrollments.map((e) => (
                <tr key={e.id}><td><bdi dir="ltr">{e.year_name}</bdi> {e.is_current && <span className="badge badge-gold">{t('current')}</span>}</td><td>{sectionLabel(t, fmtNum, e)}</td><td><span className="badge badge-neutral">{t(`es_${e.status}`)}</span></td></tr>
              ))}
            </tbody>
          </table></div>
        </section>
      </div>
      {editing && <StudentForm student={s} sections={[]} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {creds && <CredentialsModal creds={creds} onClose={() => setCreds(null)} />}
      {statusModal && <StatusModal student={s} onClose={() => setStatusModal(false)} onSaved={() => { setStatusModal(false); reload(); }} />}
      <div className="no-print" style={{ marginBlockStart: 16 }}><button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>{t('back')}</button></div>
    </>
  );
}

function StatusModal({ student, onClose, onSaved }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState(student.status);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const save = async () => {
    try { await api(`/students/${student.id}/status`, { method: 'POST', body: { status, reason } }); toast(t('statusChanged')); onSaved(); } catch (ex) { setErr(ex); }
  };
  return (
    <Modal size="narrow" title={t('changeStatus')} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button><button type="button" className={`btn ${status === 'active' ? 'btn-primary' : 'btn-danger'}`} onClick={save} disabled={status !== 'active' && !reason.trim()}>{t('save')}</button></>}>
      <div className="stack">
        {err && <div className="alert alert-bad">{errorText(err)}</div>}
        <Field label={t('status')}>{(p) => <select {...p} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>{['active', 'archived', 'transferred', 'graduated'].map((s) => <option key={s} value={s}>{t(`st_${s}`)}</option>)}</select>}</Field>
        <Field label={t('archiveReason')}>{(p) => <textarea {...p} className="textarea" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
