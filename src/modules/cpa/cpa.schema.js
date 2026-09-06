import { z } from "zod";
import { paginationSchema } from "../../common/validate.js";

const cpaNotePriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const cpaNoteStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "ARCHIVED"];

export const cpaOverviewQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    mode: z.enum(["year", "month"]).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "month" && val.month == null && val.from == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "month is required when mode is month",
        path: ["month"],
      });
    }
  });

export const listNotesQuerySchema = paginationSchema.extend({
  status: z.enum(cpaNoteStatuses).optional(),
  priority: z.enum(cpaNotePriorities).optional(),
  category: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
});

export const createNoteSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().min(1, "Note text is required").max(5000),
  category: z.string().trim().max(80).optional(),
  priority: z.enum(cpaNotePriorities).optional(),
  vehicleId: z.string().uuid().optional().nullable(),
  stockNumber: z.string().max(50).optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
});

export const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(5000).optional(),
    category: z.string().trim().max(80).optional(),
    priority: z.enum(cpaNotePriorities).optional(),
    status: z.enum(cpaNoteStatuses).optional(),
    vehicleId: z.string().uuid().optional().nullable(),
    stockNumber: z.string().max(50).optional().nullable(),
    assignedToId: z.string().uuid().optional().nullable(),
    isArchived: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const addCommentSchema = z.object({
  comment: z.string().trim().min(1, "Comment is required").max(2000),
});

export const addAttachmentSchema = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().min(1),
  fileSize: z.coerce.number().int().positive().optional(),
  mimeType: z.string().optional(),
});

export const noteIdParamSchema = z.object({
  id: z.string().uuid(),
});
