import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateQuery } from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
  ADMIN_ROLES,
} from "../../common/auth-middleware.js";
import { auditLogsQuerySchema } from "./dashboard.schema.js";
import * as ctrl from "./dashboard.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant);

router.get("/summary", asyncHandler(ctrl.getSummary));

export const auditLogsRouter = express.Router();
auditLogsRouter.use(
  authenticate,
  requireTenant,
  requireRoles(...ADMIN_ROLES),
);
auditLogsRouter.get(
  "/",
  validateQuery(auditLogsQuerySchema),
  asyncHandler(ctrl.listAuditLogs),
);

export default router;
