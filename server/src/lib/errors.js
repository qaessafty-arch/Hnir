'use strict';
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const badRequest = (code, msg, details) => new AppError(400, code, msg, details);
const unauthorized = (code = 'unauthenticated', msg) => new AppError(401, code, msg);
const forbidden = (code = 'forbidden', msg) => new AppError(403, code, msg);
const notFound = (code = 'not_found', msg) => new AppError(404, code, msg);
const conflict = (code, msg, details) => new AppError(409, code, msg, details);

/** Wrap async route handlers so rejections reach the error middleware. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, ah };
