import { prisma } from "../../lib/prisma.js";
import { notFound, conflict } from "../../common/errors.js";
import { toNum, serializeRecord } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";
import {
  expenseAmountInRange,
} from "../expenses/recurring-expenses.js";

function resolveRange(query = {}) {
  if (query.from || query.to) {
    return { from: query.from || new Date(2000, 0, 1), to: query.to || new Date() };
  }
  const now = new Date();
  const year = query.year || now.getFullYear();
  const mode = query.mode || (query.month != null ? "month" : "year");
  if (mode === "month") {
    const month = (query.month || now.getMonth() + 1) - 1;
    return {
      from: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
      to: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
    };
  }
  return {
    from: new Date(Date.UTC(year, 0, 1, 0, 0, 0)),
    to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  };
}

function datePrefix(d) {
  if (!d) return "";
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return x.toISOString().slice(0, 10);
}

function feesObj(vehicle) {
  const raw = vehicle?.fees;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...raw };
}

function isFloored(vehicle) {
  const fees = feesObj(vehicle);
  return !!(
    vehicle.flooringPlanId ||
    vehicle.flooringStartDate ||
    (toNum(vehicle.flooringFees) || 0) > 0 ||
    fees.floored === true
  );
}

function flooringOverrideOf(vehicle) {
  const fees = feesObj(vehicle);
  if (fees.flooringOverride != null) return toNum(fees.flooringOverride);
  return null;
}

function investedOf(vehicle) {
  const repairs = toNum(vehicle.reconditioningCost) || 0;
  const floor =
    flooringOverrideOf(vehicle) != null
      ? flooringOverrideOf(vehicle)
      : toNum(vehicle.flooringFees) || 0;
  return (
    (toNum(vehicle.acquisitionCost) || 0) +
    (toNum(vehicle.auctionFees) || 0) +
    repairs +
    floor +
    (toNum(vehicle.additionalExpenses) || 0)
  );
}

function isSold(vehicle) {
  return (
    vehicle.status === "sold" ||
    vehicle.status === "out_of_state_sale" ||
    !!vehicle.soldAt
  );
}

function isNoSale(vehicle) {
  return vehicle.status === "loss" || vehicle.status === "wholesale";
}

export function serializeWholesaleVehicle(vehicle) {
  if (!vehicle) return null;
  const sold = isSold(vehicle);
  const soldPrice = toNum(vehicle.soldPrice) || 0;
  const cost = toNum(vehicle.acquisitionCost) || 0;
  const invested = investedOf(vehicle);
  const gross = sold ? soldPrice - cost : 0;
  const net = sold ? soldPrice - invested : 0;
  return serializeRecord({
    id: vehicle.id,
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    acquisitionDate: vehicle.acquisitionDate,
    acquisitionCost: cost,
    auctionFees: toNum(vehicle.auctionFees) || 0,
    reconditioningCost: toNum(vehicle.reconditioningCost) || 0,
    flooringFees: toNum(vehicle.flooringFees) || 0,
    flooringOverride: flooringOverrideOf(vehicle),
    floored: isFloored(vehicle),
    totalInvested: invested,
    status: vehicle.status,
    sold,
    soldAt: vehicle.soldAt,
    soldPrice: sold ? soldPrice : null,
    titlePresent: vehicle.titlePresent ?? vehicle.titleReceived !== false,
    titleReceived: vehicle.titleReceived,
    isWholesale: !!vehicle.isWholesale,
    auctionHouse: vehicle.auctionHouse || vehicle.sellerAuction || null,
    auctionDate: vehicle.auctionDate,
    auctionRuns: vehicle.auctionRuns ?? 0,
    saleChannel: vehicle.saleChannel || null,
    notes: vehicle.notes,
    result: sold ? "sold" : isNoSale(vehicle) ? "no-sale" : null,
    grossProfit: gross,
    netProfit: net,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  });
}

