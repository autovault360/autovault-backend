import { z } from "zod";
import { EXPENSE_CATEGORIES } from "./expense-categories.js";

const RECURRING_FREQUENCIES = ["One-Time", "Weekly", "Monthly", "Quarterly", "Annual"];
const EXPENSE_STATUSES = ["paid", "unpaid"];

export const createExpenseSchema = z
  .object({
    expenseDate: z.coerce.date(),
    category: z.enum(EXPENSE_CATEGORIES).default("Dealership Expense"),
    subcategory: z.string().max(80).optional().nullable(),
    /** @deprecated Accepted for backward compatibility; mapped to subcategory */
    expType: z.string().max(80).optional().nullable(),
    name: z.string().min(1),
    vendor: z.string().optional(),
    description: z.string().optional(),
    amount: z.coerce.number().positive(),
    status: z.enum(EXPENSE_STATUSES).default("unpaid"),
    recurringFrequency: z.enum(RECURRING_FREQUENCIES).default("One-Time"),
    vehicleVin: z.string().nullish(),
    referenceNumber: z.string().nullish(),
    paymentMethod: z.string().nullish(),
    receiptStoragePath: z.string().nullish(),
    notes: z.string().nullish(),
    taxDeductible: z.boolean().default(true),
    isRecurring: z.boolean().default(false),
  })
  .superRefine((d, ctx) => {
    const sub = d.subcategory || d.expType || null;
    if (d.category === "Vehicle Expense") {
      const vin = (d.vehicleVin || "").trim();
      if (!vin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "vehicleVin is required for Vehicle Expense",
          path: ["vehicleVin"],
        });
      }
    }
    if (d.category === "Recurring Expense") {
      if (!d.isRecurring && (!d.recurringFrequency || d.recurringFrequency === "One-Time")) {
        // Allow One-Time under Recurring for flexibility, but prefer Monthly default in UI
      }
    } else if (d.recurringFrequency && d.recurringFrequency !== "One-Time") {
      // Non-recurring categories can still store One-Time; ignore other frequencies
    }
    if (!sub) {
      // subcategory optional — defaults to Other in service
    }
  })
  .transform((d) => {
    const subcategory = d.subcategory || d.expType || "Other";
    const isVehicle = d.category === "Vehicle Expense";
    const isRecurringCat = d.category === "Recurring Expense";
    return {
      ...d,
      subcategory,
      expType: undefined,
      vehicleVin: isVehicle ? (d.vehicleVin || null) : d.vehicleVin || null,
      recurringFrequency: isRecurringCat
        ? d.recurringFrequency || "Monthly"
        : "One-Time",
      isRecurring:
        isRecurringCat &&
        (d.isRecurring ||
          (d.recurringFrequency && d.recurringFrequency !== "One-Time")),
    };
  });

export const updateExpenseSchema = z
  .object({
    expenseDate: z.coerce.date().optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    subcategory: z.string().max(80).optional().nullable(),
    expType: z.string().max(80).optional().nullable(),
    name: z.string().min(1).optional(),
    vendor: z.string().optional(),
    description: z.string().optional(),
    amount: z.coerce.number().positive().optional(),
    status: z.enum(EXPENSE_STATUSES).optional(),
    recurringFrequency: z.enum(RECURRING_FREQUENCIES).optional(),
    vehicleVin: z.string().nullish(),
    referenceNumber: z.string().nullish(),
    paymentMethod: z.string().nullish(),
    receiptStoragePath: z.string().nullish(),
    notes: z.string().nullish(),
    taxDeductible: z.boolean().optional(),
    isRecurring: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" })
  .transform((d) => {
    const subcategory =
      d.subcategory !== undefined
        ? d.subcategory
        : d.expType !== undefined
          ? d.expType
          : undefined;
    const out = { ...d };
    delete out.expType;
    if (subcategory !== undefined) out.subcategory = subcategory;
    return out;
  });

export const expenseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  q: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  vehicleVin: z.string().optional(),
});

export const expenseIdParamSchema = z.object({
  id: z.string().uuid(),
});
