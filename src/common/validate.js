import { z } from "zod";
import { validationError } from "./errors.js";

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(validationError("Validation failed", result.error.flatten()));
    }
    req.body = result.data;
    return next();
  };
}

export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(validationError("Invalid query", result.error.flatten()));
    }
    req.query = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(validationError("Invalid params", result.error.flatten()));
    }
    req.params = result.data;
    return next();
  };
}

export const uuidParam = z.object({ id: z.string().uuid() });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional(),
});

export function pageMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
