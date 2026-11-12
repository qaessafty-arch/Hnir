'use strict';
// Vercel serverless entry point: the same Express app as the self-hosted server.
// Migrations and the (test-only) demo seed run during the Vercel build, not here.
const { createApp } = require('../server/src/app');

module.exports = createApp();
