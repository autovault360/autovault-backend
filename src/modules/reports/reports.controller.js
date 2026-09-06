import * as reportsService from "./reports.service.js";

export async function profitLoss(req, res) {
  const report = await reportsService.profitLoss(req.auth.dealershipId, req.query);
  return res.json({ report });
}
