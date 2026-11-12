import { useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { EmbedCtx, PageHead } from './ui';

/** A page with tabs. Each tab: { key, label, perms?, render: () => JSX }. Hidden tabs are those the user may not use. */
export default function Hub({ title, sub, help, tabs }) {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const visible = tabs.filter((x) => !x.perms || can(...x.perms));
  const active = visible.find((x) => x.key === sp.get('tab')) || visible[0];
  if (!active) return null;
  return (
    <>
      <PageHead title={title} sub={sub} />
      {help && <div className="help no-print"><Info size={18} aria-hidden="true" style={{ flexShrink: 0, marginBlockStart: 1 }} /><span>{help}</span></div>}
      {visible.length > 1 && (
        <div className="tabs no-print" role="tablist" aria-label={title}>
          {visible.map((x) => (
            <button key={x.key} type="button" role="tab" className="tab" aria-selected={x.key === active.key}
              onClick={() => setSp({ tab: x.key }, { replace: true })}>{x.label}</button>
          ))}
        </div>
      )}
      <EmbedCtx.Provider value>
        <div role="tabpanel" aria-label={active.label}>{active.render()}</div>
      </EmbedCtx.Provider>
    </>
  );
}
