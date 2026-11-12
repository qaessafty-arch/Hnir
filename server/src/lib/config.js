'use strict';
require('dotenv').config({ path: process.env.DOTENV_PATH || undefined, quiet: true });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production' || env === 'staging';

function required(name, fallbackForDev) {
  const v = process.env[name];
  if (v) return v;
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

const encKey = required('APP_ENCRYPTION_KEY', 'dev-only-insecure-key-change-me-0123456789abcdef');
if (isProd && encKey.length < 32) throw new Error('APP_ENCRYPTION_KEY must be at least 32 characters');

module.exports = {
  env,
  isProd,
  isTest: env === 'test',
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL', 'postgres://darwaza:devpass@localhost:5432/darwaza_dev'),
  dbPoolMax: Number(process.env.DB_POOL_MAX || 20),
  encryptionKey: encKey,
  uploadDir: process.env.UPLOAD_DIR || require('path').resolve(__dirname, '../../data/uploads'),
  trustProxy: process.env.TRUST_PROXY || (isProd ? '1' : 'loopback'),
  publicOrigin: process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || null, // e.g. https://grades.darwaza.school (Render sets RENDER_EXTERNAL_URL)
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  logLevel: process.env.LOG_LEVEL || (env === 'test' ? 'silent' : 'info'),
  clientDist: process.env.CLIENT_DIST || require('path').resolve(__dirname, '../../../client/dist'),
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT || 300), // per IP per 15 min
};
