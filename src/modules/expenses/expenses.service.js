import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { toNum } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";
import { normalizeExpenseCategory } from "./expense-categories.js";

function serializeExpense(e) {
  if (!e) return null;
  const { category, subcategory } = normalizeExpenseCategory(
    e.category,
    e.subcategory,
    e.vehicleVin,
  );
  return {
    id: e.id,
    dealershipId: e.dealershipId,
    expenseDate: e.expenseDate,
    category,
    subcategory,
    expType: subcategory,
    name: e.name,
    vendor: e.vendor,
    description: e.description,
    amount: toNum(e.amount),
    status: e.status,
    recurringFrequency: e.recurringFrequency,
    vehicleVin: e.vehicleVin,
    referenceNumber: e.referenceNumber,
    paymentMethod: e.paymentMethod,
    receiptStoragePath: e.receiptStoragePath,
    notes: e.notes,
    taxDeductible: e.taxDeductible,
    isRecurring: e.isRecurring,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export async function listExpenses(dealershipId, query) {
  const { page, limit, q, category, subcategory, status, from, to, vehicleVin } =
    query;
  const where = { dealershipId, deletedAt: null };

  if (category) where.category = category;
  if (subcategory) where.subcategory = subcategory;
  if (status) where.status = status;
  if (vehicleVin) where.vehicleVin = vehicleVin;
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = from;
    if (to) where.expenseDate.lte = to;
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { vendor: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { referenceNumber: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { vehicleVin: { contains: q, mode: "insensitive" } },
      { subcategory: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.dealershipExpense.count({ where }),
    prisma.dealershipExpense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    expenses: rows.map(serializeExpense),
    meta: pageMeta(total, page, limit),
  };
}

export async function getExpense(id, dealershipId) {
  const expense = await prisma.dealershipExpense.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!expense) throw notFound("Expense not found.");
  return serializeExpense(expense);
}

export async function createExpense(dealershipId, payload, ctx) {
  const subcategory = payload.subcategory || payload.expType || "Other";
  const expense = await prisma.dealershipExpense.create({
    data: {
      dealershipId,
      expenseDate: payload.expenseDate,
      category: payload.category,
      subcategory,
      name: payload.name,
      vendor: payload.vendor?.trim() ?? payload.name?.trim() ?? "",
      description: payload.description?.trim() ?? payload.name?.trim() ?? "",
      amount: payload.amount,
      status: payload.status ?? "unpaid",
      recurringFrequency: payload.recurringFrequency ?? "One-Time",
      vehicleVin: payload.vehicleVin ?? null,
      referenceNumber: payload.referenceNumber ?? null,
      paymentMethod: payload.paymentMethod ?? null,
      receiptStoragePath: payload.receiptStoragePath ?? null,
      notes: payload.notes ?? null,
      taxDeductible: payload.taxDeductible ?? true,
      isRecurring:
        payload.isRecurring ??
        (payload.recurringFrequency &&
          payload.recurringFrequency !== "One-Time"),
      createdById: ctx.userId,
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "DealershipExpense",
    entityId: expense.id,
    action: "create",
    newValues: serializeExpense(expense),
    ipAddress: ctx.ipAddress,
  });

  return serializeExpense(expense);
}

export async function updateExpense(id, dealershipId, payload, ctx) {
  const existing = await prisma.dealershipExpense.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Expense not found.");

  const subcategory =
    payload.subcategory !== undefined
      ? payload.subcategory
      : payload.expType !== undefined
        ? payload.expType
        : undefined;

  const expense = await prisma.dealershipExpense.update({
    where: { id },
    data: {
      ...(payload.expenseDate != null && { expenseDate: payload.expenseDate }),
      ...(payload.category != null && { category: payload.category }),
      ...(subcategory !== undefined && { subcategory }),
      ...(payload.name != null && { name: payload.name }),
      ...(payload.vendor !== undefined && {
        vendor: payload.vendor?.trim() ?? "",
      }),
      ...(payload.description !== undefined && {
        description: payload.description?.trim() ?? "",
      }),
      ...(payload.amount != null && { amount: payload.amount }),
      ...(payload.status != null && { status: payload.status }),
      ...(payload.recurringFrequency != null && {
        recurringFrequency: payload.recurringFrequency,
      }),
      ...(payload.vehicleVin !== undefined && {
        vehicleVin: payload.vehicleVin,
      }),
      ...(payload.referenceNumber !== undefined && {
        referenceNumber: payload.referenceNumber,
      }),
      ...(payload.paymentMethod !== undefined && {
        paymentMethod: payload.paymentMethod,
      }),
      ...(payload.receiptStoragePath !== undefined && {
        receiptStoragePath: payload.receiptStoragePath,
      }),
      ...(payload.notes !== undefined && { notes: payload.notes }),
      ...(payload.taxDeductible != null && {
        taxDeductible: payload.taxDeductible,
      }),
      ...(payload.isRecurring != null && { isRecurring: payload.isRecurring }),
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "DealershipExpense",
    entityId: id,
    action: "update",
    oldValues: serializeExpense(existing),
    newValues: serializeExpense(expense),
    ipAddress: ctx.ipAddress,
  });

  return serializeExpense(expense);
}

export async function deleteExpense(id, dealershipId, ctx) {
  const existing = await prisma.dealershipExpense.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Expense not found.");

  await prisma.dealershipExpense.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "DealershipExpense",
    entityId: id,
    action: "soft_delete",
    ipAddress: ctx.ipAddress,
  });

  return { message: "Expense deleted." };
}
