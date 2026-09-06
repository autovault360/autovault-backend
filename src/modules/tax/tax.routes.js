import express from "express";
import { z } from "zod";
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
  updateTaxSettingsSchema,
  createTaxPeriodSchema,
  updateTaxPeriodSchema,
  updateTaxPeriodStatusSchema,
  linkDealSchema,
  addTaxDocumentSchema,
  taxPeriodListQuerySchema,
  periodIdParamSchema,
  periodDealParamSchema,
} from "./tax.schema.js";
import * as ctrl from "./tax.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant);

const taxReadRoles = [...READ_FINANCE_ROLES];
const taxWriteRoles = ["owner", "manager"];

router.get(
  "/settings",
  requireRoles(...taxReadRoles),
  asyncHandler(ctrl.getSettings),
);

router.patch(
  "/settings",
  requireRoles(...taxWriteRoles),
  validateBody(updateTaxSettingsSchema),
  asyncHandler(ctrl.updateSettings),
);

router.get(
  "/periods",
  requireRoles(...taxReadRoles),
  validateQuery(taxPeriodListQuerySchema),
  asyncHandler(ctrl.listPeriods),
);

router.post(
  "/periods",
  requireRoles(...taxWriteRoles),
  validateBody(createTaxPeriodSchema),
  asyncHandler(ctrl.createPeriod),
);

router.get(
  "/periods/:id",
  requireRoles(...taxReadRoles),
  validateParams(periodIdParamSchema),
  asyncHandler(ctrl.getPeriod),
);

router.patch(
  "/periods/:id",
  requireRoles(...taxWriteRoles),
  validateParams(periodIdParamSchema),
  validateBody(updateTaxPeriodSchema),
  asyncHandler(ctrl.updatePeriod),
);

router.post(
  "/periods/:id/status",
  requireRoles(...taxWriteRoles),
  validateParams(periodIdParamSchema),
  validateBody(updateTaxPeriodStatusSchema),
  asyncHandler(ctrl.updatePeriodStatus),
);

router.delete(
  "/periods/:id",
  requireRoles(...taxWriteRoles),
  validateParams(periodIdParamSchema),
  asyncHandler(ctrl.deletePeriod),
);

router.post(
  "/periods/:id/deals",
  requireRoles(...taxWriteRoles),
  validateParams(periodIdParamSchema),
  validateBody(linkDealSchema),
  asyncHandler(ctrl.linkDeal),
);

router.delete(
  "/periods/:id/deals/:dealJacketId",
  requireRoles(...taxWriteRoles),
  validateParams(periodDealParamSchema),
  asyncHandler(ctrl.unlinkDeal),
);

router.post(
  "/periods/:id/documents",
  requireRoles(...taxWriteRoles),
  validateParams(periodIdParamSchema),
  validateBody(addTaxDocumentSchema),
  asyncHandler(ctrl.addDocument),
);

const documentIdParamSchema = periodIdParamSchema.extend({
  documentId: z.string().uuid(),
});

router.delete(
  "/periods/:id/documents/:documentId",
  requireRoles(...taxWriteRoles),
  validateParams(documentIdParamSchema),
  asyncHandler(ctrl.deleteDocument),
);

export default router;