function serializeExpense(e) {
  if (!e) return null;
  return {
    id: e.id,
    expenseDate: e.expenseDate,
    date: datePrefix(e.expenseDate),
    category: e.category,
    cat: e.category,
    name: e.name,
    vendor: e.vendor,
    description: e.description,
    amount: toNum(e.amount),
    status: e.status,
    vehicleVin: e.vehicleVin,
    notes: e.notes,
    taxDeductible: e.taxDeductible,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export async function overview(dealershipId, query = {}) {
  const range = resolveRange(query);
  const vehicles = await prisma.vehicle.findMany({
    where: { dealershipId, deletedAt: null },
  });

  const active = vehicles.filter((v) => !isSold(v));
  const soldInPeriod = vehicles.filter((v) => {
    if (!isSold(v) || !v.soldAt) return false;
    const t = new Date(v.soldAt).getTime();
    return t >= range.from.getTime() && t <= range.to.getTime();
  });

  let gross = 0;
  let net = 0;
  for (const v of soldInPeriod) {
    const s = serializeWholesaleVehicle(v);
    gross += s.grossProfit;
    net += s.netProfit;
  }

  const o2Flooring = active
    .filter((v) => isFloored(v) && v.isWholesale)
    .reduce((sum, v) => {
      const override = flooringOverrideOf(v);
      return sum + (override != null ? override : toNum(v.flooringFees) || 0);
    }, 0);

  return {
    period: { from: range.from, to: range.to },
    vehiclesFloored: active.filter((v) => isFloored(v)).length,
    o2Flooring,
    vehiclesSold: soldInPeriod.length,
    grossProfit: Math.round(gross * 100) / 100,
    netProfit: Math.round(net * 100) / 100,
    totalInvested: Math.round(
      active.reduce((s, v) => s + investedOf(v), 0) * 100,
    ) / 100,
  };
}

export async function listVehicles(dealershipId, query = {}) {
  const { page = 1, limit = 100, q, status, sold } = query;
  const where = { dealershipId, deletedAt: null };
  if (status) where.status = status;
  if (sold === true) {
    where.OR = [
      { status: "sold" },
      { status: "out_of_state_sale" },
      { soldAt: { not: null } },
    ];
  } else if (sold === false) {
    where.status = { notIn: ["sold", "out_of_state_sale"] };
    where.soldAt = null;
  }
  if (q) {
    const text = {
      OR: [
        { vin: { contains: q, mode: "insensitive" } },
        { make: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
      ],
    };
    where.AND = where.AND || [];
    where.AND.push(text);
  }

  const [total, rows] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    vehicles: rows.map(serializeWholesaleVehicle),
    meta: pageMeta(total, page, limit),
  };
}

export async function getVehicle(dealershipId, id) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!vehicle) throw notFound("Vehicle not found.");
  return serializeWholesaleVehicle(vehicle);
}

export async function createVehicle(dealershipId, payload, userId) {
  const vin = String(payload.vin || "").toUpperCase().trim();
  const dup = await prisma.vehicle.findFirst({
    where: { dealershipId, vin, deletedAt: null },
  });
  if (dup) throw conflict("A vehicle with this VIN already exists.");

  const fees = {};
  if (payload.floored) {
    fees.floored = true;
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      dealershipId,
      createdById: userId,
      vin,
      year: payload.year,
      make: payload.make.trim(),
      model: payload.model.trim(),
      trim: payload.trim ?? null,
      acquisitionCost: payload.acquisitionCost,
      auctionFees: payload.auctionFees ?? 0,
      acquisitionDate: payload.acquisitionDate ?? new Date(),
      flooringStartDate: payload.floored
        ? payload.acquisitionDate ?? new Date()
        : null,
      titleReceived: payload.titlePresent !== false,
      titlePresent: payload.titlePresent !== false,
      isWholesale: payload.isWholesale ?? false,
      auctionHouse: payload.auctionHouse ?? null,
      auctionDate: payload.auctionDate ?? null,
      notes: payload.notes ?? null,
      fees,
      status: "in_stock",
      totalInvested:
        (payload.acquisitionCost || 0) + (payload.auctionFees || 0),
    },
  });

  return serializeWholesaleVehicle(vehicle);
}

export async function updateVehicle(dealershipId, id, payload) {
  const existing = await prisma.vehicle.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Vehicle not found.");

  const fees = feesObj(existing);
  if (payload.floored != null) fees.floored = !!payload.floored;
  if (payload.flooringOverride !== undefined) {
    fees.flooringOverride = payload.flooringOverride;
  }

  const data = {
    ...(payload.year != null && { year: payload.year }),
    ...(payload.make != null && { make: payload.make.trim() }),
    ...(payload.model != null && { model: payload.model.trim() }),
    ...(payload.trim !== undefined && { trim: payload.trim }),
    ...(payload.acquisitionCost != null && {
      acquisitionCost: payload.acquisitionCost,
    }),
    ...(payload.auctionFees != null && { auctionFees: payload.auctionFees }),
    ...(payload.acquisitionDate !== undefined && {
      acquisitionDate: payload.acquisitionDate,
    }),
    ...(payload.titlePresent != null && {
      titlePresent: payload.titlePresent,
      titleReceived: payload.titlePresent,
    }),
    ...(payload.isWholesale != null && { isWholesale: payload.isWholesale }),
    ...(payload.auctionHouse !== undefined && {
      auctionHouse: payload.auctionHouse,
    }),
    ...(payload.auctionDate !== undefined && {
      auctionDate: payload.auctionDate,
    }),
    ...(payload.auctionRuns != null && { auctionRuns: payload.auctionRuns }),
    ...(payload.notes !== undefined && { notes: payload.notes }),
    ...(payload.status != null && { status: payload.status }),
    ...(payload.floored != null && {
      flooringStartDate: payload.floored
        ? existing.flooringStartDate || new Date()
        : null,
    }),
    fees,
  };

  const vehicle = await prisma.vehicle.update({ where: { id }, data });
  return serializeWholesaleVehicle(vehicle);
}

