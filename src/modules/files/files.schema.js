import { z } from "zod";

export const createUploadUrlSchema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  fileSize: z.coerce.number().int().positive(),
  sourceEntity: z.string().max(80).optional().nullable(),
  sourceEntityId: z.string().uuid().optional().nullable(),
});

export const listFilesQuerySchema = z.object({
  sourceEntity: z.string().max(80).optional(),
  sourceEntityId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

export const fileIdParamSchema = z.object({
  id: z.string().uuid(),
});
