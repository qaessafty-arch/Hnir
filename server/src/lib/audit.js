'use strict';
const db = require('./db');
const logger = require('./logger');

/** Append an audit record. Pass a transaction client to make it atomic with the change. */
async function audit(reqOrNull, action, { entityType, entityId, details, client, actorId } = {}) {
  const actor = actorId ?? reqOrNull?.user?.id ?? null;
  const ip = reqOrNull?.ip ?? null;
  const q = client || db;
  try {
    await q.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [actor, action, entityType || null, entityId != null ? String(entityId) : null, details || {}, ip],
    );
  } catch (err) {
    if (client) throw err; // inside a transaction the whole change must fail
    logger.error({ err, action }, 'failed to write audit log');
  }
}
module.exports = { audit };
