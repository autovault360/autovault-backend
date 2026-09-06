import * as customersService from "./customers.service.js";
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

export async function listCustomers(req, res) {
  const result = await customersService.listCustomers(
    dealershipId(req),
    req.query,
    req.auth,
  );
  return res.json(result);
}

export async function listLeads(req, res) {
  const result = await customersService.listLeads(
    dealershipId(req),
    req.query,
    req.auth,
  );
  return res.json(result);
}

export async function getCustomer(req, res) {
  const customer = await customersService.getCustomer(
    dealershipId(req),
    req.params.id,
    req.auth,
  );
  return res.json({ customer });
}

export async function createCustomer(req, res) {
  const customer = await customersService.createCustomer(
    dealershipId(req),
    req.body,
    req.auth,
    clientIp(req),
  );
  return res.status(201).json({ customer });
}

export async function createLead(req, res) {
  const customer = await customersService.createCustomer(
    dealershipId(req),
    req.body,
    req.auth,
    clientIp(req),
    true,
  );
  return res.status(201).json({ customer });
}

export async function updateCustomer(req, res) {
  const customer = await customersService.updateCustomer(
    dealershipId(req),
    req.params.id,
    req.body,
    req.auth,
    clientIp(req),
  );
  return res.json({ customer });
}

export async function deleteCustomer(req, res) {
  const customer = await customersService.deleteCustomer(
    dealershipId(req),
    req.params.id,
    req.auth,
    clientIp(req),
  );
  return res.json({ customer });
}

export async function listNotes(req, res) {
  const notes = await customersService.listNotes(
    dealershipId(req),
    req.params.id,
    req.auth,
  );
  return res.json({ notes });
}

export async function createNote(req, res) {
  const note = await customersService.createNote(
    dealershipId(req),
    req.params.id,
    req.body,
    req.auth,
    clientIp(req),
  );
  return res.status(201).json({ note });
}

export async function convertLead(req, res) {
  const customer = await customersService.convertLeadToCustomer(
    dealershipId(req),
    req.params.id,
    req.auth,
    clientIp(req),
  );
  return res.json({ customer });
}
