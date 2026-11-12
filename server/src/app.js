'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./lib/config');
const logger = require('./lib/logger');
const db = require('./lib/db');
const { AppError } = require('./lib/errors');
const { loadSession, requireAuth, csrfProtection } = require('./middleware/auth');

function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy === 'loopback' ? 'loopback' : Number(config.trustProxy) || config.trustProxy);
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => { const rid = crypto.randomUUID(); res.setHeader('X-Request-Id', rid); return rid; },
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    customProps: (req) => ({ userId: req.user?.id }),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url.split('?')[0], ip: r.remoteAddress }) },
  }));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
        frameAncestors: ["'none'"], upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  }));
  app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next(); });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try { await db.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(loadSession);
  api.use(csrfProtection);
  api.use('/auth', require('./routes/auth'));
  api.use(requireAuth);
  api.use('/academic', require('./routes/academic'));
  api.use('/students', require('./routes/students'));
  api.use('/teachers', require('./routes/teachers'));
  api.use('/users', require('./routes/users'));
  api.use('/assessments', require('./routes/assessments'));
  api.use('/reports', require('./routes/reports'));
  api.use('/', require('./routes/misc'));
  api.use((_req, _res, next) => next(new AppError(404, 'not_found')));
  app.use('/api', api);

  // Static client (production build). Hashed assets are immutable; index.html is never cached.
  if (fs.existsSync(config.clientDist)) {
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  // Error handler: never leak stack traces or SQL to the client.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new AppError(400, 'invalid_json');
    if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') err = new AppError(413, 'payload_too_large');
    if (err.name === 'MulterError') err = new AppError(400, 'upload_error');
    if (err.code === '55P03') err = new AppError(409, 'sheet_busy', 'Someone else is saving this sheet right now. Try again.');
    if (/timeout exceeded when trying to connect/.test(err.message || '')) {
      res.set('Retry-After', '2');
      err = new AppError(503, 'server_busy', 'The server is busy. Please retry.');
    }
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal_error', requestId: req.id } });
  });
  return app;
}

module.exports = { createApp };
