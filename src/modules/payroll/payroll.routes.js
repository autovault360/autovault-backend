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
  requirePlan,
  READ_FINANCE_ROLES,
} from "../../common/auth-middleware.js";
import {
  createSalesRepSchema,
  updateSalesRepSchema,
  createStaffSchema,
  updateStaffSchema,
  updateCommissionSchema,
  commissionListQuerySchema,
  createPayrollRunSchema,
  updatePayrollRunSchema,
  listQuerySchema,
  payrollHistoryQuerySchema,
  idParamSchema,
  checkAvailabilityQuerySchema,
} from "./payroll.schema.js";
import * as ctrl from "./payroll.controller.js";

const router = express.Router();
const financeRead = [...READ_FINANCE_ROLES, "sales_rep"];

// Sales reps
export const salesRepsRouter = express.Router();
salesRepsRouter.use(authenticate, requireTenant, requirePlan("growing_dealership"));
salesRepsRouter.get(
  "/",
  requireRoles(...financeRead),
  validateQuery(listQuerySchema),
  asyncHandler(ctrl.listSalesReps),
);
salesRepsRouter.get(
  "/check-availability",
  requireRoles("owner", "manager"),
  validateQuery(checkAvailabilityQuerySchema),
  asyncHandler(ctrl.checkSalesRepAvailability),
);
salesRepsRouter.post(
  "/",
  requireRoles("owner", "manager"),
  validateBody(createSalesRepSchema),
  asyncHandler(ctrl.createSalesRep),
);
salesRepsRouter.patch(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  validateBody(updateSalesRepSchema),
  asyncHandler(ctrl.updateSalesRep),
);
salesRepsRouter.get(
  "/:id/archive-preview",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  asyncHandler(ctrl.getSalesRepArchivePreview),
);
salesRepsRouter.post(
  "/:id/archive",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  asyncHandler(ctrl.archiveSalesRep),
);
salesRepsRouter.post(
  "/:id/send-invite",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  asyncHandler(ctrl.sendRepInvite),
);
salesRepsRouter.post(
  "/:id/impersonate",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  asyncHandler(ctrl.impersonateSalesRep),
);

// Staff
export const staffRouter = express.Router();
staffRouter.use(authenticate, requireTenant);
staffRouter.get(
  "/",
  requireRoles(...READ_FINANCE_ROLES),
  validateQuery(listQuerySchema),
  asyncHandler(ctrl.listStaff),
);
staffRouter.post(
  "/",
  requireRoles("owner", "manager"),
  validateBody(createStaffSchema),
  asyncHandler(ctrl.createStaff),
);
staffRouter.get(
  "/:id",
  requireRoles(...READ_FINANCE_ROLES),
  validateParams(idParamSchema),
  asyncHandler(ctrl.getStaff),
);
staffRouter.patch(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  validateBody(updateStaffSchema),
  asyncHandler(ctrl.updateStaff),
);
staffRouter.delete(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  asyncHandler(ctrl.deleteStaff),
);

// Commissions
export const commissionsRouter = express.Router();
commissionsRouter.use(authenticate, requireTenant, requirePlan("growing_dealership"));
commissionsRouter.get(
  "/",
  requireRoles(...financeRead),
  validateQuery(commissionListQuerySchema),
  asyncHandler(ctrl.listCommissions),
);
commissionsRouter.patch(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  validateBody(updateCommissionSchema),
  asyncHandler(ctrl.updateCommission),
);
commissionsRouter.post(
  "/:id/mark-paid",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  asyncHandler(ctrl.markCommissionPaid),
);

// Payroll runs
export const payrollRunsRouter = express.Router();
payrollRunsRouter.use(authenticate, requireTenant, requirePlan("growing_dealership"));
payrollRunsRouter.get(
  "/",
  requireRoles(...READ_FINANCE_ROLES),
  validateQuery(listQuerySchema),
  asyncHandler(ctrl.listPayrollRuns),
);
payrollRunsRouter.get(
  "/history",
  requireRoles(...READ_FINANCE_ROLES),
  validateQuery(payrollHistoryQuerySchema),
  asyncHandler(ctrl.getPayrollHistory),
);
payrollRunsRouter.post(
  "/",
  requireRoles("owner", "manager"),
  validateBody(createPayrollRunSchema),
  asyncHandler(ctrl.createPayrollRun),
);
payrollRunsRouter.get(
  "/:id",
  requireRoles(...READ_FINANCE_ROLES),
  validateParams(idParamSchema),
  asyncHandler(ctrl.getPayrollRun),
);
payrollRunsRouter.patch(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  validateBody(updatePayrollRunSchema),
  asyncHandler(ctrl.updatePayrollRun),
);
payrollRunsRouter.delete(
  "/:id",
  requireRoles("owner", "manager"),
  validateParams(idParamSchema),
  asyncHandler(ctrl.deletePayrollRun),
);

export default router;
