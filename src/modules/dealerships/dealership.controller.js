import * as dealershipService from "./dealership.service.js";
import { forbidden } from "../../common/errors.js";

function clientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || null;
}

export async function getMe(req, res) {
  if (!req.auth.dealershipId) {
    throw forbidden("No dealership context on this account.");
  }
  const dealership = await dealershipService.getMe(req.auth.dealershipId);
  return res.json({ dealership });
}

export async function updateMe(req, res) {
  if (!req.auth.dealershipId) {
    throw forbidden("No dealership context on this account.");
  }
  const dealership = await dealershipService.updateMe(
    req.auth.dealershipId,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ dealership });
}

export async function getPreferences(req, res) {
  if (!req.auth.dealershipId) {
    throw forbidden("No dealership context on this account.");
  }
  const result = await dealershipService.getPreferences(req.auth.dealershipId);
  return res.json(result);
}

export async function updatePreferences(req, res) {
  if (!req.auth.dealershipId) {
    throw forbidden("No dealership context on this account.");
  }
  const result = await dealershipService.updatePreferences(
    req.auth.dealershipId,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.json(result);
}

export async function listPlatform(req, res) {
  const result = await dealershipService.listForPlatform(req.query);
  return res.json(result);
}
