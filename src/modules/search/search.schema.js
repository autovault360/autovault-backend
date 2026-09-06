import { z } from "zod";

export const globalSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Query is required")
    .max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
