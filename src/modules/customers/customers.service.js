import { prisma } from "../../lib/prisma.js";
import { notFound, forbidden } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { pageMeta } from "../../common/validate.js";
import { serializeDecimals } from "../../common/serialize.js";

const ADMIN_ROLES = new Set(["owner", "manager", "platform_owner"]);

export function serializeCustomer(customer) {
  if (!customer) return null;
  return serializeDecimals(customer);
}

function serializeNote(note) {
  if (!note) return null;
  return serializeDecimals(note);
}

function isAdmin(role) {
  return ADMIN_ROLES.has(role);
}

function canAccessCustomer(customer, auth) {
  if (isAdmin(auth.role)) return true;
  if (auth.role === "sales_rep") {
    return true;
  }
  if (auth.role === "cpa" || auth.role === "wholesale_dealer") {
    return true;
  }
  return false;
}

function canWriteCustomer(customer, auth) {
  if (isAdmin(auth.role)) return true;
  if (auth.role === "sales_rep") {
    if (!customer) return true;
    return (
      customer.salesRepId === auth.userId ||
      customer.createdById === auth.userId
    );
  }
  return false;
}

function assertRead(customer, auth) {
  if (!canAccessCustomer(customer, auth)) {
    throw forbidden("You do not have access to this customer.");
  }
}

function assertWrite(customer, auth) {
  if (!canWriteCustomer(customer, auth)) {
    throw forbidden("You do not have permission to modify this customer.");
  }
}

async function findCustomer(dealershipId, customerId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, dealershipId, deletedAt: null },
    include: {
      customerNotes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) throw notFound("Customer not found.");
  return customer;
}

export async function listCustomers(dealershipId, query, auth) {
  const { page, limit, q, status, salesRepId, type } = query;
  const where = { dealershipId, deletedAt: null };

  if (status) where.status = status;
  if (type) where.type = type;
  if (salesRepId) where.salesRepId = salesRepId;

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    customers: rows.map(serializeCustomer),
    meta: pageMeta(total, page, limit),
  };
}

export async function listLeads(dealershipId, query, auth) {
  return listCustomers(
    dealershipId,
    { ...query, status: "lead" },
    auth,
  );
}

export async function getCustomer(dealershipId, customerId, auth) {
  const customer = await findCustomer(dealershipId, customerId);
  assertRead(customer, auth);
  return serializeCustomer(customer);
}

export async function createCustomer(
  dealershipId,
  data,
  auth,
  ipAddress,
  forceLead = false,
) {
  assertWrite(null, auth);

  const salesRepId =
    data.salesRepId ??
    (auth.role === "sales_rep" ? auth.userId : null);

  const customer = await prisma.customer.create({
    data: {
      dealershipId,
      createdById: auth.userId,
      type: data.type ?? "individual",
      name: data.name,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      address2: data.address2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      driversLicenseNumber: data.driversLicenseNumber ?? null,
      imageUrl: data.imageUrl ?? null,
      status: forceLead ? "lead" : (data.status ?? "lead"),
      salesRepId,
      source: data.source ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      notes: data.notes ?? null,
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: auth.userId,
    entityType: "Customer",
    entityId: customer.id,
    action: "create",
    newValues: { name: customer.name, status: customer.status },
    ipAddress,
  });

  return serializeCustomer(customer);
}

export async function updateCustomer(
  dealershipId,
  customerId,
  data,
  auth,
  ipAddress,
) {
  const existing = await findCustomer(dealershipId, customerId);
  assertWrite(existing, auth);

  if (data.status === "customer" && existing.status === "lead") {
    const updated = await prisma.customer.update({
      where: { id: customerId },
      data,
    });
    await writeAuditLog({
      dealershipId,
      changedById: auth.userId,
      entityType: "Customer",
      entityId: customerId,
      action: "convert_lead",
      oldValues: { status: "lead" },
      newValues: { status: "customer" },
      ipAddress,
    });
    return serializeCustomer(updated);
  }

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data,
  });

  await writeAuditLog({
    dealershipId,
    changedById: auth.userId,
    entityType: "Customer",
    entityId: customerId,
    action: "update",
    oldValues: { status: existing.status },
    newValues: { status: updated.status },
    ipAddress,
  });

  return serializeCustomer(updated);
}

export async function deleteCustomer(
  dealershipId,
  customerId,
  auth,
  ipAddress,
) {
  const existing = await findCustomer(dealershipId, customerId);
  assertWrite(existing, auth);

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    dealershipId,
    changedById: auth.userId,
    entityType: "Customer",
    entityId: customerId,
    action: "soft_delete",
    ipAddress,
  });

  return serializeCustomer(updated);
}

export async function convertLeadToCustomer(
  dealershipId,
  customerId,
  auth,
  ipAddress,
) {
  const existing = await findCustomer(dealershipId, customerId);
  assertWrite(existing, auth);

  if (existing.status !== "lead") {
    throw forbidden("Only leads can be converted to customers.");
  }

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { status: "customer" },
  });

  await writeAuditLog({
    dealershipId,
    changedById: auth.userId,
    entityType: "Customer",
    entityId: customerId,
    action: "convert_lead",
    oldValues: { status: "lead" },
    newValues: { status: "customer" },
    ipAddress,
  });

  return serializeCustomer(updated);
}

export async function listNotes(dealershipId, customerId, auth) {
  const customer = await findCustomer(dealershipId, customerId);
  assertRead(customer, auth);
  const notes = await prisma.customerNote.findMany({
    where: { customerId, dealershipId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return notes.map(serializeNote);
}

export async function createNote(
  dealershipId,
  customerId,
  data,
  auth,
  ipAddress,
) {
  const customer = await findCustomer(dealershipId, customerId);
  assertWrite(customer, auth);

  const note = await prisma.customerNote.create({
    data: {
      customerId,
      dealershipId,
      body: data.body,
      createdById: auth.userId,
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: auth.userId,
    entityType: "CustomerNote",
    entityId: note.id,
    action: "create",
    newValues: { customerId },
    ipAddress,
  });

  return serializeNote(note);
}
