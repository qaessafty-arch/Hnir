import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useI18n } from '../i18n';

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'bad' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>
            {i.kind === 'bad' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span>{i.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Modal (focus-trapped, Esc to close) ----------
export function Modal({ title, onClose, children, footer, size = '' }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusables = () => el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (el.querySelector('[autofocus]') || focusables()[1] || el).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab') {
        const f = [...focusables()].filter((x) => !x.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={t('close')}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Confirm dialog (promise based) ----------
const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const { t } = useI18n();
  const [req, setReq] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), []);
  const close = (v) => { req?.resolve(v); setReq(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {req && (
        <Modal size="narrow" title={req.title || t('confirm')} onClose={() => close(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>{t('cancel')}</button>
            <button type="button" className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>{req.confirmText || t('confirm')}</button>
          </>}>
          <p>{req.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Form field ----------
export function Field({ label, hint, error, children, className = '', required }) {
  const id = useId();
  const child = typeof children === 'function' ? children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error || hint ? `${id}-d` : undefined }) : children;
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={id}>{label}{required && <span aria-hidden="true" style={{ color: 'var(--bad)' }}> *</span>}</label>}
      {child}
      {error ? <span id={`${id}-d`} className="error-text">{error}</span> : hint ? <span id={`${id}-d`} className="hint">{hint}</span> : null}
    </div>
  );
}

// ---------- States ----------
export function Empty({ icon: Icon = Inbox, title, hint, action }) {
  return (
    <div className="empty">
      <Icon size={40} aria-hidden="true" />
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action && <div style={{ marginBlockStart: 12 }}>{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }) {
  const { t, errorText } = useI18n();
  return (
    <div className="empty" role="alert">
      <AlertTriangle size={40} aria-hidden="true" style={{ color: 'var(--bad)' }} />
      <h3>{error?.status === 403 || error?.status === 404 ? t('forbidden') : t('error')}</h3>
      <p>{errorText(error)}</p>
      {onRetry && <button type="button" className="btn btn-secondary" style={{ marginBlockStart: 12 }} onClick={onRetry}>{t('errorRetry')}</button>}
    </div>
  );
}
export function SkeletonRows({ rows = 6, cols = 5 }) {
  return (
    <tbody aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>{Array.from({ length: cols }).map((__, j) => <td key={j}><div className="skeleton" style={{ inlineSize: `${50 + ((i * 7 + j * 13) % 45)}%` }} /></td>)}</tr>
      ))}
    </tbody>
  );
}
export function Loading() {
  const { t } = useI18n();
  return <div className="card card-pad" aria-busy="true"><span className="sr-only">{t('loading')}</span><div className="stack"><div className="skeleton" style={{ inlineSize: '40%' }} /><div className="skeleton" /><div className="skeleton" style={{ inlineSize: '70%' }} /></div></div>;
}

// ---------- Pagination ----------
export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const { t, fmtNum } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pagination" aria-label="pagination">
      <span className="muted small">{t('results', { n: fmtNum(total) })} · {t('pageOf', { page: fmtNum(page), pages: fmtNum(pages) })}</span>
      <div className="row">
        {onPageSize && (
          <label className="row small muted">{t('perPage')}
            <select className="select input-sm" style={{ inlineSize: 80 }} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('previous')}><ChevronLeft size={16} className="flip-rtl" /></button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('next')}><ChevronRight size={16} className="flip-rtl" /></button>
      </div>
    </nav>
  );
}

export function SortHeader({ label, field, sort, dir, onSort }) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => onSort(field, active && dir === 'asc' ? 'desc' : 'asc')}>{label}<Icon size={13} aria-hidden="true" /></button>
    </th>
  );
}

// ---------- Badges ----------
const GS = { draft: 'badge-neutral', submitted: 'badge-info', approved: 'badge-navy', published: 'badge-ok', returned: 'badge-warn' };
export function SheetStatus({ status }) {
  const { t } = useI18n();
  return <span className={`badge ${GS[status] || 'badge-neutral'}`}>{t(`gs_${status}`)}</span>;
}
const SS = { active: 'badge-ok', archived: 'badge-neutral', transferred: 'badge-warn', graduated: 'badge-navy', inactive: 'badge-neutral' };
export function StatusBadge({ status }) {
  const { t } = useI18n();
  return <span className={`badge ${SS[status] || 'badge-neutral'}`}>{t(`st_${status}`)}</span>;
}
const BAND = { excellent: 'badge-ok', very_good: 'badge-ok', good: 'badge-navy', pass: 'badge-gold', needs_improvement: 'badge-bad' };
export function BandBadge({ band }) {
  const { t } = useI18n();
  if (!band) return <span className="muted">—</span>;
  return <span className={`badge ${BAND[band]}`}>{t(`band_${band}`)}</span>;
}

// Pages shown inside a tabbed hub render only their actions/subtitle (the hub owns the title).
export const EmbedCtx = createContext(false);
export function PageHead({ title, sub, children }) {
  const embedded = useContext(EmbedCtx);
  if (embedded) {
    if (!children && !sub) return null;
    return <div className="page-head embedded">{sub && <p className="muted" style={{ marginInlineEnd: 'auto' }}>{sub}</p>}{children && <div className="page-actions">{children}</div>}</div>;
  }
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

/** Latin identifiers (student IDs, usernames) isolated so they render correctly inside RTL text. */
export const Code = ({ children }) => <bdi dir="ltr" className="mono">{children}</bdi>;

export function StudentAvatar({ student, size = '' }) {
  const [failed, setFailed] = useState(false);
  const name = student?.full_name_ckb || student?.full_name_en || '?';
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {student?.has_photo && !failed
        ? <img src={`/api/students/${student.id}/photo`} alt="" loading="lazy" onError={() => setFailed(true)} />
        : name.trim().charAt(0)}
    </span>
  );
}

export function Progress({ value, tone }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tn = tone || (v >= 90 ? 'ok' : v >= 50 ? 'warn' : 'bad');
  return <div className={`progress ${tn}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}><span style={{ inlineSize: `${v}%` }} /></div>;
}
