import { z } from "zod";

const commissionFields = {
  commissionType: z.enum(["percentage", "flat"]).default("percentage"),
  commissionRate: z.coerce.number().min(0).optional(),
};

function refineCommission(data, ctx) {
  const rate = data.commissionRate;
  if (
    data.commissionType === "percentage" &&
    rate != null &&
    rate > 1
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Percentage commissionRate must be between 0 and 1 (e.g. 0.2 = 20%)",
      path: ["commissionRate"],
    });
  }
}

export const createSalesRepSchema = z
  .object({
    username: z
      .string()
      .min(2, "Username must be at least 2 characters")
      .max(64)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        "Username may only contain letters, numbers, dots, underscores, and hyphens",
      ),
    email: z.string().email(),
    fullName: z.string().min(1),
    phone: z.string().optional(),
    password: z.string().min(8).optional(),
    sendInvite: z.boolean().optional(),
    birthDate: z.coerce.date().optional(),
    baseSalary: z.coerce.number().min(0).default(0),
    payFrequency: z.enum(["weekly", "biweekly"]).optional(),
    payDay: z.coerce.number().int().min(0).max(6).optional(),
    payAnchor: z.coerce.date().nullable().optional(),
    paymentMethod: z.enum(["Direct Deposit", "Check", "Cash"]).optional(),
    payDocUrl: z.string().optional(),
    ...commissionFields,
  })
  .superRefine(refineCommission)
  .transform((d) => ({
    ...d,
    username: String(d.username).trim(),
    email: String(d.email).trim().toLowerCase(),
    commissionRate:
      d.commissionRate != null
        ? d.commissionRate
        : d.commissionType === "flat"
          ? 0
          : 0.1,
  }));

export const updateSalesRepSchema = z
  .object({
    username: z
      .string()
      .min(2)
      .max(64)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        "Username may only contain letters, numbers, dots, underscores, and hyphens",
      )
      .optional()
      .nullable(),
    fullName: z.string().min(1).optional(),
    phone: z.string().optional(),
    isActive: z.boolean().optional(),
    birthDate: z.coerce.date().nullable().optional(),
    baseSalary: z.coerce.number().min(0).optional(),
    payFrequency: z.enum(["weekly", "biweekly"]).nullable().optional(),
    payDay: z.coerce.number().int().min(0).max(6).nullable().optional(),
    payAnchor: z.coerce.date().nullable().optional(),
    paymentMethod: z.enum(["Direct Deposit", "Check", "Cash"]).nullable().optional(),
    payDocUrl: z.string().nullable().optional(),
    commissionType: z.enum(["percentage", "flat"]).optional(),
    commissionRate: z.coerce.number().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" })
  .superRefine((data, ctx) => {
    if (
      data.commissionType === "percentage" &&
      data.commissionRate != null &&
      data.commissionRate > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage commissionRate must be between 0 and 1 (e.g. 0.2 = 20%)",
        path: ["commissionRate"],
      });
    }
  });

const staffScheduleFields = {
  payFrequency: z.enum(["weekly", "biweekly"]).nullish(),
  payDay: z.coerce.number().int().min(0).max(6).nullish(),
  payAnchor: z.coerce.date().nullable().optional(),
  workDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).nullish(),
  hoursPerDay: z.coerce.number().min(0).max(24).nullish(),
};

export const createStaffSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone number is required"),
  title: z.string().min(1, "Role is required"),
  payType: z.enum(["commission", "salary", "hourly"]),
  payRate: z.coerce.number().min(0, "Pay rate must be 0 or greater"),
  hireDate: z.coerce.date({ required_error: "Hire date is required" }),
  payMethod: z.enum(["Direct Deposit", "Check", "Cash"]).nullish(),
  payDocUrl: z.string().nullish(),
  isActive: z.boolean().default(true),
  ...staffScheduleFields,
});

export const updateStaffSchema = z
  .object({
    fullName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    payType: z.enum(["commission", "salary", "hourly"]).optional(),
    payRate: z.coerce.number().min(0).optional(),
    hireDate: z.coerce.date().optional(),
    payMethod: z.enum(["Direct Deposit", "Check", "Cash"]).nullable().optional(),
    payDocUrl: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    payFrequency: z.enum(["weekly", "biweekly"]).nullable().optional(),
    payDay: z.coerce.number().int().min(0).max(6).nullable().optional(),
    payAnchor: z.coerce.date().nullable().optional(),
    workDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).nullable().optional(),
    hoursPerDay: z.coerce.number().min(0).max(24).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const updateCommissionSchema = z.object({
  status: z.enum(["pending_review", "approved", "rejected", "paid"]).optional(),
  commissionAmount: z.coerce.number().min(0).optional(),
});

export const commissionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum(["pending_review", "approved", "rejected", "paid"])
    .optional(),
  salesRepId: z.string().uuid().optional(),
});

export const createPayrollRunSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        staffMemberId: z.string().uuid().nullable().optional(),
        salesRepId: z.string().uuid().nullable().optional(),
        description: z.string().min(1),
        amount: z.coerce.number().positive(),
        proofPath: z.string().optional(),
      }),
    )
    .default([]),
});

export const updatePayrollRunSchema = z
  .object({
    status: z.enum(["draft", "processed", "paid"]).optional(),
    notes: z.string().optional(),
    items: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          staffMemberId: z.string().uuid().nullable().optional(),
          salesRepId: z.string().uuid().nullable().optional(),
          description: z.string().min(1),
          amount: z.coerce.number().positive(),
          proofPath: z.string().optional(),
        }),
      )
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional(),
});

export const payrollHistoryQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  upto: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const checkAvailabilityQuerySchema = z
  .object({
    email: z.string().email().optional(),
    username: z.string().min(2).max(64).optional(),
    excludeUserId: z.string().uuid().optional(),
  })
  .refine((d) => !!(d.email || d.username), {
    message: "Provide email and/or username to check",
  });
