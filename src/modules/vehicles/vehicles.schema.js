import { z } from "zod";
import { isAcceptedVin, VIN_FORMAT_MESSAGE } from "../../common/vin.js";

const decimal = z.coerce.number().min(0).optional().nullable();
const requiredDecimal = z.coerce.number().min(0);

const vehicleStatus = z.enum([
  "in_stock",
  "needs_attention",
  "pending_deal",
  "sold",
  "loss",
  "wholesale",
  "out_of_state_sale",
  "arbitration",
]);

export const listVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional(),
  status: vehicleStatus.optional(),
  /** `inventory` = unsold / current stock only; `all` = every vehicle (default). */
  scope: z.enum(["all", "inventory"]).optional().default("all"),
});

const vehicleVinSchema = z
  .string()
  .trim()
  .min(1)
  .max(17)
  .transform((v) => v.toUpperCase())
  .refine((v) => isAcceptedVin(v), { message: VIN_FORMAT_MESSAGE });

export const createVehicleSchema = z.object({
  vin: vehicleVinSchema,
  stockNumber: z.string().max(50).optional().nullable(),
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  trim: z.string().max(80).optional().nullable(),
  year: z.coerce.number().int().min(1900).max(2100),
  bodyStyle: z.string().max(80).optional().nullable(),
  exteriorColor: z.string().max(50).optional().nullable(),
  interiorColor: z.string().max(50).optional().nullable(),
  drivetrain: z.string().max(50).optional().nullable(),
  fuelType: z.string().max(50).optional().nullable(),
  engine: z.string().max(80).optional().nullable(),
  transmission: z.string().max(50).optional().nullable(),
  mileage: z.coerce.number().int().min(0).optional().nullable(),
  doors: z.coerce.number().int().min(1).max(8).optional().nullable(),
  acquisitionDate: z.coerce.date().optional().nullable(),
  acquisitionCost: decimal,
  askingPrice: decimal,
  marketValue: decimal,
  wholesalePrice: decimal,
  reconditioningCost: requiredDecimal.optional(),
  registrationFees: requiredDecimal.optional(),
  auctionFees: requiredDecimal.optional(),
  flooringFees: requiredDecimal.optional(),
  titleStatus: z.string().max(50).optional().nullable(),
  licensePlate: z.string().max(20).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
  sellerAuction: z.string().max(120).optional().nullable(),
  purchaseType: z.string().max(50).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  titleReceived: z.boolean().optional(),
  titlePresent: z.boolean().optional(),
  flooringStartDate: z.coerce.date().optional().nullable(),
  flooringPlanId: z.string().uuid().optional().nullable(),
  status: vehicleStatus.optional(),
  isWholesale: z.boolean().optional(),
  customerName: z.string().max(120).optional().nullable(),
  customerPhone: z.string().max(30).optional().nullable(),
  customerEmail: z.string().max(120).optional().nullable(),
  customerAddress: z.string().max(500).optional().nullable(),
});

const addOnItemSchema = z.object({
  desc: z.string().max(200).default(""),
  type: z.string().max(80).default(""),
  price: z.coerce.number().min(0, "Price must be >= 0").default(0),
  /** Dealer cost of the add-on (COGS); upcharge/sale price is `price`. */
  cost: z.coerce.number().min(0).default(0),
});

const moneyAmount = z.preprocess((v) => {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const t = v.replace(/,/g, "").trim();
    return t === "" ? null : t;
  }
  return v;
}, z.coerce.number().min(0).max(99999999.99).nullable());

const feesSchema = z.object({
  addOnItems: z.array(addOnItemSchema).optional(),
  netCheck: moneyAmount.optional(),
  netCheckReason: z.string().max(200).optional().nullable(),
  netCheckNotes: z.string().max(2000).optional().nullable(),
  statusInfo: z.record(z.string(), z.any()).optional(),
}).catchall(z.any());

