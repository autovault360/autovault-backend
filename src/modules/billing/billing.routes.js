import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody } from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
} from "../../common/auth-middleware.js";
import {
  billingCheckoutSchema,
  billingSettingsSchema,
} from "./billing.schema.js";
import * as ctrl from "./billing.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant);

const BILLING_ROLES = ["owner", "manager", "wholesale_dealer"];

router.get("/", requireRoles(...BILLING_ROLES), asyncHandler(ctrl.getBilling));

router.get(
  "/history",
  requireRoles(...BILLING_ROLES),
  asyncHandler(ctrl.getBillingHistory),
);

router.get(
  "/plans",
  requireRoles(...BILLING_ROLES),
  asyncHandler(ctrl.listPlans),
);

router.post(
  "/checkout",
  requireRoles(...BILLING_ROLES),
  validateBody(billingCheckoutSchema),
  asyncHandler(ctrl.createCheckout),
);

router.post(
  "/portal",
  requireRoles(...BILLING_ROLES),
  asyncHandler(ctrl.createPortal),
);

router.patch(
  "/settings",
  requireRoles(...BILLING_ROLES),
  validateBody(billingSettingsSchema),
  asyncHandler(ctrl.updateSettings),
);

export default router;