export async function updateStatus(dealershipId, id, { status }) {
  const existing = await prisma.vehicle.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Vehicle not found.");

  const data = { status };
  if (status === "sold" || status === "out_of_state_sale") {
    if (!existing.soldAt) data.soldAt = new Date();
    if (existing.soldPrice == null) {
      data.soldPrice = Math.round((toNum(existing.acquisitionCost) || 0) * 1.15);
    }
  }
  if (status === "in_stock" || status === "needs_attention") {
    data.soldAt = null;
    data.soldPrice = null;
    data.saleChannel = null;
  }

  const vehicle = await prisma.vehicle.update({ where: { id }, data });
  return serializeWholesaleVehicle(vehicle);
}

export async function recordSale(dealershipId, id, payload) {
  const existing = await prisma.vehicle.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Vehicle not found.");

  const vehicle = await prisma.vehicle.update({
    where: { id },
    data: {
      soldPrice: payload.soldPrice,
      soldAt: payload.soldAt || new Date(),
      saleChannel: payload.saleChannel || "auction",
      auctionHouse: payload.auctionHouse ?? existing.auctionHouse,
      auctionDate: payload.auctionDate ?? existing.auctionDate,
      auctionRuns:
        payload.auctionRuns != null
          ? payload.auctionRuns
          : (existing.auctionRuns || 0) + 1,
      notes: payload.notes !== undefined ? payload.notes : existing.notes,
      status: payload.outOfState ? "out_of_state_sale" : "sold",
    },
  });

  return serializeWholesaleVehicle(vehicle);
}

export async function listSold(dealershipId, query = {}) {
  const range = resolveRange(query);
  const rows = await prisma.vehicle.findMany({
    where: {
      dealershipId,
      deletedAt: null,
      OR: [
        { status: { in: ["sold", "out_of_state_sale"] } },
        { soldAt: { not: null } },
      ],
      soldAt: { gte: range.from, lte: range.to },
    },
    orderBy: { soldAt: "desc" },
  });

  const vehicles = rows.map(serializeWholesaleVehicle);
  return {
    vehicles,
    totals: {
      count: vehicles.length,
      revenue: vehicles.reduce((s, v) => s + (v.soldPrice || 0), 0),
      grossProfit: vehicles.reduce((s, v) => s + (v.grossProfit || 0), 0),
      netProfit: vehicles.reduce((s, v) => s + (v.netProfit || 0), 0),
    },
    period: { from: range.from, to: range.to },
  };
}

