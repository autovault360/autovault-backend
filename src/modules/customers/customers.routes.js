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
  WRITE_ROLES,
} from "../../common/auth-middleware.js";
import {
  listCustomersQuerySchema,
  createCustomerSchema,
  updateCustomerSchema,
  createLeadSchema,
  createCustomerNoteSchema,
} from "./customers.schema.js";
import * as ctrl from "./customers.controller.js";

const CUSTOMER_READ_ROLES = [
  "owner",
  "manager",
  "sales_rep",
  "cpa",
  "wholesale_dealer",
  "platform_owner",
];

const customersRouter = express.Router();
customersRouter.use(
  authenticate,
  requireTenant,
  requireRoles(...CUSTOMER_READ_ROLES),
);

customersRouter.get(
  "/",
  validateQuery(listCustomersQuerySchema),
  asyncHandler(ctrl.listCustomers),
);
customersRouter.post(
  "/",
  requireRoles(...WRITE_ROLES),
  validateBody(createCustomerSchema),
  asyncHandler(ctrl.createCustomer),
);
customersRouter.get(
  "/:id",
  validateParams(uuidParam),
  asyncHandler(ctrl.getCustomer),
);
customersRouter.patch(
  "/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(uuidParam),
  validateBody(updateCustomerSchema),
  asyncHandler(ctrl.updateCustomer),
);
customersRouter.delete(
  "/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(uuidParam),
  asyncHandler(ctrl.deleteCustomer),
);
customersRouter.get(
  "/:id/notes",
  validateParams(uuidParam),
  asyncHandler(ctrl.listNotes),
);
customersRouter.post(
  "/:id/notes",
  requireRoles(...WRITE_ROLES),
  validateParams(uuidParam),
  validateBody(createCustomerNoteSchema),
  asyncHandler(ctrl.createNote),
);
customersRouter.post(
  "/:id/convert",
  requireRoles(...WRITE_ROLES),
  validateParams(uuidParam),
  asyncHandler(ctrl.convertLead),
);

const leadsRouter = express.Router();
leadsRouter.use(
  authenticate,
  requireTenant,
  requireRoles(...CUSTOMER_READ_ROLES),
);

leadsRouter.get(
  "/",
  validateQuery(listCustomersQuerySchema),
  asyncHandler(ctrl.listLeads),
);
leadsRouter.post(
  "/",
  requireRoles(...WRITE_ROLES),
  validateBody(createLeadSchema),
  asyncHandler(ctrl.createLead),
);

export { customersRouter, leadsRouter };
