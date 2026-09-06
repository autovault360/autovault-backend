import * as dealsService from "./deals.service.js";

function ctx(req) {
  return {
    dealershipId: req.auth.dealershipId,
    userId: req.auth.userId,
    role: req.auth.role,
    actorName: req.user?.fullName ?? req.auth.name ?? "User",
    ipAddress: req.ip || null,
  };
}

export async function markSold(req, res) {
  const result = await dealsService.markSold(req.params.id, req.body, ctx(req));
  return res.status(201).json(result);
}

export async function importPreviousSold(req, res) {
  const result = await dealsService.importPreviousSold(req.body, {
    ...ctx(req),
    plan: req.auth?.plan || null,
  });
  return res.status(201).json(result);
}

export async function markLoss(req, res) {
  const result = await dealsService.markLoss(req.params.id, req.body, ctx(req));
  return res.json({ vehicle: result });
}

export async function listSoldVehicles(req, res) {
  const result = await dealsService.listSoldVehicles(
    req.auth.dealershipId,
    req.query,
  );
  return res.json(result);
}
