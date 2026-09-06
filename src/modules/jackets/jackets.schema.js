import { z } from "zod";

export const createJacketSchema = z.object({
  vehicleId: z.string().uuid(),
  customerId: z.string().uuid(),
  salesRepId: z.string().uuid().nullable().optional(),
  soldPrice: z.coerce.number().positive(),
  totalTax: z.coerce.number().min(0).default(0),
  totalSalePrice: z.coerce.number().min(0).optional(),
  downPayment: z.coerce.number().min(0).default(0),
  amountFinanced: z.coerce.number().min(0).default(0),
  additionalExpenses: z.coerce.number().min(0).default(0),
  tradeInAllowance: z.coerce.number().min(0).default(0),
  warrantyAmount: z.coerce.number().min(0).default(0),
  gapAmount: z.coerce.number().min(0).default(0),
  fees: z.any().default({}),
  lender: z.string().optional(),
  rosNumber: z.string().optional(),
  notes: z.string().optional(),
  dealType: z.enum(["Retail", "Wholesale", "Fleet"]).default("Retail"),
  dateSold: z.coerce.date().optional(),
  commissionRate: z.coerce.number().min(0).optional(),
  commissionAmount: z.coerce.number().min(0).optional(),
  commissionType: z.enum(["percentage", "manual", "flat"]).optional(),
});

/** No `.default()` keys — Zod would otherwise inject dealType / zeros on PATCH and
 *  block fee-only updates (Net Check) on already-approved jackets. */
export const updateJacketSchema = z
  .object({
    vehicleId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    salesRepId: z.string().uuid().nullable().optional(),
    soldPrice: z.coerce.number().positive().optional(),
    totalTax: z.coerce.number().min(0).optional(),
    totalSalePrice: z.coerce.number().min(0).optional(),
    downPayment: z.coerce.number().min(0).optional(),
    amountFinanced: z.coerce.number().min(0).optional(),
    additionalExpenses: z.coerce.number().min(0).optional(),
    tradeInAllowance: z.coerce.number().min(0).optional(),
    warrantyAmount: z.coerce.number().min(0).optional(),
    gapAmount: z.coerce.number().min(0).optional(),
    fees: z.any().optional(),
    lender: z.string().optional().nullable(),
    rosNumber: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    dealType: z.enum(["Retail", "Wholesale", "Fleet"]).optional(),
    dateSold: z.coerce.date().optional(),
    commissionRate: z.coerce.number().min(0).optional(),
    commissionAmount: z.coerce.number().min(0).optional(),
    commissionType: z.enum(["percentage", "manual", "flat"]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const jacketListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional(),
  workflowStatus: z
    .enum([
      "draft",
      "pending_review",
      "changes_requested",
      "resubmitted",
      "approved",
      "rejected",
    ])
    .optional(),
  salesRepId: z.string().uuid().optional(),
});

export const requestChangesSchema = z.object({
  reviewNotes: z.string().min(1),
  changeCategories: z.array(z.string()).default([]),
});

export const rejectJacketSchema = z.object({
  rejectionReason: z.string().min(1),
});

export const approveJacketSchema = z.object({
  reviewNotes: z.string().optional(),
});

export const addDocumentSchema = z.object({
  fileUrl: z.string().min(1),
  documentName: z.string().min(1),
  fileType: z.string().default("application/pdf"),
});

/** Diff-based document sync: keep these IDs, delete the rest, optionally add new. */
export const syncDocumentsSchema = z.object({
  keepDocumentIds: z.array(z.string().uuid()).default([]),
  addDocuments: z.array(addDocumentSchema).default([]),
});

export const checkDealNumberQuerySchema = z.object({
  rosNumber: z.string().min(1).max(40),
  /** Exclude this jacket id when editing an existing jacket */
  excludeJacketId: z.string().uuid().optional(),
  /** Exclude this vehicle's existing deal/jacket when completing a sold jacket */
  excludeVehicleId: z.string().uuid().optional(),
});

export const jacketIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const jacketDocumentParamSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
});