export const updateVehicleSchema = createVehicleSchema
  .partial()
  .extend({
    soldPrice: z.coerce.number().min(0).optional().nullable(),
    fees: feesSchema.optional(),
    additionalExpenses: z.coerce.number().min(0).optional(),
    // Deal Jacket autosave — synced onto Deal / DealJacket, not Vehicle columns
    salesTaxAmount: z.coerce.number().min(0).optional().nullable(),
    licenseFees: z.coerce.number().min(0).optional().nullable(),
    rosNumber: z.string().max(40).optional().nullable(),
    commissionAmount: z.coerce.number().min(0).optional().nullable(),
    commissionRate: z.coerce.number().min(0).optional().nullable(),
    commissionType: z.enum(["percentage", "manual", "flat"]).optional().nullable(),
    saleDate: z.coerce.date().optional().nullable(),
    salesRepId: z.string().uuid().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const changeStatusSchema = z.object({
  status: vehicleStatus,
  note: z.string().max(1000).optional().nullable(),
});

export const createVehicleExpenseSchema = z.object({
  repairDate: z.coerce.date(),
  category: z.string().max(50).optional(),
  repairType: z.string().max(80).optional().nullable(),
  description: z.string().min(1).max(500),
  expenseName: z.string().max(120).optional().nullable(),
  shopVendor: z.string().max(120).optional().nullable(),
  paymentMethod: z.string().max(50).optional().nullable(),
  invoiceNumber: z.string().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  laborCost: requiredDecimal.optional(),
  partsCost: requiredDecimal.optional(),
  otherFees: requiredDecimal.optional(),
  totalCost: requiredDecimal.optional(),
  isInternal: z.boolean().optional(),
  paymentStatus: z.enum(["unpaid", "paid", "partial"]).optional(),
  datePaid: z.coerce.date().optional().nullable(),
  receiptStoragePath: z.string().max(2000).optional().nullable(),
});

export const updateVehicleExpenseSchema = createVehicleExpenseSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const createFlooringPlanSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  rateType: z.enum(["monthly", "daily", "apr"]).optional(),
  baseRate: z.coerce.number().min(0),
  effectiveDate: z.coerce.date(),
  rateIncreaseEnabled: z.boolean().optional(),
  increaseAfterDays: z.coerce.number().int().min(0).optional().nullable(),
  increaseAmountType: z.string().max(20).optional().nullable(),
  increaseAmount: decimal,
  maxCap: decimal,
  buyFee: decimal,
  lateFeePerDay: decimal,
  lateFeeAfterDays: z.coerce.number().int().min(0).optional().nullable(),
  gracePeriodDays: z.coerce.number().int().min(0).optional().nullable(),
  isActive: z.boolean().optional(),
  configJson: z.any().optional().nullable(),
});

export const updateFlooringPlanSchema = createFlooringPlanSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const vehicleIdParam = z.object({ id: z.string().uuid() });

export const vehicleExpenseParams = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
});

export const flooringBreakdownQuerySchema = z.object({
  asOfDate: z.coerce.date().optional(),
});

const flooringUndoTierSchema = z.object({
  max: z.coerce.number().min(0).nullable().optional(),
  rate: z.coerce.number().min(0).optional().default(0),
});

const flooringUndoConfigSchema = z.object({
  buyFee: z.coerce.number().min(0).optional().default(0),
  gracePeriod: z.coerce.number().min(0).optional().default(0),
  payoffDays: z.coerce.number().min(0).optional().default(90),
  applied: z.boolean().optional().default(false),
  scope: z.string().max(40).optional().default("all"),
  planId: z.string().uuid().optional().nullable(),
  tiers: z.array(flooringUndoTierSchema).optional().default([]),
});

const flooringUndoVehicleSchema = z.object({
  vin: z.string().min(1).max(17),
  id: z.string().uuid().optional().nullable(),
  floored: z.boolean().optional().default(false),
  flooringOverride: z.coerce.number().min(0).optional().nullable(),
  flooringPaidOff: z.boolean().optional().default(false),
  flooringPaidDate: z.string().max(40).optional().nullable(),
  flooringPaidAmount: z.coerce.number().min(0).optional().nullable(),
  flooringStartDate: z.union([z.string(), z.coerce.date()]).optional().nullable(),
  flooringPlanId: z.string().uuid().optional().nullable(),
  flooringManual: z.boolean().optional().default(false),
  flooringFees: z.coerce.number().min(0).optional().nullable(),
});

/** Client may send a snapshot; if omitted the server captures current DB state. */
export const flooringUndoSaveSchema = z.object({
  config: flooringUndoConfigSchema.optional(),
  vehicles: z.array(flooringUndoVehicleSchema).max(5000).optional(),
});

export const inventoryStatsQuerySchema = z
  .object({
    mode: z.enum(["all", "year", "month"]).optional().default("all"),
    year: z.coerce.number().int().min(1990).max(2100).optional(),
    /** Calendar month 1–12. Required when mode is `month`. */
    month: z.coerce.number().int().min(1).max(12).optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.mode === "year" || data.mode === "month") && data.year == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "year is required when mode is year or month",
        path: ["year"],
      });
    }
    if (data.mode === "month" && data.month == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "month (1–12) is required when mode is month",
        path: ["month"],
      });
    }
  });
