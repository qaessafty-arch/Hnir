'use strict';
const crypto = require('crypto');
const config = require('./config');

const key = crypto.createHash('sha256').update(config.encryptionKey).digest();

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}
function decrypt(payload) {
  const [v, iv, tag, data] = String(payload).split('.');
  if (v !== 'v1') throw new Error('unknown ciphertext version');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
/** Human-friendly one-time password: no ambiguous characters (0/O, 1/l/I). */
function generatePassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

module.exports = { randomToken, sha256, encrypt, decrypt, safeEqual, generatePassword };
