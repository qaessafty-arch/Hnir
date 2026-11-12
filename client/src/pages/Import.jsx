import { useState } from 'react';
import { Download, Upload, CheckCircle2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { api, csvBlob, parseCsv, saveBlob, ltr } from '../lib/api';
import { useYears } from '../lib/hooks';
import { Code, Field, PageHead, useToast } from '../components/ui';

const COLS = ['full_name_ckb', 'full_name_en', 'gender', 'date_of_birth', 'grade_level', 'section', 'guardian_name', 'guardian_phone'];

export default function ImportPage() {
  const { t, fmtNum, errorText } = useI18n();
  const toast = useToast();
  const { years, current } = useYears();
  const [yearId, setYearId] = useState('');
  const [rows, setRows] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const yid = Number(yearId || current?.id);

  const template = () => saveBlob(csvBlob(COLS, [['ئاریان سامان', 'Aryan Saman', 'male', '2012-05-14', '10', 'A', 'سامان ئەحمەد', '+964 750 000 0000']]), 'students-template.csv');
  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    setPreview(null); setResult(null); setErr(null);
    if (!file) return;
    const text = await file.text();
    const table = parseCsv(text);
    const header = (table.shift() || []).map((h) => h.trim().toLowerCase());
    const parsed = table.map((r) => Object.fromEntries(COLS.map((c) => [c, (r[header.indexOf(c)] ?? '').trim()])));
    setRows(parsed);
    setBusy(true);
    try { setPreview(await api('/students/import/preview', { method: 'POST', body: { yearId: yid, rows: parsed } })); }
    catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/students/import/commit', { method: 'POST', body: { yearId: yid, rows, skipDuplicates: true } });
      setResult(r); setPreview(null); toast(t('importDone', { n: fmtNum(r.created.length) }));
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const dupes = preview?.results.filter((r) => r.warnings).length || 0;
  return (
    <>
      <PageHead title={t('importTitle')} sub={t('importSub')}>
        <button type="button" className="btn btn-secondary" onClick={template}><Download size={16} />{t('importTemplate')}</button>
      </PageHead>
      <div className="card card-pad stack">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label={t('year')}>{(p) => <select {...p} className="select" value={yearId || current?.id || ''} onChange={(e) => setYearId(e.target.value)}>{years.map((y) => <option key={y.id} value={y.id}>{ltr(y.name)}</option>)}</select>}</Field>
          <label className="btn btn-primary"><Upload size={16} />{t('chooseFile')}<input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} disabled={!yid} /></label>
        </div>
        <p className="muted small">CSV: <bdi dir="ltr" className="mono">{COLS.join(', ')}</bdi></p>
        {err && <div className="alert alert-bad" role="alert">{errorText(err)}</div>}
        {busy && <p className="muted">{t('loading')}</p>}
      </div>
      {preview && (
        <div className="card" style={{ marginBlockStart: 16 }}>
          <div className="card-head">
            <div className="row"><span className="badge badge-ok">{t('importValid', { n: fmtNum(preview.valid) })}</span>
              {preview.invalid > 0 && <span className="badge badge-bad">{t('importInvalid', { n: fmtNum(preview.invalid) })}</span>}
              {dupes > 0 && <span className="badge badge-warn">{t('importDuplicates', { n: fmtNum(dupes) })}</span>}</div>
            <button type="button" className="btn btn-gold" disabled={busy || preview.invalid > 0 || preview.valid - dupes <= 0} onClick={commit}>{t('importCommit', { n: fmtNum(preview.valid - dupes) })}</button>
          </div>
          {preview.invalid > 0 && <div className="alert alert-warn" style={{ margin: 16 }}>{t('importFixErrors')}</div>}
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('row')}</th><th>{t('fullNameCkb')}</th><th>{t('class')}</th><th>{t('status')}</th></tr></thead>
            <tbody>{preview.results.map((r) => (
              <tr key={r.row} className={r.ok ? (r.warnings ? 'row-conflict' : '') : 'row-fail'}>
                <td className="num">{fmtNum(r.row)}</td>
                <td>{rows[r.row - 1]?.full_name_ckb || '—'}</td>
                <td>{rows[r.row - 1]?.grade_level} {rows[r.row - 1]?.section}</td>
                <td>{r.ok ? (r.warnings ? <span className="badge badge-warn">{t('importDuplicates', { n: 1 })}</span> : <CheckCircle2 size={18} color="var(--ok)" aria-label="OK" />) : <span className="small" style={{ color: 'var(--bad)' }}><bdi dir="ltr">{r.errors.join('; ')}</bdi></span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {result && (
        <div className="card" style={{ marginBlockStart: 16 }}>
          <div className="card-head"><h2>{t('importDone', { n: fmtNum(result.created.length) })}</h2>
            <button type="button" className="btn btn-primary" onClick={() => saveBlob(csvBlob(['name', 'student_id'], result.created.map((c) => [c.full_name_ckb, c.username])), 'student-logins.csv')}><Download size={16} />{t('downloadCredentials')}</button></div>
          <div className="alert alert-info" style={{ margin: 16 }}>{t('credentialsNote')}</div>
          <div className="table-wrap"><table className="table"><thead><tr><th>{t('name')}</th><th>{t('studentId')}</th></tr></thead>
            <tbody>{result.created.map((c) => <tr key={c.id}><td>{c.full_name_ckb}</td><td><Code>{c.username}</Code></td></tr>)}</tbody></table></div>
        </div>
      )}
    </>
  );
}
