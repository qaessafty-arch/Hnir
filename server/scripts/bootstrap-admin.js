'use strict';
/**
 * Create the first Super Administrator account.
 *   node scripts/bootstrap-admin.js <username> "<Full Name>"
 * Prints the administrator's secret sign-in code (shown once). MFA enrolment is required at first sign-in.
 */
const db = require('../src/lib/db');
const { migrate } = require('../src/migrate');
const { createAccount } = require('../src/lib/accounts');

(async () => {
  const [username, fullName] = process.argv.slice(2);
  if (!username || !fullName) { console.error('usage: node scripts/bootstrap-admin.js <username> "<Full Name>"'); process.exit(2); }
  await migrate();
  const existing = await db.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'super_admin'`);
  if (existing.rowCount && !process.argv.includes('--force')) {
    console.error('A super administrator already exists. Use --force to create another.'); process.exit(1);
  }
  const out = await db.tx(async (c) => {
    const a = await createAccount(c, { username, fullName, roles: ['super_admin'] });
    await c.query(`INSERT INTO audit_logs (action, entity_type, entity_id, details) VALUES ('user.bootstrap_admin','user',$1,$2)`, [String(a.userId), { username }]);
    return a;
  });
  console.log(`\nSuper administrator created.\n  username: ${username}\n  sign-in code: ${out.loginCode}\n\nKeep the code secret; it is shown only once. MFA enrolment will be required at first sign-in.\n`);
  await db.pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
