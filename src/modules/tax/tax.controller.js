import * as taxService from "./tax.service.js";

function ctx(req) {
  return {
    userId: req.auth.userId,
    ipAddress: req.ip || null,
  };
}

export async function getSettings(req, res) {
  const settings = await taxService.getTaxSettings(req.auth.dealershipId);
  return res.json({ settings });
}

export async function updateSettings(req, res) {
  const settings = await taxService.updateTaxSettings(
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ settings });
}

export async function listPeriods(req, res) {
  const result = await taxService.listTaxPeriods(
    req.auth.dealershipId,
    req.query,
  );
  return res.json(result);
}

export async function createPeriod(req, res) {
  const period = await taxService.createTaxPeriod(
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.status(201).json({ period });
}

export async function getPeriod(req, res) {
  const period = await taxService.getTaxPeriod(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json({ period });
}

export async function updatePeriod(req, res) {
  const period = await taxService.updateTaxPeriod(
    req.params.id,
    req.auth.dealershipId,
    req.body,
  );
  return res.json({ period });
}

export async function updatePeriodStatus(req, res) {
  const period = await taxService.updateTaxPeriodStatus(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ period });
}

export async function deletePeriod(req, res) {
  const result = await taxService.deleteTaxPeriod(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json(result);
}

export async function linkDeal(req, res) {
  const link = await taxService.linkDealToPeriod(
    req.params.id,
    req.auth.dealershipId,
    req.body.dealJacketId,
  );
  return res.status(201).json({ link });
}

export async function unlinkDeal(req, res) {
  const result = await taxService.unlinkDealFromPeriod(
    req.params.id,
    req.auth.dealershipId,
    req.params.dealJacketId,
  );
  return res.json(result);
}

export async function addDocument(req, res) {
  const document = await taxService.addTaxDocument(
    req.params.id,
    req.auth.dealershipId,
    req.body,
  );
  return res.status(201).json({ document });
}

export async function deleteDocument(req, res) {
  const result = await taxService.deleteTaxDocument(
    req.params.id,
    req.auth.dealershipId,
    req.params.documentId,
  );
  return res.json(result);
}
