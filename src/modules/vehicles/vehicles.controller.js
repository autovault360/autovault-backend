import * as vehiclesService from "./vehicles.service.js";
import * as expensesService from "./vehicle-expenses.service.js";
import * as flooringService from "./flooring.service.js";
import { tenantId } from "../../common/auth-middleware.js";
import { forbidden } from "../../common/errors.js";

function clientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || null;
}

function dealershipId(req) {
  const id = tenantId(req, req.query.dealershipId);
  if (!id) throw forbidden("No dealership context on this account.");
  return id;
}

// Vehicles
export async function listVehicles(req, res) {
  const result = await vehiclesService.listVehicles(dealershipId(req), req.query);
  return res.json(result);
}

export async function getInventoryStats(req, res) {
  const stats = await vehiclesService.getInventoryStats(
    dealershipId(req),
    req.query,
  );
  return res.json({ stats });
}

export async function getVehicle(req, res) {
  const vehicle = await vehiclesService.getVehicle(
    dealershipId(req),
    req.params.id,
  );
  return res.json({ vehicle });
}

export async function createVehicle(req, res) {
  const vehicle = await vehiclesService.createVehicle(
    dealershipId(req),
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.status(201).json({ vehicle });
}

export async function updateVehicle(req, res) {
  const vehicle = await vehiclesService.updateVehicle(
    dealershipId(req),
    req.params.id,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ vehicle });
}

export async function deleteVehicle(req, res) {
  const vehicle = await vehiclesService.deleteVehicle(
    dealershipId(req),
    req.params.id,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ vehicle });
}

export async function changeStatus(req, res) {
  const vehicle = await vehiclesService.changeVehicleStatus(
    dealershipId(req),
    req.params.id,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ vehicle });
}

// Expenses
export async function listExpenses(req, res) {
  const expenses = await expensesService.listExpenses(
    dealershipId(req),
    req.params.id,
  );
  return res.json({ expenses });
}

export async function createExpense(req, res) {
  const expense = await expensesService.createExpense(
    dealershipId(req),
    req.params.id,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.status(201).json({ expense });
}

export async function updateExpense(req, res) {
  const expense = await expensesService.updateExpense(
    dealershipId(req),
    req.params.id,
    req.params.expenseId,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ expense });
}

export async function deleteExpense(req, res) {
  const expense = await expensesService.deleteExpense(
    dealershipId(req),
    req.params.id,
    req.params.expenseId,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ expense });
}

// Flooring
export async function listFlooringPlans(req, res) {
  const plans = await flooringService.listFlooringPlans(dealershipId(req));
  return res.json({ plans });
}

export async function createFlooringPlan(req, res) {
  const plan = await flooringService.createFlooringPlan(
    dealershipId(req),
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.status(201).json({ plan });
}

export async function updateFlooringPlan(req, res) {
  const plan = await flooringService.updateFlooringPlan(
    dealershipId(req),
    req.params.id,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ plan });
}

export async function deleteFlooringPlan(req, res) {
  const plan = await flooringService.deleteFlooringPlan(
    dealershipId(req),
    req.params.id,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ plan });
}

export async function flooringBreakdown(req, res) {
  const result = await flooringService.getFlooringBreakdown(
    dealershipId(req),
    req.query,
  );
  return res.json(result);
}

export async function getFlooringUndo(req, res) {
  const undo = await flooringService.getFlooringUndo(dealershipId(req));
  return res.json({ undo });
}

export async function saveFlooringUndo(req, res) {
  const undo = await flooringService.saveFlooringUndo(
    dealershipId(req),
    req.body || {},
    req.auth.userId,
    clientIp(req),
  );
  return res.status(201).json({ undo });
}

export async function restoreFlooringUndo(req, res) {
  const result = await flooringService.restoreFlooringUndo(
    dealershipId(req),
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ ok: true, ...result, undo: null });
}

export async function clearFlooringUndo(req, res) {
  const result = await flooringService.clearFlooringUndo(
    dealershipId(req),
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ ok: true, ...result, undo: null });
}
