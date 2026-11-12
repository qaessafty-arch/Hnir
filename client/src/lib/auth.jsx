import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setCsrf, setUnauthorizedHandler } from './api';
import { useI18n } from '../i18n';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, mfaState: null, expired: false });
  const { setLang } = useI18n();

  const refresh = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      setCsrf(me.csrfToken);
      setState({ loading: false, user: me.user, mfaState: me.mfaState, expired: false });
      return me;
    } catch {
      setCsrf(null);
      setState((s) => ({ loading: false, user: null, mfaState: null, expired: s.expired }));
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => { setCsrf(null); setState({ loading: false, user: null, mfaState: null, expired: true }); });
  }, [refresh]);

  const value = useMemo(() => ({
    ...state,
    can: (...perms) => !!state.user && perms.some((p) => state.user.permissions.includes(p)),
    hasRole: (r) => !!state.user?.roles.includes(r),
    refresh,
    async login(code) {
      const r = await api('/auth/login', { method: 'POST', body: { code } });
      const me = await refresh();
      if (me?.user?.preferred_lang) setLang(me.user.preferred_lang);
      return r;
    },
    async logout() {
      try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
      setCsrf(null);
      setState({ loading: false, user: null, mfaState: null, expired: false });
    },
  }), [state, refresh, setLang]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
