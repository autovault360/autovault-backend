import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateQuery } from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
} from "../../common/auth-middleware.js";
import { globalSearchQuerySchema } from "./search.schema.js";
import * as ctrl from "./search.controller.js";

const SEARCH_ROLES = [
  "owner",
  "manager",
  "sales_rep",
  "cpa",
  "wholesale_dealer",
  "platform_owner",
];

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...SEARCH_ROLES));

router.get(
  "/",
  validateQuery(globalSearchQuerySchema),
  asyncHandler(ctrl.globalSearch),
);

export default router;
