import * as payrollService from "./payroll.service.js";

function ctx(req) {
  return {
    userId: req.auth.userId,
    role: req.auth.role,
    plan: req.auth.plan || null,
    impersonation: !!req.auth.impersonation,
    ipAddress: req.ip || null,
  };
}

export async function listSalesReps(req, res) {
  const result = await payrollService.listSalesReps(
    req.auth.dealershipId,
    req.query,
  );
  return res.json(result);
}

export async function createSalesRep(req, res) {
  const result = await payrollService.createSalesRep(
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.status(201).json(result);
}

export async function checkSalesRepAvailability(req, res) {
  const result = await payrollService.findLoginIdentityConflicts({
    email: req.query.email,
    username: req.query.username,
    excludeUserId: req.query.excludeUserId,
  });
  return res.json(result);
}

export async function updateSalesRep(req, res) {
  const salesRep = await payrollService.updateSalesRep(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ salesRep });
}

export async function getSalesRepArchivePreview(req, res) {
  const preview = await payrollService.getSalesRepArchivePreview(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json(preview);
}

export async function archiveSalesRep(req, res) {
  const result = await payrollService.archiveSalesRep(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json(result);
}

export async function sendRepInvite(req, res) {
  const result = await payrollService.sendRepInvite(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json(result);
}

export async function impersonateSalesRep(req, res) {
  const result = await payrollService.impersonateSalesRep(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
    { purpose: req.body?.purpose || "support" },
  );
  return res.json(result);
}

export async function listStaff(req, res) {
  const result = await payrollService.listStaff(
    req.auth.dealershipId,
    req.query,
  );
  return res.json(result);
}

export async function getStaff(req, res) {
  const staff = await payrollService.getStaff(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json({ staff });
}

export async function createStaff(req, res) {
  const staff = await payrollService.createStaff(
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.status(201).json({ staff });
}

export async function updateStaff(req, res) {
  const staff = await payrollService.updateStaff(
    req.params.id,
    req.auth.dealershipId,
    req.body,
  );
  return res.json({ staff });
}

export async function deleteStaff(req, res) {
  const result = await payrollService.deleteStaff(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json(result);
}

export async function listCommissions(req, res) {
  const result = await payrollService.listCommissions(
    req.auth.dealershipId,
    req.query,
    ctx(req),
  );
  return res.json(result);
}

export async function updateCommission(req, res) {
  const commission = await payrollService.updateCommission(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ commission });
}

export async function markCommissionPaid(req, res) {
  const commission = await payrollService.markCommissionPaid(
    req.params.id,
    req.auth.dealershipId,
    ctx(req),
  );
  return res.json({ commission });
}

export async function listPayrollRuns(req, res) {
  const result = await payrollService.listPayrollRuns(
    req.auth.dealershipId,
    req.query,
  );
  return res.json(result);
}

export async function getPayrollHistory(req, res) {
  const result = await payrollService.getPayrollHistory(
    req.auth.dealershipId,
    req.query,
    ctx(req),
  );
  return res.json(result);
}

export async function getPayrollRun(req, res) {
  const payrollRun = await payrollService.getPayrollRun(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json({ payrollRun });
}

export async function createPayrollRun(req, res) {
  const payrollRun = await payrollService.createPayrollRun(
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.status(201).json({ payrollRun });
}

export async function updatePayrollRun(req, res) {
  const payrollRun = await payrollService.updatePayrollRun(
    req.params.id,
    req.auth.dealershipId,
    req.body,
    ctx(req),
  );
  return res.json({ payrollRun });
}

export async function deletePayrollRun(req, res) {
  const result = await payrollService.deletePayrollRun(
    req.params.id,
    req.auth.dealershipId,
  );
  return res.json(result);
}
