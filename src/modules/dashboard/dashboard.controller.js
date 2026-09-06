import * as dashboardService from "./dashboard.service.js";
import { tenantId } from "../../common/auth-middleware.js";
import { forbidden } from "../../common/errors.js";

export async function getSummary(req, res) {
  const dealershipId = tenantId(req);
  if (!dealershipId) throw forbidden("No dealership context on this account.");

  const result = await dashboardService.summary(
    dealershipId,
    req.auth.role,
    req.auth.userId,
  );
  return res.json({ summary: result });
}

export async function listAuditLogs(req, res) {
  const dealershipId = tenantId(req, req.query.dealershipId);
  if (!dealershipId) throw forbidden("No dealership context on this account.");

  const { page, limit } = req.query;
  const result = await dashboardService.listAuditLogs(dealershipId, {
    page,
    limit,
  });
  return res.json(result);
}
