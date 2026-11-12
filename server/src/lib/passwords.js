'use strict';
const argon2 = require('argon2');

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const hashPassword = (pw) => argon2.hash(pw, OPTS);
async function verifyPassword(hash, pw) {
  try { return await argon2.verify(hash, pw); } catch { return false; }
}
// Pre-computed hash used to equalise timing when the username does not exist.
let dummyHash;
async function dummyVerify(pw) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, pw);
  return false;
}

/** Returns an error code or null. */
function passwordPolicyError(pw, { username } = {}) {
  if (typeof pw !== 'string' || pw.length < 10) return 'password_too_short';
  if (pw.length > 128) return 'password_too_long';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'password_needs_letters_and_digits';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'password_contains_username';
  const common = ['password1234', 'admin12345', '1234567890', 'qwerty12345', 'darwaza2019', 'darwaza123'];
  if (common.includes(pw.toLowerCase())) return 'password_too_common';
  return null;
}

module.exports = { hashPassword, verifyPassword, dummyVerify, passwordPolicyError };
