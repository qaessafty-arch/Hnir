'use strict';
const { hashPassword } = require('./passwords');
const { generatePassword, generateLoginCode, normalizeLoginCode, sha256 } = require('./crypto');

/** Issue a new staff sign-in code (replaces any previous one). Returns the code; only its hash is stored. */
async function issueLoginCode(c, userId) {
  for (let i = 0; i < 5; i++) {
    const code = generateLoginCode();
    const r = await c.query(
      `UPDATE users SET login_code_hash = $2, login_code_set_at = now(), updated_at = now() WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM users WHERE login_code_hash = $2)`, [userId, sha256(normalizeLoginCode(code))]);
    if (r.rowCount) return code;
  }
  throw new Error('could not issue a unique sign-in code');
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

async function nextStudentNo(c) {
  const r = await c.query(`SELECT 'DAR-' || lpad(nextval('student_no_seq')::text, 4, '0') AS no`);
  return r.rows[0].no;
}
async function nextStaffNo(c) {
  const r = await c.query(`SELECT 'STF-' || lpad(nextval('staff_no_seq')::text, 4, '0') AS no`);
  return r.rows[0].no;
}

module.exports = { createAccount, issueLoginCode, nextStudentNo, nextStaffNo };
