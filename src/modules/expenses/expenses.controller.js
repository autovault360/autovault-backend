import * as expensesService from "./expenses.service.js";

function ctx(req) {
  return {
    userId: req.auth.userId,
    ipAddress: req.ip || null,
  };
}

export async function list(req, res) {
  const result = await expensesService.listExpenses(
    req.auth.dealershipId,
    req.query,
  );
  return res.json(result);
}

export async function get(req, res) {
  const expense = await expensesService.getExpense(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json({ expense });
}

export async function create(req, res) {
  const expense = await expensesService.createExpense(
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.status(201).json({ expense });
}

export async function update(req, res) {
  const expense = await expensesService.updateExpense(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ expense });
}

export async function remove(req, res) {
  const result = await expensesService.deleteExpense(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json(result);
}
