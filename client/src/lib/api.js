// Thin fetch wrapper. Session = HttpOnly cookie (never readable by JS); CSRF token kept in memory only.
let csrfToken = null;
let onUnauthorized = null;
export const setCsrf = (t) => { csrfToken = t; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error?.code || (status === 0 ? 'network' : 'internal_error');
    this.details = body?.error?.details;
  }
}

/** Convert Eastern Arabic / Persian digits to ASCII so numeric input works in Kurdish keyboards. */
export function normalizeDigits(s) {
  return String(s ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/٫/g, '.');
}

function qs(params) {
  if (!params) return '';
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.set(k, v); });
  const s = u.toString();
  return s ? `?${s}` : '';
}

export async function api(path, { method = 'GET', body, params, form } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`/api${path}${qs(params)}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, null);
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized(); // session ended mid-use
    throw err;
  }
  return data;
}

/** Download a server-generated file (CSV) through the authenticated session. */
export async function download(path, params, filename) {
  const res = await fetch(`/api${path}${qs(params)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build a CSV in the browser (e.g. credentials list) with formula-injection protection. */
export function csvBlob(headers, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob(['﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Downscale an image in the browser before upload (max 512px, JPEG). */
export function resizeImage(file, max = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('resize failed'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ApiError(400, { error: { code: 'unsupported_image' } })); };
    img.src = url;
  });
}

/** Wrap Latin/numeric runs (e.g. "2026-2027") in Unicode isolates so they don't reorder inside RTL text. */
export const ltr = (s) => (s === null || s === undefined ? '' : `\u2066${s}\u2069`);
