import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import {
  validateBody,
  validateQuery,
  validateParams,
  uuidParam,
} from "../../common/validate.js";
import {
  authenticate,
  requireRoles,
  requireTenant,
} from "../../common/auth-middleware.js";
import { forbidden } from "../../common/errors.js";
import {
  listVehiclesQuerySchema,
  createVehicleSchema,
  updateVehicleSchema,
  changeStatusSchema,
  createVehicleExpenseSchema,
  updateVehicleExpenseSchema,
  createFlooringPlanSchema,
  updateFlooringPlanSchema,
  vehicleExpenseParams,
  flooringBreakdownQuerySchema,
  flooringUndoSaveSchema,
  inventoryStatsQuerySchema,
} from "./vehicles.schema.js";
import * as ctrl from "./vehicles.controller.js";

const VEHICLE_READ_ROLES = [
  "owner",
  "manager",
  "sales_rep",
  "cpa",
  "wholesale_dealer",
  "platform_owner",
];
const VEHICLE_WRITE_ROLES = ["owner", "manager", "wholesale_dealer"];

function requireVehicleWrite(req, _res, next) {
  if (!VEHICLE_WRITE_ROLES.includes(req.auth?.role)) {
    return next(forbidden("You do not have permission to modify vehicles."));
  }
  return next();
}

const vehiclesRouter = express.Router();
vehiclesRouter.use(authenticate, requireTenant, requireRoles(...VEHICLE_READ_ROLES));

vehiclesRouter.get(
  "/",
  validateQuery(listVehiclesQuerySchema),
  asyncHandler(ctrl.listVehicles),
);
// Must be registered before /:id so "stats" is not parsed as a UUID.
vehiclesRouter.get(
  "/stats",
  validateQuery(inventoryStatsQuerySchema),
  asyncHandler(ctrl.getInventoryStats),
);
vehiclesRouter.get(
  "/:id",
  validateParams(uuidParam),
  asyncHandler(ctrl.getVehicle),
);
vehiclesRouter.post(
  "/",
  requireVehicleWrite,
  validateBody(createVehicleSchema),
  asyncHandler(ctrl.createVehicle),
);
vehiclesRouter.patch(
  "/:id",
  requireVehicleWrite,
  validateParams(uuidParam),
  validateBody(updateVehicleSchema),
  asyncHandler(ctrl.updateVehicle),
);
vehiclesRouter.delete(
  "/:id",
  requireVehicleWrite,
  validateParams(uuidParam),
  asyncHandler(ctrl.deleteVehicle),
);
vehiclesRouter.post(
  "/:id/status",
  requireVehicleWrite,
  validateParams(uuidParam),
  validateBody(changeStatusSchema),
  asyncHandler(ctrl.changeStatus),
);

vehiclesRouter.get(
  "/:id/expenses",
  validateParams(uuidParam),
  asyncHandler(ctrl.listExpenses),
);
vehiclesRouter.post(
  "/:id/expenses",
  requireVehicleWrite,
  validateParams(uuidParam),
  validateBody(createVehicleExpenseSchema),
  asyncHandler(ctrl.createExpense),
);
vehiclesRouter.patch(
  "/:id/expenses/:expenseId",
  requireVehicleWrite,
  validateParams(vehicleExpenseParams),
  validateBody(updateVehicleExpenseSchema),
  asyncHandler(ctrl.updateExpense),
);
vehiclesRouter.delete(
  "/:id/expenses/:expenseId",
  requireVehicleWrite,
  validateParams(vehicleExpenseParams),
  asyncHandler(ctrl.deleteExpense),
);

const flooringPlansRouter = express.Router();
flooringPlansRouter.use(
  authenticate,
  requireTenant,
  requireRoles(...VEHICLE_READ_ROLES),
);

flooringPlansRouter.get("/", asyncHandler(ctrl.listFlooringPlans));
flooringPlansRouter.post(
  "/",
  requireVehicleWrite,
  validateBody(createFlooringPlanSchema),
  asyncHandler(ctrl.createFlooringPlan),
);
flooringPlansRouter.patch(
  "/:id",
  requireVehicleWrite,
  validateParams(uuidParam),
  validateBody(updateFlooringPlanSchema),
  asyncHandler(ctrl.updateFlooringPlan),
);
flooringPlansRouter.delete(
  "/:id",
  requireVehicleWrite,
  validateParams(uuidParam),
  asyncHandler(ctrl.deleteFlooringPlan),
);

const flooringRouter = express.Router();
flooringRouter.use(
  authenticate,
  requireTenant,
  requireRoles(...VEHICLE_READ_ROLES),
);
flooringRouter.get(
  "/breakdown",
  validateQuery(flooringBreakdownQuerySchema),
  asyncHandler(ctrl.flooringBreakdown),
);
flooringRouter.get("/undo", asyncHandler(ctrl.getFlooringUndo));
flooringRouter.put(
  "/undo",
  requireVehicleWrite,
  validateBody(flooringUndoSaveSchema),
  asyncHandler(ctrl.saveFlooringUndo),
);
flooringRouter.post(
  "/undo",
  requireVehicleWrite,
  asyncHandler(ctrl.restoreFlooringUndo),
);
flooringRouter.delete(
  "/undo",
  requireVehicleWrite,
  asyncHandler(ctrl.clearFlooringUndo),
);

export { vehiclesRouter, flooringPlansRouter, flooringRouter };
