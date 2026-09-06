import { z } from "zod";

export const updateTaxSettingsSchema = z
  .object({
    state: z.string().max(2).optional().nullable(),
    filingFrequency: z
      .enum(["monthly", "quarterly", "annual", "custom"])
      .optional(),
    reminderDays: z.coerce.number().int().min(1).max(90).optional(),
    nextDueDate: z.coerce.date().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const createTaxPeriodSchema = z.object({
  name: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  status: z.enum(["open", "due", "paid", "filed", "closed"]).default("open"),
});

export const updateTaxPeriodSchema = createTaxPeriodSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const updateTaxPeriodStatusSchema = z.object({
  status: z.enum(["open", "due", "paid", "filed", "closed"]),
});

export const linkDealSchema = z.object({
  dealJacketId: z.string().uuid(),
});

export const addTaxDocumentSchema = z.object({
  fileName: z.string().min(1),
  filePath: z.string().min(1),
});

export const taxPeriodListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["open", "due", "paid", "filed", "closed"]).optional(),
});

export const periodIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const periodDealParamSchema = z.object({
  id: z.string().uuid(),
  dealJacketId: z.string().uuid(),
});
