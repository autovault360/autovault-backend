import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateQuery } from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
  READ_FINANCE_ROLES,
} from "../../common/auth-middleware.js";
import { reportQuerySchema } from "./reports.schema.js";
import * as ctrl from "./reports.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...READ_FINANCE_ROLES));

router.get(
  "/profit-loss",
  validateQuery(reportQuerySchema),
  asyncHandler(ctrl.profitLoss),
);

export default router;
