import { z } from "zod";
import { US_STATE_CODES } from "../../utils/us-states.js";

export const contactSchema = z.object({
  first: z.string().trim().min(1).max(80),
  last: z.string().trim().max(80).optional().or(z.literal("")),
  company: z.string().trim().max(150).optional().or(z.literal("")),
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || US_STATE_CODES.includes(v),
      "state must be a valid US state code",
    ),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  /** Honeypot — bots fill this; we silently accept without sending */
  website: z.string().max(200).optional().default(""),
});
