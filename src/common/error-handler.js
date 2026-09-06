import { AppError } from "./errors.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export function errorHandler(err, req, res, _next) {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: { code: "INVALID_JSON", message: "Invalid JSON body" },
    });
  }

  if (err?.name === "ZodError") {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.errors,
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  if (err?.code === "P2002") {
    return res.status(409).json({
      error: {
        code: "UNIQUE_CONSTRAINT",
        message: "A record with this value already exists",
        details: err.meta,
      },
    });
  }

  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({
      error: { code: "CORS", message: "Origin not allowed" },
    });
  }

  logger.error({ err, path: req.path }, "Unhandled error");
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      details: env.NODE_ENV === "development" ? err.message : undefined,
    },
  });
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
