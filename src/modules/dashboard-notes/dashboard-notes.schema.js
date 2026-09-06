import { z } from "zod";

export const createNoteSchema = z.object({
  text: z.string().min(1).max(500),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateNoteSchema = z
  .object({
    text: z.string().min(1).max(500).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
  });

export const noteIdParamSchema = z.object({
  id: z.string().uuid(),
});
