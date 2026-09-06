import { z } from "zod";
import {
  isAcceptedVin,
  isPlaceholderVin,
  VIN_FORMAT_MESSAGE,
} from "../../common/vin.js";

const customerFields = {
  customerId: z.string().uuid().optional(),
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().optional(),
  customerEmail: z
    .string()
    .email()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v === "" || v == null ? undefined : v)),
  customerAddress: z.string().optional(),
};

export const markSoldSchema = z
  .object({
    ...customerFields,
    saleDate: z.coerce.date(),
    soldPrice: z.coerce.number().positive(),
    salesTaxAmount: z.coerce.number().min(0).default(0),
    licenseFees: z.coerce.number().min(0).default(0),
    salesRepId: z.string().uuid().nullable().optional(),
    commissionType: z.enum(["percentage", "manual", "flat"]).optional(),
    commissionRate: z.coerce.number().min(0).optional(),
    commissionAmount: z.coerce.number().min(0).optional(),
    rosNumber: z.string().optional(),
    notes: z.string().optional(),
    workflowStatus: z
      .enum(["draft", "pending_review"])
      .default("pending_review"),
    additionalExpenses: z.coerce.number().min(0).default(0),
    fees: z.any().default({}),
    /** Finance-company remittance (optional). Prefer fees.netCheck when both sent. */
    netCheck: z.preprocess((v) => {
      if (v == null || v === "") return undefined;
      if (typeof v === "string") return v.replace(/,/g, "").trim();
      return v;
    }, z.coerce.number().min(0).max(99999999.99).optional().nullable()),
    titleReceived: z.boolean().optional(),
    titlePresent: z.boolean().optional(),
  })
  .refine(
    (d) => d.customerId || d.customerName,
    { message: "customerId or customerName is required" },
  );

export const markLossSchema = z.object({
  note: z.string().optional(),
  lossDate: z.coerce.date().optional(),
});

/** Import a vehicle sold before the dealer joined AutoVault. */
export const previousSoldSchema = z
  .object({
    vin: z
      .string()
      .trim()
      .max(17)
      .optional()
      .nullable()
      .transform((v) => (v == null || v === "" ? undefined : v.toUpperCase())),
    withoutVin: z.boolean().optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    make: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
    acquisitionDate: z.coerce.date(),
    saleDate: z.coerce.date(),
    acquisitionCost: z.coerce.number().positive(),
    soldPrice: z.coerce.number().positive(),
    auctionFees: z.coerce.number().min(0).default(0),
    reconditioningCost: z.coerce.number().min(0).default(0),
    otherExpenses: z.coerce.number().min(0).default(0),
    flooringFees: z.coerce.number().min(0).default(0),
    addOnsCost: z.coerce.number().min(0).default(0),
    /** Itemized add-ons: cost = dealer COGS, price = customer upcharge. */
    addOnItems: z
      .array(
        z.object({
          desc: z.string().max(200).default(""),
          type: z.string().max(80).default(""),
          price: z.coerce.number().min(0).default(0),
          cost: z.coerce.number().min(0).default(0),
        }),
      )
      .optional()
      .default([]),
    salesTaxAmount: z.coerce.number().min(0).default(0),
    licenseFees: z.coerce.number().min(0).default(0),
    /** Finance funding check that already includes dealer reserve / finance income. */
    netCheck: z.coerce.number().min(0).optional().nullable(),
    netCheckReason: z.string().max(200).optional().nullable(),
    netCheckNotes: z.string().max(2000).optional().nullable(),
    titleReceived: z.boolean().default(true),
    titlePresent: z.boolean().optional(),
    customerName: z.string().min(1).optional(),
    customerPhone: z.string().optional(),
    customerEmail: z
      .string()
      .email()
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v === "" || v == null ? undefined : v)),
    salesRepId: z.string().uuid().nullable().optional(),
    commissionAmount: z.coerce.number().min(0).optional(),
    commissionRate: z.coerce.number().min(0).optional(),
    commissionType: z.enum(["percentage", "manual", "flat"]).optional(),
    notes: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    const vin = d.vin || "";
    if (!vin) {
      if (!d.withoutVin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "VIN is required, or set withoutVin to assign a stock tag.",
          path: ["vin"],
        });
      }
    } else if (!isAcceptedVin(vin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: VIN_FORMAT_MESSAGE,
        path: ["vin"],
      });
    }

    const needsIdentity = !vin || isPlaceholderVin(vin) || d.withoutVin;
    if (needsIdentity) {
      if (d.year == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Year is required when adding without a VIN.",
          path: ["year"],
        });
      }
      if (!(d.make || "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Make is required when adding without a VIN.",
          path: ["make"],
        });
      }
      if (!(d.model || "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Model is required when adding without a VIN.",
          path: ["model"],
        });
      }
    }
  })
  .refine((d) => d.saleDate >= d.acquisitionDate, {
    message: "Sale date cannot be before purchase date",
    path: ["saleDate"],
  });


export const soldVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const vehicleIdParamSchema = z.object({
  id: z.string().uuid(),
});
