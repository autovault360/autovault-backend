import { z } from "zod";
import { paginationSchema } from "../../common/validate.js";

export const periodQuerySchema = z
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

export const listVehiclesQuerySchema = paginationSchema.extend({
  q: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  sold: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v == null ? undefined : v === "true" || v === "1")),
});

export const vehicleIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createVehicleSchema = z.object({
  vin: z.string().trim().min(5, "VIN is required").max(32),
  year: z.coerce.number().int().min(1950).max(2100),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  trim: z.string().trim().max(80).optional().nullable(),
  acquisitionCost: z.coerce.number().min(0).max(10_000_000),
  auctionFees: z.coerce.number().min(0).max(1_000_000).optional().default(0),
  acquisitionDate: z.coerce.date().optional().nullable(),
  floored: z.boolean().optional().default(false),
  titlePresent: z.boolean().optional().default(true),
  isWholesale: z.boolean().optional().default(false),
  auctionHouse: z.string().trim().max(120).optional().nullable(),
  auctionDate: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const updateVehicleSchema = z
  .object({
    year: z.coerce.number().int().min(1950).max(2100).optional(),
    make: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(80).optional(),
    trim: z.string().trim().max(80).optional().nullable(),
    acquisitionCost: z.coerce.number().min(0).max(10_000_000).optional(),
    auctionFees: z.coerce.number().min(0).max(1_000_000).optional(),
    acquisitionDate: z.coerce.date().optional().nullable(),
    floored: z.boolean().optional(),
    flooringOverride: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
    titlePresent: z.boolean().optional(),
    isWholesale: z.boolean().optional(),
    auctionHouse: z.string().trim().max(120).optional().nullable(),
    auctionDate: z.coerce.date().optional().nullable(),
    auctionRuns: z.coerce.number().int().min(0).max(100).optional(),
    notes: z.string().trim().max(5000).optional().nullable(),
    status: z
      .enum([
        "in_stock",
        "needs_attention",
        "pending_deal",
        "sold",
        "loss",
        "wholesale",
        "out_of_state_sale",
      ])
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const updateStatusSchema = z.object({
  status: z.enum([
    "in_stock",
    "needs_attention",
    "pending_deal",
    "sold",
    "loss",
    "wholesale",
    "out_of_state_sale",
  ]),
});

export const recordSaleSchema = z.object({
  soldPrice: z.coerce.number().min(0).max(10_000_000),
  soldAt: z.coerce.date().optional(),
  saleChannel: z.enum(["auction", "dealer", "other"]).optional().default("auction"),
  auctionHouse: z.string().trim().max(120).optional().nullable(),
  auctionDate: z.coerce.date().optional().nullable(),
  auctionRuns: z.coerce.number().int().min(0).max(100).optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
  outOfState: z.boolean().optional().default(false),
});

export const listExpensesQuerySchema = paginationSchema.extend({
  q: z.string().max(120).optional(),
  category: z.string().max(80).optional(),
  status: z.enum(["paid", "unpaid", "pending"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  mode: z.enum(["year", "month"]).optional(),
});

export const createExpenseSchema = z.object({
  expenseDate: z.coerce.date(),
  category: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  amount: z.coerce.number().min(0).max(10_000_000),
  vendor: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["paid", "unpaid", "pending"]).optional().default("paid"),
  vehicleVin: z.string().trim().max(32).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  taxDeductible: z.boolean().optional().default(true),
});

export const updateExpenseSchema = createExpenseSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const expenseIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const calendarNotesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const upsertDayNoteSchema = z.object({
  noteDate: z.coerce.date(),
  body: z.string().trim().max(5000),
});