export async function listExpenses(dealershipId, query = {}) {
  const { page = 1, limit = 100, q, category, status } = query;
  const range = resolveRange(query);
  const where = {
    dealershipId,
    deletedAt: null,
    OR: [
      { expenseDate: { gte: range.from, lte: range.to } },
      {
        isRecurring: true,
        expenseDate: { lte: range.to },
        NOT: { recurringFrequency: "One-Time" },
      },
    ],
  };
  if (category) where.category = category;
  if (status) where.status = status;
  if (q) {
    where.AND = [
      {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { vendor: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const rows = await prisma.dealershipExpense.findMany({
    where,
    orderBy: { expenseDate: "desc" },
  });

  // Expand recurring templates into period occurrences for list + totals.
  const expanded = [];
  for (const row of rows) {
    const amountInRange = expenseAmountInRange(row, range.from, range.to);
    if (!amountInRange) continue;
    const serialized = serializeExpense(row);
    const isRecurring =
      !!row.isRecurring &&
      row.recurringFrequency &&
      row.recurringFrequency !== "One-Time";
    const start = row.expenseDate instanceof Date ? row.expenseDate : new Date(row.expenseDate);
    const inNativeRange =
      start >= range.from && start <= range.to;
    expanded.push({
      ...serialized,
      amount: isRecurring ? amountInRange : serialized.amount,
      carriedForward: isRecurring && !inNativeRange,
    });
  }

  const total = expanded.length;
  const pageRows = expanded.slice((page - 1) * limit, page * limit);
  return {
    expenses: pageRows,
    meta: pageMeta(total, page, limit),
    totals: {
      amount: expanded.reduce((s, e) => s + (e.amount || 0), 0),
      paid: expanded
        .filter((e) => e.status === "paid")
        .reduce((s, e) => s + (e.amount || 0), 0),
      unpaid: expanded
        .filter((e) => e.status !== "paid")
        .reduce((s, e) => s + (e.amount || 0), 0),
    },
  };
}

export async function createExpense(dealershipId, payload, userId) {
  const expense = await prisma.dealershipExpense.create({
    data: {
      dealershipId,
      expenseDate: payload.expenseDate,
      category: payload.category.trim(),
      name: payload.name.trim(),
      vendor: payload.vendor?.trim() || "",
      description: payload.description?.trim() || payload.name.trim(),
      amount: payload.amount,
      status: payload.status || "paid",
      vehicleVin: payload.vehicleVin || null,
      notes: payload.notes || null,
      taxDeductible: payload.taxDeductible !== false,
      createdById: userId,
    },
  });
  return serializeExpense(expense);
}

export async function updateExpense(dealershipId, id, payload) {
  const existing = await prisma.dealershipExpense.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Expense not found.");

  const expense = await prisma.dealershipExpense.update({
    where: { id },
    data: {
      ...(payload.expenseDate != null && { expenseDate: payload.expenseDate }),
      ...(payload.category != null && { category: payload.category.trim() }),
      ...(payload.name != null && { name: payload.name.trim() }),
      ...(payload.vendor !== undefined && {
        vendor: payload.vendor?.trim() || "",
      }),
      ...(payload.description !== undefined && {
        description: payload.description?.trim() || "",
      }),
      ...(payload.amount != null && { amount: payload.amount }),
      ...(payload.status != null && { status: payload.status }),
      ...(payload.vehicleVin !== undefined && {
        vehicleVin: payload.vehicleVin,
      }),
      ...(payload.notes !== undefined && { notes: payload.notes }),
      ...(payload.taxDeductible != null && {
        taxDeductible: payload.taxDeductible,
      }),
    },
  });
  return serializeExpense(expense);
}

export async function deleteExpense(dealershipId, id) {
  const existing = await prisma.dealershipExpense.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Expense not found.");
  await prisma.dealershipExpense.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return { ok: true };
}

export async function profitLoss(dealershipId, query = {}) {
  const range = resolveRange(query);
  const [sold, expenses] = await Promise.all([
    listSold(dealershipId, query),
    listExpenses(dealershipId, { ...query, limit: 500, page: 1 }),
  ]);

  const revenue = sold.totals.revenue;
  const cogs = sold.vehicles.reduce(
    (s, v) => s + ((v.soldPrice || 0) - (v.grossProfit || 0)),
    0,
  );
  const gross = sold.totals.grossProfit;
  const operating = expenses.totals.amount;
  const net = Math.round((gross - operating) * 100) / 100;

  const byCategory = {};
  for (const e of expenses.expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
  }

  return {
    period: { from: range.from, to: range.to },
    revenue,
    cogs,
    grossProfit: gross,
    operatingExpenses: operating,
    netProfit: net,
    vehiclesSold: sold.totals.count,
    expenseBreakdown: Object.entries(byCategory).map(([category, amount]) => ({
      category,
      amount,
    })),
  };
}

export async function listCalendarNotes(dealershipId, query = {}) {
  let from;
  let to;
  if (query.year && query.month) {
    const y = query.year;
    const m = query.month - 1;
    from = new Date(Date.UTC(y, m, 1));
    to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  } else {
    const range = resolveRange(query);
    from = range.from;
    to = range.to;
  }

  const rows = await prisma.calendarDayNote.findMany({
    where: {
      dealershipId,
      noteDate: { gte: from, lte: to },
    },
    orderBy: { noteDate: "asc" },
  });

  const notes = {};
  for (const row of rows) {
    notes[datePrefix(row.noteDate)] = row.body;
  }
  return { notes };
}

export async function upsertDayNote(dealershipId, payload, userId) {
  const noteDate = payload.noteDate;
  const body = String(payload.body || "").trim();

  if (!body) {
    await prisma.calendarDayNote.deleteMany({
      where: { dealershipId, noteDate },
    });
    return { noteDate: datePrefix(noteDate), body: "" };
  }

  const row = await prisma.calendarDayNote.upsert({
    where: {
      dealershipId_noteDate: { dealershipId, noteDate },
    },
    create: {
      dealershipId,
      noteDate,
      body,
      updatedById: userId,
    },
    update: {
      body,
      updatedById: userId,
    },
  });

  return { noteDate: datePrefix(row.noteDate), body: row.body };
}
