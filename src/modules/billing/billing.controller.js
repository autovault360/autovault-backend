import * as billingService from "./billing.service.js";

export async function getBilling(req, res) {
  const billing = await billingService.getBilling(req.auth.dealershipId);
  return res.json({ billing });
}

export async function getBillingHistory(req, res) {
  const result = await billingService.getBillingHistory(req.auth.dealershipId);
  return res.json(result);
}

export async function listPlans(req, res) {
  const result = await billingService.listPlans(req.auth.dealershipId);
  return res.json(result);
}

export async function createCheckout(req, res) {
  const result = await billingService.createBillingCheckout(
    req.auth.dealershipId,
    req.body,
  );
  return res.json(result);
}

export async function createPortal(req, res) {
  const result = await billingService.createBillingPortal(req.auth.dealershipId);
  return res.json(result);
}

export async function updateSettings(req, res) {
  const result = await billingService.updateBillingSettings(
    req.auth.dealershipId,
    req.body,
  );
  return res.json(result);
}
