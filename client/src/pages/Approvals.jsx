import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Globe2, Eye } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Empty, ErrorState, PageHead, SheetStatus, SkeletonRows, useToast } from '../components/ui';
import { Info } from 'lucide-react';
import { sectionLabel } from './Students';

/** Inbox of grade sheets waiting for the principal, with one-click (or bulk) approve & publish. */
export default function ApprovalsPage() {
  const { t, fmtNum, fmtPct, fmtDateTime, pick, errorText } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const waiting = useApi('/assessments', { status: 'submitted', pageSize: 100 });
  const approved = useApi('/assessments', { status: 'approved', pageSize: 100 }, { skip: !can('grades.publish') });
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const rows = [...(waiting.data?.items || []), ...(approved.data?.items || [])];
  const reload = () => { waiting.reload(); approved.reload(); setSel(new Set()); };
  const run = async (ids, publish = true) => {
    setBusy(true);
    try {
      const r = await api('/assessments/bulk-approve', { method: 'POST', body: { ids, publish } });
      if (r.done.length) toast(t('approvedPublished', { n: fmtNum(r.done.length) }));
      if (r.skipped.length) toast(t('someSkipped', { n: fmtNum(r.skipped.length) }), 'bad');
    } catch (ex) { toast(errorText(ex), 'bad'); }
    finally { setBusy(false); reload(); }
  };
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const loading = (waiting.loading && !waiting.data);
  return (
    <>
      <PageHead title={t('approvalsTitle')}>
        {can('grades.publish') && <button type="button" className="btn btn-gold" disabled={busy || sel.size === 0} onClick={() => run([...sel], true)}><Globe2 size={16} />{t('approvePublishSelected', { n: fmtNum(sel.size) })}</button>}
      </PageHead>
      <div className="help"><Info size={18} aria-hidden="true" style={{ flexShrink: 0, marginBlockStart: 1 }} /><span>{t('approvalsHelp')}</span></div>
      <div className="card">
        {waiting.error ? <ErrorState error={waiting.error} onRetry={reload} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th style={{ inlineSize: 36 }}><input type="checkbox" aria-label={t('selectAll')} checked={rows.length > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              <th>{t('assessment')}</th><th>{t('class')}</th><th>{t('submittedBy')}</th><th>{t('classAverage')}</th><th>{t('belowPassCount')}</th><th>{t('status')}</th><th><span className="sr-only">{t('actions')}</span></th>
            </tr></thead>
            {loading ? <SkeletonRows cols={8} /> : (
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8}><Empty icon={CheckCircle2} title={t('noApprovals')} /></td></tr>}
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td><input type="checkbox" aria-label={a.title} checked={sel.has(a.id)} onChange={() => toggle(a.id)} /></td>
                    <td><strong>{a.title}</strong><div className="muted small">{pick(a, 'subject_name')} · {pick(a, 'term_name')} · {fmtDateTime(a.updated_at)}</div></td>
                    <td className="nowrap">{sectionLabel(t, fmtNum, a)}</td>
                    <td>{a.submitted_by || '—'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtPct(a.avg_percent)}</td>
                    <td className="num">{a.below_pass > 0 ? <span className="badge badge-bad">{fmtNum(a.below_pass)} / {fmtNum(a.entered_count)}</span> : <span className="badge badge-ok">0</span>}</td>
                    <td><SheetStatus status={a.status} /></td>
                    <td><div className="actions">
                      <Link className="btn btn-ghost btn-sm" to={`/grades/sheet/${a.id}`}><Eye size={15} />{t('review')}</Link>
                      {can('grades.publish')
                        ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run([a.id], true)}><Globe2 size={15} />{t('approvePublish')}</button>
                        : a.status === 'submitted' && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run([a.id], false)}><CheckCircle2 size={15} />{t('approveOnly')}</button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table></div>
        )}
      </div>
    </>
  );
}
