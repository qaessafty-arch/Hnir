'use strict';
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const { randomToken } = require('./crypto');

/** Detect image type from magic bytes. The browser-supplied MIME type is never trusted. */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

async function storeImage(buf, kind) {
  const t = sniffImage(buf);
  if (!t) return null;
  const dir = path.join(config.uploadDir, kind);
  await fs.mkdir(dir, { recursive: true });
  const name = `${randomToken(18)}.${t.ext}`; // random name: no user-controlled path components
  await fs.writeFile(path.join(dir, name), buf, { mode: 0o640 });
  return `${kind}/${name}`;
}

function resolveStored(rel) {
  if (!/^[a-z]+\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(rel || '')) return null;
  return path.join(config.uploadDir, rel);
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

module.exports = { sniffImage, storeImage, resolveStored, MIME };
