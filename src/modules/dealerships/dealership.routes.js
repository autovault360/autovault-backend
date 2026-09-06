import express from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody, validateQuery, paginationSchema } from "../../common/validate.js";
import {
  authenticate,
  requireRoles,
  requireTenant,
  ownerOrApiKey,
} from "../../common/auth-middleware.js";
import * as ctrl from "./dealership.controller.js";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const KPI_COLOR_KEYS = [
  "inventory",
  "titles",
  "flooring",
  "sold",
  "profit",
  "purchase",
  "fees",
  "repairs",
  "tax",
  "commission",
  "cost",
  "upcoming",
  "gross",
];

const kpiColorsSchema = z
  .record(
    z.string(),
    z.string().regex(HEX_COLOR, "Color must be a hex value like #RRGGBB"),
  )
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      if (!KPI_COLOR_KEYS.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown KPI color key: ${key}`,
          path: [key],
        });
      }
    }
  });

const updateSchema = z
  .object({
    name: z.string().min(2).max(150).optional(),
    email: z.string().email().optional().nullable(),
    phone: z.string().min(7).max(30).optional().nullable(),
    address: z.string().max(200).optional().nullable(),
    city: z.string().min(2).max(80).optional().nullable(),
    state: z.string().length(2).optional().nullable(),
    zip: z.string().max(12).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

const preferencesSchema = z.object({
  kpiColors: kpiColorsSchema,
});

const router = express.Router();

router.get(
  "/me",
  authenticate,
  requireTenant,
  asyncHandler(ctrl.getMe),
);
router.patch(
  "/me",
  authenticate,
  requireTenant,
  requireRoles("owner", "manager"),
  validateBody(updateSchema),
  asyncHandler(ctrl.updateMe),
);
router.get(
  "/me/preferences",
  authenticate,
  requireTenant,
  asyncHandler(ctrl.getPreferences),
);
router.patch(
  "/me/preferences",
  authenticate,
  requireTenant,
  requireRoles("owner", "manager"),
  validateBody(preferencesSchema),
  asyncHandler(ctrl.updatePreferences),
);

/** Platform owner listing */
const platformRouter = express.Router();
platformRouter.get(
  "/",
  ownerOrApiKey,
  validateQuery(paginationSchema),
  asyncHandler(ctrl.listPlatform),
);

export { platformRouter as dealershipPlatformRoutes };
export default router;
