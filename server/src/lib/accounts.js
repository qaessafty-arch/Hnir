'use strict';
const { hashPassword } = require('./passwords');
const { generatePassword } = require('./crypto');

/** Create a login account inside a transaction. Returns { userId, initialPassword }. */
async function createAccount(c, { username, fullName, email = null, roles, password, mustChange = true }) {
  const initialPassword = password || generatePassword(10);
  const hash = await hashPassword(initialPassword);
  const u = await c.query(
    `INSERT INTO users (username, email, full_name, password_hash, must_change_password)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [username, email, fullName, hash, mustChange]);
  const userId = u.rows[0].id;
  await c.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = ANY($2::text[])`, [userId, roles]);
  return { userId, initialPassword };
}

async function nextStudentNo(c) {
  const r = await c.query(`SELECT 'DPS-' || to_char(now(),'YYYY') || '-' || lpad(nextval('student_no_seq')::text, 4, '0') AS no`);
  return r.rows[0].no;
}
async function nextStaffNo(c) {
  const r = await c.query(`SELECT 'STF-' || lpad(nextval('staff_no_seq')::text, 4, '0') AS no`);
  return r.rows[0].no;
}

module.exports = { createAccount, nextStudentNo, nextStaffNo };
