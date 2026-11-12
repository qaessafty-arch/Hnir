'use strict';
const config = require('./lib/config');
const logger = require('./lib/logger');
const db = require('./lib/db');
const { createApp } = require('./app');
const { migrate } = require('./migrate');

async function main() {
  if (process.env.MIGRATE_ON_START !== 'false') await migrate();
  const app = createApp();
  const server = app.listen(config.port, () => logger.info({ port: config.port, env: config.env }, 'Darwaza SMS listening'));
  server.keepAliveTimeout = 65_000;
  // Purge expired sessions every 30 minutes.
  const purge = setInterval(() => db.query('DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - interval \'1 day\'').catch(() => {}), 30 * 60_000);
  const shutdown = (sig) => {
    logger.info({ sig }, 'shutting down');
    clearInterval(purge);
    server.close(() => db.pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
// Optional multi-core mode: WEB_CONCURRENCY=<n> forks n workers sharing the port.
// Note: the login rate limiter is per process; the per-account lockout is stored in PostgreSQL and is global.
const cluster = require('cluster');
const workers = Number(process.env.WEB_CONCURRENCY || 1);
if (workers > 1 && cluster.isPrimary) {
  migrate().then(() => {
    for (let i = 0; i < workers; i++) cluster.fork({ MIGRATE_ON_START: 'false' });
    cluster.on('exit', (w, code) => { logger.error({ pid: w.process.pid, code }, 'worker exited; restarting'); cluster.fork({ MIGRATE_ON_START: 'false' }); });
  }).catch((err) => { logger.fatal({ err }, 'migration failed'); process.exit(1); });
} else {
  main().catch((err) => { logger.fatal({ err }, 'failed to start'); process.exit(1); });
}
