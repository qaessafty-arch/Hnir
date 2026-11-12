import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { strings } from './strings';

const I18nCtx = createContext(null);
const CKB_MONTHS = ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەممووز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'];
const KEY = 'dps_lang';

function readLang() {
  try { const v = localStorage.getItem(KEY); if (v === 'en' || v === 'ckb') return v; } catch { /* storage unavailable */ }
  return 'ckb';
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ckb' ? 'rtl' : 'ltr';
    document.title = `${strings[lang].school} | ${strings[lang].appName}`;
  }, [lang]);
  const setLang = useCallback((l) => { setLangState(l); try { localStorage.setItem(KEY, l); } catch { /* ignore */ } }, []);
  const value = useMemo(() => {
    const dict = strings[lang];
    const locale = 'en-GB'; // number formatting: Latin digits in both languages (see note below)
    const t = (key, vars) => {
      let s = dict[key] ?? strings.en[key] ?? key;
      if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
      return s;
    };
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const fmtNum = (n) => (n === null || n === undefined || n === '' ? '—' : nf.format(Number(n)));
    const fmtPct = (n) => (n === null || n === undefined ? '—' : `${nf.format(Number(n))}%`);
    // Browsers ship no Central Kurdish date data (they silently fall back to English), so Kurdish
    // month names are formatted explicitly. Digits stay Latin, consistent with IDs and scores.
    const toDate = (d) => new Date(typeof d === 'string' && d.length === 10 ? `${d}T00:00:00` : d);
    const pad = (n) => String(n).padStart(2, '0');
    const fmtDate = (d) => {
      if (!d) return '—';
      const x = toDate(d);
      return lang === 'ckb' ? `${x.getDate()}ی ${CKB_MONTHS[x.getMonth()]} ${x.getFullYear()}`
        : x.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    };
    const fmtDateTime = (d) => (d ? `${fmtDate(d)}، ${pad(toDate(d).getHours())}:${pad(toDate(d).getMinutes())}`.replace('،', lang === 'ckb' ? '،' : ',') : '—');
    /** Pick the localized field of a bilingual record (name_en / name_ckb). */
    const pick = (obj, base = 'name') => (obj ? (lang === 'ckb' ? obj[`${base}_ckb`] || obj[`${base}_en`] : obj[`${base}_en`] || obj[`${base}_ckb`]) : '');
    const errorText = (err) => {
      const code = err?.code || 'internal_error';
      return dict[`e_${code}`] || strings.en[`e_${code}`] || err?.message || dict.error;
    };
    return { lang, setLang, t, fmtNum, fmtPct, fmtDate, fmtDateTime, pick, errorText, dir: lang === 'ckb' ? 'rtl' : 'ltr' };
  }, [lang, setLang]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
