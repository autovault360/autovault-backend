import * as jacketsService from "./jackets.service.js";

function ctx(req) {
  return {
    dealershipId: req.auth.dealershipId,
    userId: req.auth.userId,
    role: req.auth.role,
    actorName: req.user?.fullName ?? req.auth.name ?? "User",
    ipAddress: req.ip || null,
  };
}

export async function list(req, res) {
  const result = await jacketsService.listJackets(
    req.auth.dealershipId,
    req.query,
    ctx(req),
  );
  return res.json(result);
}

export async function checkDealNumber(req, res) {
  const result = await jacketsService.checkDealNumber(
    req.auth.dealershipId,
    req.query,
  );
  return res.json(result);
}

export async function generateDealNumber(req, res) {
  const result = await jacketsService.generateDealNumber(
    req.auth.dealershipId,
    {
      excludeJacketId: req.query.excludeJacketId,
      excludeVehicleId: req.query.excludeVehicleId,
    },
  );
  return res.json(result);
}

export async function create(req, res) {
  const jacket = await jacketsService.createJacket(
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.status(201).json({ dealJacket: jacket });
}

export async function get(req, res) {
  const jacket = await jacketsService.getJacket(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json({ dealJacket: jacket });
}

export async function update(req, res) {
  const jacket = await jacketsService.updateJacket(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ dealJacket: jacket });
}

export async function submit(req, res) {
  const jacket = await jacketsService.submitJacket(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json({ dealJacket: jacket });
}

export async function requestChanges(req, res) {
  const jacket = await jacketsService.requestChanges(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ dealJacket: jacket });
}

export async function resubmit(req, res) {
  const jacket = await jacketsService.resubmitJacket(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json({ dealJacket: jacket });
}

export async function approve(req, res) {
  const jacket = await jacketsService.approveJacket(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ dealJacket: jacket });
}

export async function reject(req, res) {
  const jacket = await jacketsService.rejectJacket(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ dealJacket: jacket });
}

export async function addDocument(req, res) {
  const doc = await jacketsService.addDocument(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.status(201).json({ document: doc });
}

export async function removeDocument(req, res) {
  const doc = await jacketsService.removeDocument(
    req.params.id,
    req.params.documentId,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json({ document: doc });
}

export async function syncDocuments(req, res) {
  const result = await jacketsService.syncDocuments(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json(result);
}

export async function activity(req, res) {
  const rows = await jacketsService.getActivity(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json({ activity: rows });
}
