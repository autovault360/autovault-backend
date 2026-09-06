export class AppError extends Error {
  constructor(message, statusCode = 400, code = "APP_ERROR", details = undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message = "Resource not found") {
  return new AppError(message, 404, "NOT_FOUND");
}

export function unauthorized(message = "Unauthorized") {
  return new AppError(message, 401, "UNAUTHORIZED");
}

export function forbidden(message = "Forbidden") {
  return new AppError(message, 403, "FORBIDDEN");
}

export function conflict(message = "Conflict", details = undefined) {
  return new AppError(message, 409, "CONFLICT", details);
}

export function tooManyRequests(message = "Too many requests", details) {
  return new AppError(message, 429, "TOO_MANY_REQUESTS", details);
}

export function validationError(message = "Validation failed", details) {
  return new AppError(message, 400, "VALIDATION_ERROR", details);
}
