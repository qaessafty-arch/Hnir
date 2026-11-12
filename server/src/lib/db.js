'use strict';
const { Pool, types } = require('pg');
const config = require('./config');
const logger = require('./logger');

// Return NUMERIC as JS numbers (scores are numeric(6,2) — safe in double precision).
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Return DATE as plain 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);
// int8 (bigserial ids/counts) fit comfortably in JS numbers for this scale.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
  application_name: 'darwaza-sms',
});
pool.on('error', (err) => logger.error({ err }, 'idle pg client error'));

async function query(text, params) {
  return pool.query(text, params);
}

/** Run fn(client) inside a transaction. Rolls back on any thrown error. */
async function tx(fn, { isolation } = {}) {
  const client = await pool.connect();
  try {
    await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
