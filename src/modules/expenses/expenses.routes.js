import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
  READ_FINANCE_ROLES,
} from "../../common/auth-middleware.js";
import {
  createExpenseSchema,
  updateExpenseSchema,
  expenseListQuerySchema,
  expenseIdParamSchema,
} from "./expenses.schema.js";
import * as ctrl from "./expenses.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant);

router.get(
  "/",
  requireRoles(...READ_FINANCE_ROLES),
  validateQuery(expenseListQuerySchema),
  asyncHandler(ctrl.list),
);

router.post(
  "/",
  requireRoles("owner", "manager"),
  validateBody(createExpenseSchema),
  asyncHandler(ctrl.create),
);

router.get(
  "/:id",
  requireRoles(...READ_FINANCE_ROLES),
  validateParams(expenseIdParamSchema),
  asyncHandler(ctrl.get),
);

router.patch(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(expenseIdParamSchema),
  validateBody(updateExpenseSchema),
  asyncHandler(ctrl.update),
);

router.delete(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(expenseIdParamSchema),
  asyncHandler(ctrl.remove),
);

export default router;
