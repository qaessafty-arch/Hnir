'use strict';
/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s step) — compatible with Google/Microsoft Authenticator.
 * Implemented on node:crypto only (no third-party code in the authentication path).
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP value for a counter (RFC 4226). */
function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const STEP = 30;
const generateSecret = () => base32Encode(crypto.randomBytes(20)); // 160-bit secret
const generate = (secret, now = Date.now()) => hotp(base32Decode(secret), Math.floor(now / 1000 / STEP));

/** Accepts the current code and one step either side (clock drift). Constant-time comparison. */
function verify(secret, token, now = Date.now(), window = 1) {
  if (!/^\d{6}$/.test(String(token))) return false;
  const key = base32Decode(secret);
  const t = Math.floor(now / 1000 / STEP);
  let ok = false;
  for (let i = -window; i <= window; i++) {
    const cand = Buffer.from(hotp(key, t + i));
    if (crypto.timingSafeEqual(cand, Buffer.from(String(token)))) ok = true;
  }
  return ok;
}

function keyUri({ issuer, label, secret }) {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

module.exports = { generateSecret, generate, verify, keyUri, hotp, base32Encode, base32Decode };
