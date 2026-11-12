'use strict';
const { hashPassword } = require('./passwords');
const crypto = require('crypto');
const { generatePassword, loginCodeHash } = require('./crypto');

/**
 * A random 4-digit number (1000–9999) not used by any student ID or staff sign-in code.
 * Students and staff share one 4-digit space so typing "4821" can never match two accounts.
 */
async function freeFourDigits(c) {
  for (let i = 0; i < 200; i++) {
    const d = String(crypto.randomInt(1000, 10000));
    const r = await c.query(
      `SELECT 1 FROM students WHERE student_no = $1 UNION ALL SELECT 1 FROM users WHERE login_code_hash = $2 OR username = $1 LIMIT 1`,
      [`DAR-${d}`, loginCodeHash(d)]);
    if (!r.rowCount) return d;
  }
  throw Object.assign(new Error('no free 4-digit number left'), { status: 409, code: 'no_free_number' });
}

/** Issue a new staff sign-in code, DAR + 4 random digits (replaces any previous one). Only a keyed hash of the digits is stored. */
async function issueLoginCode(c, userId) {
  const digits = await freeFourDigits(c);
  await c.query('UPDATE users SET login_code_hash = $2, login_code_set_at = now(), updated_at = now() WHERE id = $1', [userId, loginCodeHash(digits)]);
  return `DAR-${digits}`;
}

/**
 * Create a login account inside a transaction. Returns { userId, loginCode }.
 * Sign-in is by code only: students use their student ID (loginCode null); staff get a secret sign-in code.
 * password_hash is kept as an unusable random value because the column predates code sign-in.
 */
async function createAccount(c, { username, fullName, email = null, roles }) {
  const hash = await hashPassword(generatePassword(24));
  const u = await c.query(
    `INSERT INTO users (username, email, full_name, password_hash, must_change_password)
     VALUES ($1,$2,$3,$4,false) RETURNING id`, [username, email, fullName, hash]);
  const userId = u.rows[0].id;
  await c.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = ANY($2::text[])`, [userId, roles]);
  const isStudentOnly = roles.length > 0 && roles.every((r) => r === 'student');
  const loginCode = isStudentOnly ? null : await issueLoginCode(c, userId);
  return { userId, loginCode };
}

/** New student ID: DAR + 4 random digits, unique across students and staff codes. */
async function nextStudentNo(c) {
  return `DAR-${await freeFourDigits(c)}`;
}
async function nextStaffNo(c) {
  const r = await c.query(`SELECT 'STF-' || lpad(nextval('staff_no_seq')::text, 4, '0') AS no`);
  return r.rows[0].no;
}

module.exports = { createAccount, issueLoginCode, freeFourDigits, nextStudentNo, nextStaffNo };
