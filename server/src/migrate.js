'use strict';
/** Minimal forward-only SQL migration runner. Each file runs in its own transaction, guarded by an advisory lock. */
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const logger = require('./lib/logger');

const DIR = path.resolve(__dirname, '../migrations');

async function migrate() {
  const client = await db.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(728390)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        logger.info({ migration: f }, 'applied migration');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(728390)').catch(() => {});
    client.release();
  }
}

module.exports = { migrate };
if (require.main === module) {
  migrate().then(() => db.pool.end()).catch((err) => { console.error(err.message); process.exit(1); });
}
