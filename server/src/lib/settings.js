'use strict';
const db = require('./db');

let cache = null;
let cacheAt = 0;
const TTL = 10_000;

async function getSettings() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const { rows } = await db.query('SELECT key, value FROM system_settings');
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cacheAt = Date.now();
  return cache;
}
function invalidateSettings() { cache = null; }
module.exports = { getSettings, invalidateSettings };
