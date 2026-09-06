import { z } from "zod";
import {
  isStrongPassword,
  STRONG_PASSWORD_MESSAGE,
} from "../../common/auth-utils.js";

const strongPassword = z
  .string()
  .min(8)
  .max(128)
  .refine(isStrongPassword, { message: STRONG_PASSWORD_MESSAGE });

export const loginSchema = z.object({
  email: z
    .string()
    .min(1)
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1).max(128),
  portal: z
    .enum(["admin", "wholesale", "sales_rep", "sales-rep", "owner", "cpa"])
    .optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: strongPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: strongPassword,
});
