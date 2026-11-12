import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetch data with loading / error state; re-runs when deps change. */
export function useApi(path, params, { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, error: null });
  const key = JSON.stringify([path, params]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (skip || !path) { setState({ data: null, loading: false, error: null }); return; }
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path, { params });
      if (n === seq.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (n === seq.current) setState({ data: null, loading: false, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, skip]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Academic years with the current one resolved. */
export function useYears() {
  const r = useApi('/academic/years');
  const years = r.data?.items || [];
  return { years, current: years.find((y) => y.is_current) || years[0] || null, loading: r.loading, error: r.error };
}
