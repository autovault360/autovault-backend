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
  requireFeature,
  requireExactPlan,
} from "../../common/auth-middleware.js";
import {
  periodQuerySchema,
  listVehiclesQuerySchema,
  vehicleIdParamSchema,
  createVehicleSchema,
  updateVehicleSchema,
  updateStatusSchema,
  recordSaleSchema,
  listExpensesQuerySchema,
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParamSchema,
  calendarNotesQuerySchema,
  upsertDayNoteSchema,
} from "./wholesale.schema.js";
import * as wholesaleService from "./wholesale.service.js";

const WHOLESALE_ROLES = ["wholesale_dealer", "platform_owner"];

const router = express.Router();

router.use(
  authenticate,
  requireTenant,
  requireRoles(...WHOLESALE_ROLES),
  requireFeature("wholesaleCrm"),
);

// platform_owner may assist without wholesaler plan; dealers must be exact plan
router.use((req, res, next) => {
  if (req.auth?.role === "platform_owner") return next();
  return requireExactPlan("wholesaler")(req, res, next);
});

router.get(
  "/overview",
  validateQuery(periodQuerySchema),
  asyncHandler(async (req, res) => {
    const overview = await wholesaleService.overview(
      req.auth.dealershipId,
      req.query,
    );
    return res.json({ overview });
  }),
);

router.get(
  "/vehicles",
  validateQuery(listVehiclesQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await wholesaleService.listVehicles(
      req.auth.dealershipId,
      req.query,
    );
    return res.json(result);
  }),
);

router.post(
  "/vehicles",
  validateBody(createVehicleSchema),
  asyncHandler(async (req, res) => {
    const vehicle = await wholesaleService.createVehicle(
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.status(201).json({ vehicle });
  }),
);

router.get(
  "/vehicles/:id",
  validateParams(vehicleIdParamSchema),
  asyncHandler(async (req, res) => {
    const vehicle = await wholesaleService.getVehicle(
      req.auth.dealershipId,
      req.params.id,
    );
    return res.json({ vehicle });
  }),
);

router.patch(
  "/vehicles/:id",
  validateParams(vehicleIdParamSchema),
  validateBody(updateVehicleSchema),
  asyncHandler(async (req, res) => {
    const vehicle = await wholesaleService.updateVehicle(
      req.auth.dealershipId,
      req.params.id,
      req.body,
    );
    return res.json({ vehicle });
  }),
);

router.patch(
  "/vehicles/:id/status",
  validateParams(vehicleIdParamSchema),
  validateBody(updateStatusSchema),
  asyncHandler(async (req, res) => {
    const vehicle = await wholesaleService.updateStatus(
      req.auth.dealershipId,
      req.params.id,
      req.body,
    );
    return res.json({ vehicle });
  }),
);

router.post(
  "/vehicles/:id/sale",
  validateParams(vehicleIdParamSchema),
  validateBody(recordSaleSchema),
  asyncHandler(async (req, res) => {
    const vehicle = await wholesaleService.recordSale(
      req.auth.dealershipId,
      req.params.id,
      req.body,
    );
    return res.json({ vehicle });
  }),
);

router.get(
  "/sold",
  validateQuery(periodQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await wholesaleService.listSold(
      req.auth.dealershipId,
      req.query,
    );
    return res.json(result);
  }),
);

router.get(
  "/expenses",
  validateQuery(listExpensesQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await wholesaleService.listExpenses(
      req.auth.dealershipId,
      req.query,
    );
    return res.json(result);
  }),
);

router.post(
  "/expenses",
  validateBody(createExpenseSchema),
  asyncHandler(async (req, res) => {
    const expense = await wholesaleService.createExpense(
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.status(201).json({ expense });
  }),
);

router.patch(
  "/expenses/:id",
  validateParams(expenseIdParamSchema),
  validateBody(updateExpenseSchema),
  asyncHandler(async (req, res) => {
    const expense = await wholesaleService.updateExpense(
      req.auth.dealershipId,
      req.params.id,
      req.body,
    );
    return res.json({ expense });
  }),
);

router.delete(
  "/expenses/:id",
  validateParams(expenseIdParamSchema),
  asyncHandler(async (req, res) => {
    await wholesaleService.deleteExpense(req.auth.dealershipId, req.params.id);
    return res.json({ ok: true });
  }),
);

router.get(
  "/pnl",
  validateQuery(periodQuerySchema),
  asyncHandler(async (req, res) => {
    const pnl = await wholesaleService.profitLoss(
      req.auth.dealershipId,
      req.query,
    );
    return res.json({ pnl });
  }),
);

router.get(
  "/calendar-notes",
  validateQuery(calendarNotesQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await wholesaleService.listCalendarNotes(
      req.auth.dealershipId,
      req.query,
    );
    return res.json(result);
  }),
);

router.put(
  "/calendar-notes",
  validateBody(upsertDayNoteSchema),
  asyncHandler(async (req, res) => {
    const note = await wholesaleService.upsertDayNote(
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.json({ note });
  }),
);

export default router;
