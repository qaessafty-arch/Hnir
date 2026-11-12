'use strict';
const { z } = require('zod');
const { badRequest } = require('./errors');

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest('validation_failed', 'Invalid input',
      r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })));
  }
  return r.data;
}

const id = z.coerce.number().int().positive();
const text = (max = 200) => z.string().trim().min(1).max(max);
const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const page = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

module.exports = { z, parse, id, text, optText, date, page };
