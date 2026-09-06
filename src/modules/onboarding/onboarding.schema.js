import { z } from "zod";
import { US_STATE_CODES } from "../../utils/us-states.js";

export const upsertRegistrationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    phone: z.string().trim().min(7).max(30).optional().or(z.literal("")),
    dealership: z.string().trim().min(2).max(150).optional(),
    dealershipName: z.string().trim().min(2).max(150).optional(),
    zipCode: z.string().trim().min(2).max(20),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => US_STATE_CODES.includes(v), "state must be a valid US state code"),
  })
  .superRefine((data, ctx) => {
    const dealership = data.dealershipName || data.dealership;
    if (!dealership || dealership.trim().length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dealership or dealershipName is required",
        path: ["dealership"],
      });
    }
  })
  .transform((data) => ({
    name: data.name,
    email: data.email,
    phone: data.phone || "",
    dealershipName: (data.dealershipName || data.dealership || "").trim(),
    zipCode: data.zipCode,
    state: data.state,
  }));

export const checkoutSchema = z.object({
  registrationId: z.string().uuid(),
  plan: z.enum(["wholesaler", "independent_dealer", "growing_dealership"]),
});

export const completeRegistrationQuerySchema = z.object({
  token: z.string().min(1),
});
