import { z } from "zod";

export const billingCheckoutSchema = z.object({
  action: z.enum(["upgrade", "pay_due"]),
  plan: z
    .enum(["wholesaler", "independent_dealer", "growing_dealership"])
    .optional()
    .nullable(),
});

export const billingSettingsSchema = z
  .object({
    autoExpense: z.boolean().optional(),
    notifyBefore: z.boolean().optional(),
  })
  .refine(
    (d) => d.autoExpense !== undefined || d.notifyBefore !== undefined,
    { message: "At least one setting is required." },
  );
