'use strict';
const pino = require('pino');
const config = require('./config');

module.exports = pino({
  level: config.logLevel,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]', '*.password', '*.newPassword', '*.currentPassword', '*.code'],
    censor: '[redacted]',
  },
});
