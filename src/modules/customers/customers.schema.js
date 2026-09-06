import { z } from "zod";

const customerStatus = z.enum(["lead", "active_deal", "customer"]);
const customerType = z.enum(["individual", "dealer", "wholesale"]);
const leadSource = z.enum([
  "website",
  "referral",
  "walk_in",
  "ads",
  "social_media",
  "other",
]);

export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional(),
  status: customerStatus.optional(),
  salesRepId: z.string().uuid().optional(),
  type: customerType.optional(),
});

export const createCustomerSchema = z.object({
  type: customerType.optional(),
  name: z.string().min(1).max(150),
  phone: z.string().max(30).optional().nullable(),
  email: z
    .string()
    .email()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v)),
  address: z.string().max(200).optional().nullable(),
  address2: z.string().max(200).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
  zip: z.string().max(12).optional().nullable(),
  driversLicenseNumber: z.string().max(50).optional().nullable(),
  imageUrl: z
    .string()
    .url()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v)),
  status: customerStatus.optional(),
  salesRepId: z.string().uuid().optional().nullable(),
  source: leadSource.optional().nullable(),
  dateOfBirth: z.coerce.date().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const updateCustomerSchema = createCustomerSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const createLeadSchema = createCustomerSchema.omit({ status: true });

export const createCustomerNoteSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const convertLeadSchema = z.object({
  status: z.literal("customer").optional(),
});
