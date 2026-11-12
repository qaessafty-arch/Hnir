'use strict';
/**
 * Issue a new secret sign-in code for a staff account (e.g. the first administrator, or after the code is lost).
 *   node scripts/issue-login-code.js <username>
 * Prints the code once; only its hash is stored. The previous code stops working and the user's sessions end.
 */
const db = require('../src/lib/db');
const { migrate } = require('../src/migrate');
const { issueLoginCode } = require('../src/lib/accounts');

(async () => {
  const [username] = process.argv.slice(2);
  if (!username) { console.error('usage: node scripts/issue-login-code.js <username>'); process.exit(2); }
  await migrate();
  const code = await db.tx(async (c) => {
    const u = await c.query('SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL', [username]);
    if (!u.rowCount) throw new Error(`No account named ${username}`);
    const out = await issueLoginCode(c, u.rows[0].id);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [u.rows[0].id]);
    await c.query(`INSERT INTO audit_logs (action, entity_type, entity_id, details) VALUES ('user.login_code_issued_cli','user',$1,$2)`, [String(u.rows[0].id), { username }]);
    return out;
  });
  console.log(`\nSign-in code for ${username}: ${code}\nKeep it secret. It is shown only once.\n`);
  await db.pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
