import { useI18n } from '../i18n';

/**
 * Horizontal bar chart (single series, so no legend; the card title names it).
 * Bars below their pass mark switch to the reserved "critical" status colour AND get a text label,
 * so state is never shown by colour alone. Values are direct-labelled; a thin tick marks the pass line.
 */
export function HBarChart({ items, max = 100, unit = '%', emptyText, onSelect }) {
  const { t, fmtNum } = useI18n();
  if (!items.length) return <p className="muted small">{emptyText || '—'}</p>;
  return (
    <ul className="hbar" role="list">
      {items.map((it) => {
        const v = it.value ?? 0;
        const below = it.passMark != null && it.value != null && it.value < it.passMark;
        const label = `${it.label}: ${it.value == null ? '—' : fmtNum(it.value) + unit}${below ? ` (${t('belowPass')})` : ''}${it.note ? ` · ${it.note}` : ''}`;
        const Row = onSelect ? 'button' : 'div';
        return (
          <li key={it.key ?? it.label}>
            <Row type={onSelect ? 'button' : undefined} className={`hbar-row ${onSelect ? 'clickable' : ''}`} title={label} aria-label={label}
              onClick={onSelect ? () => onSelect(it) : undefined}>
              <span className="hbar-label">{it.label}</span>
              <span className="hbar-track" aria-hidden="true">
                <span className={`hbar-fill ${below ? 'bad' : ''}`} style={{ inlineSize: `${Math.max(0, Math.min(100, (v / max) * 100))}%` }} />
                {it.passMark != null && <span className="hbar-tick" style={{ insetInlineStart: `${(it.passMark / max) * 100}%` }} />}
              </span>
              <span className="hbar-value num">
                {it.value == null ? '—' : `${fmtNum(it.value)}${unit}`}
                {below && <span className="hbar-flag">{t('belowPass')}</span>}
                {it.note && <span className="hbar-note">{it.note}</span>}
              </span>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

/** One headline number with a plain-language caption. */
export function Kpi({ icon: Icon, label, value, caption, tone = '' }) {
  return (
    <div className="card stat kpi">
      {Icon && <div className={`stat-icon ${tone}`}><Icon size={22} aria-hidden="true" /></div>}
      <div style={{ minInlineSize: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value num">{value}</div>
        {caption && <div className="kpi-caption">{caption}</div>}
      </div>
    </div>
  );
}
