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
  markSoldSchema,
  markLossSchema,
  previousSoldSchema,
  soldVehiclesQuerySchema,
  vehicleIdParamSchema,
} from "./deals.schema.js";
import * as dealsCtrl from "./deals.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant);

// Must be registered before /:id routes so "previous-sold" is not treated as an id.
router.post(
  "/previous-sold",
  requireRoles("owner", "manager"),
  validateBody(previousSoldSchema),
  asyncHandler(dealsCtrl.importPreviousSold),
);

router.post(
  "/:id/mark-sold",
  requireRoles("owner", "manager"),
  validateParams(vehicleIdParamSchema),
  validateBody(markSoldSchema),
  asyncHandler(dealsCtrl.markSold),
);

router.post(
  "/:id/mark-loss",
  requireRoles("owner", "manager"),
  validateParams(vehicleIdParamSchema),
  validateBody(markLossSchema),
  asyncHandler(dealsCtrl.markLoss),
);

export const soldVehiclesRouter = express.Router();
soldVehiclesRouter.get(
  "/",
  authenticate,
  requireTenant,
  requireRoles(...READ_FINANCE_ROLES, "sales_rep"),
  validateQuery(soldVehiclesQuerySchema),
  asyncHandler(dealsCtrl.listSoldVehicles),
);

export default router;
