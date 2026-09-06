import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { serializeDecimals } from "../../common/serialize.js";

function toDecimal(value) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function recalculateTotalInvested(vehicleId, tx = prisma) {
  const vehicle = await tx.vehicle.findFirst({
    where: { id: vehicleId, deletedAt: null },
    include: {
      expenses: { where: { deletedAt: null } },
    },
  });
  if (!vehicle) throw notFound("Vehicle not found.");

  const expenseTotal = vehicle.expenses.reduce(
    (sum, e) => sum + toDecimal(e.totalCost),
    0,
  );

  const totalInvested =
    toDecimal(vehicle.acquisitionCost) +
    toDecimal(vehicle.registrationFees) +
    toDecimal(vehicle.auctionFees) +
    toDecimal(vehicle.flooringFees) +
    toDecimal(vehicle.reconditioningCost) +
    expenseTotal;

  return tx.vehicle.update({
    where: { id: vehicleId },
    data: { totalInvested },
  });
}

function computeTotalCost(data) {
  if (data.totalCost != null) return data.totalCost;
  return (
    (data.laborCost ?? 0) + (data.partsCost ?? 0) + (data.otherFees ?? 0)
  );
}

function serializeExpense(expense) {
  return serializeDecimals(expense);
}

async function assertVehicle(dealershipId, vehicleId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, dealershipId, deletedAt: null },
  });
  if (!vehicle) throw notFound("Vehicle not found.");
  return vehicle;
}

export async function listExpenses(dealershipId, vehicleId) {
  await assertVehicle(dealershipId, vehicleId);
  const expenses = await prisma.vehicleExpense.findMany({
    where: { vehicleId, dealershipId, deletedAt: null },
    orderBy: { repairDate: "desc" },
  });
  return expenses.map(serializeExpense);
}

export async function createExpense(
  dealershipId,
  vehicleId,
  data,
  createdById,
  ipAddress,
) {
  await assertVehicle(dealershipId, vehicleId);
  const totalCost = computeTotalCost(data);

  const expense = await prisma.$transaction(async (tx) => {
    const exp = await tx.vehicleExpense.create({
      data: {
        vehicleId,
        dealershipId,
        createdById,
        repairDate: data.repairDate,
        category: data.category ?? "repair",
        repairType: data.repairType ?? null,
        description: data.description,
        expenseName: data.expenseName ?? null,
        shopVendor: data.shopVendor ?? null,
        paymentMethod: data.paymentMethod ?? null,
        invoiceNumber: data.invoiceNumber ?? null,
        notes: data.notes ?? null,
        laborCost: data.laborCost ?? 0,
        partsCost: data.partsCost ?? 0,
        otherFees: data.otherFees ?? 0,
        totalCost,
        isInternal: data.isInternal ?? false,
        paymentStatus: data.paymentStatus ?? "unpaid",
        datePaid: data.datePaid ?? null,
        receiptStoragePath: data.receiptStoragePath ?? null,
      },
    });

    await recalculateTotalInvested(vehicleId, tx);
    return exp;
  });

  await writeAuditLog({
    dealershipId,
    changedById: createdById,
    entityType: "VehicleExpense",
    entityId: expense.id,
    action: "create",
    newValues: { vehicleId, totalCost },
    ipAddress,
  });

  return serializeExpense(expense);
}

export async function updateExpense(
  dealershipId,
  vehicleId,
  expenseId,
  data,
  changedById,
  ipAddress,
) {
  await assertVehicle(dealershipId, vehicleId);
  const existing = await prisma.vehicleExpense.findFirst({
    where: { id: expenseId, vehicleId, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Expense not found.");

  const merged = {
    laborCost: data.laborCost ?? toDecimal(existing.laborCost),
    partsCost: data.partsCost ?? toDecimal(existing.partsCost),
    otherFees: data.otherFees ?? toDecimal(existing.otherFees),
    totalCost: data.totalCost,
  };
  const totalCost = computeTotalCost(merged);

  const expense = await prisma.$transaction(async (tx) => {
    const exp = await tx.vehicleExpense.update({
      where: { id: expenseId },
      data: { ...data, totalCost },
    });
    await recalculateTotalInvested(vehicleId, tx);
    return exp;
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "VehicleExpense",
    entityId: expenseId,
    action: "update",
    ipAddress,
  });

  return serializeExpense(expense);
}

export async function deleteExpense(
  dealershipId,
  vehicleId,
  expenseId,
  changedById,
  ipAddress,
) {
  await assertVehicle(dealershipId, vehicleId);
  const existing = await prisma.vehicleExpense.findFirst({
    where: { id: expenseId, vehicleId, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Expense not found.");

  const expense = await prisma.$transaction(async (tx) => {
    const exp = await tx.vehicleExpense.update({
      where: { id: expenseId },
      data: { deletedAt: new Date() },
    });
    await recalculateTotalInvested(vehicleId, tx);
    return exp;
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "VehicleExpense",
    entityId: expenseId,
    action: "soft_delete",
    ipAddress,
  });

  return serializeExpense(expense);
}
