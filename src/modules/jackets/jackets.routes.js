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
  createJacketSchema,
  updateJacketSchema,
  jacketListQuerySchema,
  checkDealNumberQuerySchema,
  requestChangesSchema,
  rejectJacketSchema,
  approveJacketSchema,
  addDocumentSchema,
  syncDocumentsSchema,
  jacketIdParamSchema,
  jacketDocumentParamSchema,
} from "./jackets.schema.js";
import * as ctrl from "./jackets.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant);

const readRoles = [...READ_FINANCE_ROLES, "sales_rep", "wholesale_dealer"];
const writeRoles = ["owner", "manager", "sales_rep"];

router.get(
  "/",
  requireRoles(...readRoles),
  validateQuery(jacketListQuerySchema),
  asyncHandler(ctrl.list),
);

router.get(
  "/check-deal-number",
  requireRoles(...readRoles),
  validateQuery(checkDealNumberQuerySchema),
  asyncHandler(ctrl.checkDealNumber),
);

router.post(
  "/generate-deal-number",
  requireRoles(...writeRoles),
  asyncHandler(ctrl.generateDealNumber),
);

router.post(
  "/",
  requireRoles(...writeRoles),
  validateBody(createJacketSchema),
  asyncHandler(ctrl.create),
);

router.get(
  "/:id",
  requireRoles(...readRoles),
  validateParams(jacketIdParamSchema),
  asyncHandler(ctrl.get),
);

router.patch(
  "/:id",
  requireRoles(...writeRoles),
  validateParams(jacketIdParamSchema),
  validateBody(updateJacketSchema),
  asyncHandler(ctrl.update),
);

router.post(
  "/:id/submit",
  requireRoles(...writeRoles),
  validateParams(jacketIdParamSchema),
  asyncHandler(ctrl.submit),
);

router.post(
  "/:id/request-changes",
  requireRoles("owner", "manager"),
  validateParams(jacketIdParamSchema),
  validateBody(requestChangesSchema),
  asyncHandler(ctrl.requestChanges),
);

router.post(
  "/:id/resubmit",
  requireRoles(...writeRoles),
  validateParams(jacketIdParamSchema),
  asyncHandler(ctrl.resubmit),
);

router.post(
  "/:id/approve",
  requireRoles("owner", "manager"),
  validateParams(jacketIdParamSchema),
  validateBody(approveJacketSchema),
  asyncHandler(ctrl.approve),
);

router.post(
  "/:id/reject",
  requireRoles("owner", "manager"),
  validateParams(jacketIdParamSchema),
  validateBody(rejectJacketSchema),
  asyncHandler(ctrl.reject),
);

router.post(
  "/:id/documents",
  requireRoles(...writeRoles),
  validateParams(jacketIdParamSchema),
  validateBody(addDocumentSchema),
  asyncHandler(ctrl.addDocument),
);

router.put(
  "/:id/documents/sync",
  requireRoles(...writeRoles),
  validateParams(jacketIdParamSchema),
  validateBody(syncDocumentsSchema),
  asyncHandler(ctrl.syncDocuments),
);

router.delete(
  "/:id/documents/:documentId",
  requireRoles(...writeRoles),
  validateParams(jacketDocumentParamSchema),
  asyncHandler(ctrl.removeDocument),
);

router.get(
  "/:id/activity",
  requireRoles(...readRoles),
  validateParams(jacketIdParamSchema),
  asyncHandler(ctrl.activity),
);

export default router;
