import { prisma } from "../../lib/prisma.js";
import { notFound, conflict, forbidden } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { toNum, roundMoney } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";
import {
  resolveSalesRepCommission,
  computeCommissionAmount,
} from "../../common/commission.js";
import { compressDataUrl } from "../../utils/image-compress.js";
import { env } from "../../config/env.js";
import { deleteR2Object, isR2Configured } from "../../lib/r2.js";
import { mergeJsonFees } from "../../common/fees.js";

const FINAL_STATUSES = ["approved", "rejected"];

/**
 * Best-effort extract of an R2 object key from a stored file URL.
 * Deal-jacket docs store public URLs (or data: URLs) — only R2 keys are purged.
 */
function storageKeyFromFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  if (fileUrl.startsWith("data:")) return null;
  const base = (env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (base && fileUrl.startsWith(base + "/")) {
    return decodeURIComponent(fileUrl.slice(base.length + 1));
  }
  try {
    const u = new URL(fileUrl);
    const path = u.pathname.replace(/^\//, "");
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

async function purgeJacketFile(fileUrl) {
  if (!isR2Configured()) return;
  const key = storageKeyFromFileUrl(fileUrl);
  if (!key) return;
  try {
    await deleteR2Object(key);
  } catch {
    // DB row is already gone / about to go — R2 purge can be retried later
  }
}

export async function nextJacketNumber(dealershipId, tx = prisma) {
  const count = await tx.dealJacket.count({
    where: { dealershipId },
  });
  return `DJ-${String(count + 1).padStart(6, "0")}`;
}

export async function createJacketActivity(data, tx = prisma) {
  return tx.dealJacketActivity.create({ data });
}

export function serializeDealJacket(j) {
  if (!j) return null;
  return {
    id: j.id,
    dealershipId: j.dealershipId,
    vehicleId: j.vehicleId,
    customerId: j.customerId,
    dealId: j.dealId,
    salesRepId: j.salesRepId,
    jacketNumber: j.jacketNumber,
    soldPrice: toNum(j.soldPrice),
    totalTax: toNum(j.totalTax),
    totalSalePrice: toNum(j.totalSalePrice),
    downPayment: toNum(j.downPayment),
    amountFinanced: toNum(j.amountFinanced),
    balanceDue: toNum(j.balanceDue),
    totalInvested: toNum(j.totalInvested),
    additionalExpenses: toNum(j.additionalExpenses),
    commissionAmount: toNum(j.commissionAmount),
    profitGross: toNum(j.profitGross),
    profitNet: toNum(j.profitNet),
    tradeInAllowance: toNum(j.tradeInAllowance),
    warrantyAmount: toNum(j.warrantyAmount),
    gapAmount: toNum(j.gapAmount),
    fees: j.fees ?? {},
    lender: j.lender,
    rosNumber: j.rosNumber,
    notes: j.notes,
    reviewNotes: j.reviewNotes,
    rejectionReason: j.rejectionReason,
    dealType: j.dealType,
    workflowStatus: j.workflowStatus,
    dateSold: j.dateSold,
    reviewedAt: j.reviewedAt,
    reviewedById: j.reviewedById,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    vehicle: j.vehicle
      ? {
          id: j.vehicle.id,
          vin: j.vehicle.vin,
          stockNumber: j.vehicle.stockNumber,
          make: j.vehicle.make,
          model: j.vehicle.model,
          year: j.vehicle.year,
          status: j.vehicle.status,
        }
      : undefined,
    customer: j.customer
      ? {
          id: j.customer.id,
          name: j.customer.name,
          phone: j.customer.phone,
          email: j.customer.email,
        }
      : undefined,
    salesRep: j.salesRep
      ? {
          id: j.salesRep.id,
          fullName: j.salesRep.fullName,
          email: j.salesRep.email,
        }
      : undefined,
    documents: j.documents?.map((d) => ({
      id: d.id,
      fileUrl: d.fileUrl,
      documentName: d.documentName,
      fileType: d.fileType,
      uploadedAt: d.uploadedAt,
    })),
    commission: j.commission
      ? {
          id: j.commission.id,
          status: j.commission.status,
          commissionAmount: toNum(j.commission.commissionAmount),
        }
      : undefined,
  };
}

function jacketInclude() {
  return {
    vehicle: true,
    customer: true,
    salesRep: {
      select: { id: true, fullName: true, email: true },
    },
    documents: { orderBy: { uploadedAt: "desc" } },
    commission: true,
  };
}

async function getJacketOrThrow(id, dealershipId) {
  const jacket = await prisma.dealJacket.findFirst({
    where: { id, dealershipId, deletedAt: null },
    include: jacketInclude(),
  });
  if (!jacket) throw notFound("Deal jacket not found.");
  return jacket;
}

function assertSalesRepAccess(jacket, ctx, write = false) {
  if (["owner", "manager", "cpa", "platform_owner"].includes(ctx.role)) {
    return;
  }
  if (ctx.role === "sales_rep") {
    if (jacket.salesRepId !== ctx.userId) {
      throw forbidden("You can only access your own deal jackets.");
    }
    if (write && ["approved", "rejected"].includes(jacket.workflowStatus)) {
      throw forbidden("This deal jacket can no longer be edited.");
    }
    return;
  }
  throw forbidden("You do not have permission for this action.");
}

function assertManagerAction(ctx) {
  if (!["owner", "manager", "platform_owner"].includes(ctx.role)) {
    throw forbidden("Only managers can perform this action.");
  }
}

function computeFinancials(vehicle, payload) {
  const vehicleInvested = toNum(vehicle.totalInvested) ?? 0;
  const soldPrice = roundMoney(payload.soldPrice);
  const profitGross = roundMoney(soldPrice - vehicleInvested);
  const commissionType = payload.commissionType || "percentage";
  const commissionRate =
    payload.commissionRate ?? (commissionType === "flat" ? 0 : 0.1);
  const commissionAmount = computeCommissionAmount(profitGross, {
    commissionAmount: payload.commissionAmount,
    commissionRate,
    commissionType,
    resolved: payload._resolvedCommission,
  });
  const feesObj =
    payload.fees && typeof payload.fees === "object" ? payload.fees : {};
  const addOnItems = Array.isArray(feesObj.addOnItems) ? feesObj.addOnItems : [];
  const addOnCostFromItems = roundMoney(
    addOnItems.reduce((s, a) => s + (Number(a.cost) || 0), 0),
  );
  const addOnRevFromItems = roundMoney(
    addOnItems.reduce((s, a) => s + (Number(a.price) || 0), 0),
  );
  const additionalExpenses = roundMoney(
    payload.additionalExpenses != null
      ? payload.additionalExpenses
      : addOnCostFromItems,
  );
  const netCheckRaw =
    payload.netCheck ?? (feesObj.netCheck != null ? feesObj.netCheck : null);
  const hasNetCheck =
    netCheckRaw !== null &&
    netCheckRaw !== undefined &&
    netCheckRaw !== "";
  const salesTax = roundMoney(
    payload.totalTax ??
      payload.salesTaxAmount ??
      0,
  );
  const licenseFees = roundMoney(payload.licenseFees ?? 0);
  // Net Check − tax − reg − invested − add-on cost − commission
  const profitNet = hasNetCheck
    ? roundMoney(
        Number(netCheckRaw) -
          salesTax -
          licenseFees -
          vehicleInvested -
          additionalExpenses -
          commissionAmount,
      )
    : roundMoney(
        soldPrice +
          addOnRevFromItems -
          vehicleInvested -
          additionalExpenses -
          commissionAmount,
      );
  const totalSalePrice =
    payload.totalSalePrice ??
    soldPrice + (payload.totalTax ?? 0);

  return {
    soldPrice,
    totalInvested: vehicleInvested,
    profitGross,
    commissionAmount,
    profitNet,
    totalSalePrice: roundMoney(totalSalePrice),
    balanceDue: roundMoney(
      totalSalePrice - (payload.downPayment ?? 0),
    ),
  };
}

async function logTransition(jacket, action, ctx, extra = {}) {
  await createJacketActivity({
    dealJacketId: jacket.id,
    action,
    actorId: ctx.userId,
    actorName: ctx.actorName ?? "User",
    oldStatus: extra.oldStatus ?? jacket.workflowStatus,
    newStatus: extra.newStatus,
    detail: extra.detail ?? null,
  });
}

/**
 * True if rosNumber is already used on a deal or deal jacket in this dealership.
 */
export async function isDealNumberTaken(
  dealershipId,
  rosNumber,
  { excludeJacketId, excludeVehicleId } = {},
) {
  const normalized = String(rosNumber || "").trim();
  if (!normalized) return false;

  const jacketWhere = {
    dealershipId,
    deletedAt: null,
    rosNumber: { equals: normalized, mode: "insensitive" },
  };
  if (excludeJacketId) jacketWhere.id = { not: excludeJacketId };
  if (excludeVehicleId) jacketWhere.vehicleId = { not: excludeVehicleId };

  const dealWhere = {
    dealershipId,
    deletedAt: null,
    rosNumber: { equals: normalized, mode: "insensitive" },
  };
  if (excludeVehicleId) dealWhere.vehicleId = { not: excludeVehicleId };

  const [jacketHit, dealHit] = await Promise.all([
    prisma.dealJacket.findFirst({ where: jacketWhere, select: { id: true } }),
    prisma.deal.findFirst({ where: dealWhere, select: { id: true } }),
  ]);
  return !!(jacketHit || dealHit);
}

export async function checkDealNumber(dealershipId, query) {
  const rosNumber = String(query.rosNumber || "").trim();
  if (!rosNumber) {
    return { rosNumber: "", available: false, status: "empty" };
  }
  const taken = await isDealNumberTaken(dealershipId, rosNumber, {
    excludeJacketId: query.excludeJacketId,
    excludeVehicleId: query.excludeVehicleId,
  });
  return {
    rosNumber,
    available: !taken,
    status: taken ? "not_applicable" : "applicable",
  };
}

/**
 * Auto-generate DL-{4..6 digit} and rotate until unused in this dealership.
 */
export async function generateDealNumber(dealershipId, opts = {}) {
  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Prefer 5 digits; occasionally 4 or 6 for variety within the requested range
    const digitCount = attempt < 20 ? 5 : attempt < 30 ? 4 : 6;
    const min = digitCount === 4 ? 1000 : digitCount === 5 ? 10000 : 100000;
    const max = digitCount === 4 ? 9999 : digitCount === 5 ? 99999 : 999999;
    const n = min + Math.floor(Math.random() * (max - min + 1));
    const rosNumber = `DL-${n}`;
    const taken = await isDealNumberTaken(dealershipId, rosNumber, {
      excludeJacketId: opts.excludeJacketId,
      excludeVehicleId: opts.excludeVehicleId,
    });
    if (!taken) {
      return {
        rosNumber,
        available: true,
        status: "applicable",
        attempts: attempt + 1,
      };
    }
  }
  // Sequential fallback if random space is exhausted
  for (let n = 1000; n <= 999999; n++) {
    const rosNumber = `DL-${n}`;
    const taken = await isDealNumberTaken(dealershipId, rosNumber, {
      excludeJacketId: opts.excludeJacketId,
      excludeVehicleId: opts.excludeVehicleId,
    });
    if (!taken) {
      return {
        rosNumber,
        available: true,
        status: "applicable",
        attempts: maxAttempts + n,
      };
    }
  }
  throw conflict("Could not allocate a unique deal number. Try again.");
}

export async function listJackets(dealershipId, query, ctx) {
  const { page, limit, q, workflowStatus, salesRepId } = query;
  const where = { dealershipId, deletedAt: null };

  if (workflowStatus) where.workflowStatus = workflowStatus;
  if (ctx.role === "sales_rep") {
    where.salesRepId = ctx.userId;
  } else if (salesRepId) {
    where.salesRepId = salesRepId;
  }

  if (q) {
    where.OR = [
      { jacketNumber: { contains: q, mode: "insensitive" } },
      { rosNumber: { contains: q, mode: "insensitive" } },
      { vehicle: { vin: { contains: q, mode: "insensitive" } } },
      { vehicle: { stockNumber: { contains: q, mode: "insensitive" } } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.dealJacket.count({ where }),
    prisma.dealJacket.findMany({
      where,
      include: jacketInclude(),
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    dealJackets: rows.map(serializeDealJacket),
    meta: pageMeta(total, page, limit),
  };
}

export async function getJacket(id, dealershipId, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx);
  return serializeDealJacket(jacket);
}

export async function createJacket(dealershipId, payload, ctx) {
  if (!["owner", "manager", "sales_rep", "platform_owner"].includes(ctx.role)) {
    throw forbidden("You cannot create deal jackets.");
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: payload.vehicleId,
      dealershipId,
      deletedAt: null,
    },
  });
  if (!vehicle) throw notFound("Vehicle not found.");
  // Allow creating a jacket for sold vehicles that do not have one yet.
  // Creating a jacket for an in-stock vehicle marks it sold via markSold path in UI;
  // this endpoint still supports draft jackets for pending_deal.
  if (vehicle.status === "loss") {
    throw conflict("Vehicle is not available for a deal jacket.");
  }

  const existing = await prisma.dealJacket.findFirst({
    where: { vehicleId: payload.vehicleId, deletedAt: null },
  });
  if (existing) throw conflict("A deal jacket already exists for this vehicle.");

  if (vehicle.status === "sold") {
    throw conflict(
      "Use Save Deal & Mark Sold / complete jacket for sold vehicles without a jacket.",
    );
  }
  const customer = await prisma.customer.findFirst({
    where: {
      id: payload.customerId,
      dealershipId,
      deletedAt: null,
    },
  });
  if (!customer) throw notFound("Customer not found.");

  const salesRepId =
    ctx.role === "sales_rep" ? ctx.userId : (payload.salesRepId ?? null);
  const resolved = await resolveSalesRepCommission(salesRepId);
  const commissionType =
    payload.commissionType ||
    (payload.commissionAmount != null && payload.commissionRate == null
      ? "manual"
      : resolved.type);
  const commissionRate =
    payload.commissionRate ??
    (resolved.type === "flat" ? resolved.amount : resolved.rate);
  const financials = computeFinancials(vehicle, {
    ...payload,
    commissionRate,
    commissionType,
    _resolvedCommission: resolved,
  });

  const jacket = await prisma.$transaction(async (tx) => {
    const jacketNumber = await nextJacketNumber(dealershipId, tx);
    const created = await tx.dealJacket.create({
      data: {
        dealershipId,
        vehicleId: payload.vehicleId,
        customerId: payload.customerId,
        salesRepId,
        jacketNumber,
        soldPrice: financials.soldPrice,
        totalTax: roundMoney(payload.totalTax ?? 0),
        totalSalePrice: financials.totalSalePrice,
        downPayment: roundMoney(payload.downPayment ?? 0),
        amountFinanced: roundMoney(payload.amountFinanced ?? 0),
        balanceDue: financials.balanceDue,
        totalInvested: financials.totalInvested,
        additionalExpenses: roundMoney(payload.additionalExpenses ?? 0),
        commissionAmount: financials.commissionAmount,
        profitGross: financials.profitGross,
        profitNet: financials.profitNet,
        tradeInAllowance: roundMoney(payload.tradeInAllowance ?? 0),
        warrantyAmount: roundMoney(payload.warrantyAmount ?? 0),
        gapAmount: roundMoney(payload.gapAmount ?? 0),
        fees: payload.fees ?? {},
        lender: payload.lender ?? null,
        rosNumber: payload.rosNumber ?? null,
        notes: payload.notes ?? null,
        dealType: payload.dealType ?? "Retail",
        workflowStatus: "draft",
        dateSold: payload.dateSold ?? new Date(),
        createdById: ctx.userId,
      },
      include: jacketInclude(),
    });

    await tx.vehicle.update({
      where: { id: payload.vehicleId },
      data: { status: "pending_deal" },
    });

    await createJacketActivity(
      {
        dealJacketId: created.id,
        action: "created",
        actorId: ctx.userId,
        actorName: ctx.actorName ?? "User",
        oldStatus: null,
        newStatus: "draft",
      },
      tx,
    );

    return created;
  });

  return serializeDealJacket(jacket);
}

export async function updateJacket(id, dealershipId, payload, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx, true);

  var onlyFees = payload.fees != null || payload.additionalExpenses != null;
  var otherFields = Object.keys(payload).filter(function (k) {
    return (
      k !== "fees" &&
      k !== "additionalExpenses" &&
      payload[k] !== undefined
    );
  });
  if (FINAL_STATUSES.includes(jacket.workflowStatus) && otherFields.length > 0) {
    throw conflict(`Deal jacket is already ${jacket.workflowStatus}.`);
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: jacket.vehicleId, dealershipId, deletedAt: null },
  });
  if (!vehicle) throw notFound("Vehicle not found.");

  let dealLicenseFees = 0;
  if (jacket.dealId) {
    try {
      const dealRow = await prisma.deal.findFirst({
        where: { id: jacket.dealId, deletedAt: null },
        select: { licenseFees: true },
      });
      dealLicenseFees = toNum(dealRow?.licenseFees) ?? 0;
    } catch (_) {}
  }

  const salesRepIdForRate =
    payload.salesRepId !== undefined ? payload.salesRepId : jacket.salesRepId;
  const resolved = salesRepIdForRate
    ? await resolveSalesRepCommission(salesRepIdForRate)
    : { type: "percentage", rate: 0, amount: null };
  const commissionType =
    payload.commissionType ||
    (payload.commissionAmount != null && payload.commissionRate == null
      ? "manual"
      : resolved.type);
  const merged = {
    soldPrice: payload.soldPrice ?? toNum(jacket.soldPrice),
    totalTax: payload.totalTax ?? toNum(jacket.totalTax),
    licenseFees:
      payload.licenseFees != null
        ? payload.licenseFees
        : dealLicenseFees,
    totalSalePrice: payload.totalSalePrice ?? toNum(jacket.totalSalePrice),
    downPayment: payload.downPayment ?? toNum(jacket.downPayment),
    additionalExpenses:
      payload.additionalExpenses ?? toNum(jacket.additionalExpenses),
    commissionRate:
      payload.commissionRate ??
      (resolved.type === "flat" ? resolved.amount : resolved.rate ?? 0),
    commissionAmount:
      payload.commissionAmount ?? toNum(jacket.commissionAmount),
    commissionType,
    _resolvedCommission: resolved,
    fees:
      payload.fees != null
        ? mergeJsonFees(jacket.fees, payload.fees)
        : jacket.fees && typeof jacket.fees === "object"
          ? jacket.fees
          : {},
  };

  const financials = computeFinancials(vehicle, merged);
  const data = {
    ...(payload.soldPrice != null && { soldPrice: financials.soldPrice }),
    ...(payload.totalTax != null && {
      totalTax: roundMoney(payload.totalTax),
    }),
    ...(payload.totalSalePrice != null && {
      totalSalePrice: financials.totalSalePrice,
    }),
    ...(payload.downPayment != null && {
      downPayment: roundMoney(payload.downPayment),
    }),
    ...(payload.amountFinanced != null && {
      amountFinanced: roundMoney(payload.amountFinanced),
    }),
    ...(payload.additionalExpenses != null && {
      additionalExpenses: roundMoney(payload.additionalExpenses),
    }),
    ...(payload.tradeInAllowance != null && {
      tradeInAllowance: roundMoney(payload.tradeInAllowance),
    }),
    ...(payload.warrantyAmount != null && {
      warrantyAmount: roundMoney(payload.warrantyAmount),
    }),
    ...(payload.gapAmount != null && {
      gapAmount: roundMoney(payload.gapAmount),
    }),
    ...(payload.fees != null && {
      fees: mergeJsonFees(jacket.fees, payload.fees),
    }),
    ...(payload.lender !== undefined && { lender: payload.lender }),
    ...(payload.rosNumber !== undefined && { rosNumber: payload.rosNumber }),
    ...(payload.notes !== undefined && { notes: payload.notes }),
    ...(payload.dealType != null && { dealType: payload.dealType }),
    ...(payload.dateSold != null && { dateSold: payload.dateSold }),
    ...(payload.salesRepId !== undefined &&
      ctx.role !== "sales_rep" && { salesRepId: payload.salesRepId }),
    commissionAmount: financials.commissionAmount,
    profitGross: financials.profitGross,
    profitNet: financials.profitNet,
    balanceDue: financials.balanceDue,
    totalInvested: financials.totalInvested,
  };

  const updated = await prisma.dealJacket.update({
    where: { id },
    data,
    include: jacketInclude(),
  });

  if (jacket.dealId && financials.profitNet != null) {
    try {
      await prisma.deal.update({
        where: { id: jacket.dealId },
        data: { netProfit: financials.profitNet },
      });
    } catch (_) {}
  }

  await logTransition(jacket, "updated", ctx, {
    oldStatus: jacket.workflowStatus,
    newStatus: updated.workflowStatus,
  });

  return serializeDealJacket(updated);
}

async function transitionJacket(id, dealershipId, newStatus, ctx, extra = {}) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  if (FINAL_STATUSES.includes(jacket.workflowStatus)) {
    throw conflict(`Deal jacket is already ${jacket.workflowStatus}.`);
  }

  const updated = await prisma.dealJacket.update({
    where: { id },
    data: {
      workflowStatus: newStatus,
      ...extra,
    },
    include: jacketInclude(),
  });

  return { jacket, updated };
}

export async function submitJacket(id, dealershipId, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx, true);

  if (!["draft", "changes_requested"].includes(jacket.workflowStatus)) {
    throw conflict("Deal jacket cannot be submitted in its current status.");
  }

  const updated = await prisma.dealJacket.update({
    where: { id },
    data: { workflowStatus: "pending_review" },
    include: jacketInclude(),
  });

  await logTransition(jacket, "submitted", ctx, {
    oldStatus: jacket.workflowStatus,
    newStatus: "pending_review",
  });

  return serializeDealJacket(updated);
}

export async function requestChanges(id, dealershipId, payload, ctx) {
  assertManagerAction(ctx);
  const { jacket, updated } = await transitionJacket(
    id,
    dealershipId,
    "changes_requested",
    ctx,
    {
      reviewNotes: payload.reviewNotes,
      reviewedById: ctx.userId,
      reviewedAt: new Date(),
    },
  );

  await logTransition(jacket, "changes_requested", ctx, {
    oldStatus: jacket.workflowStatus,
    newStatus: "changes_requested",
    detail: {
      reviewNotes: payload.reviewNotes,
      changeCategories: payload.changeCategories,
    },
  });

  return serializeDealJacket(updated);
}

export async function resubmitJacket(id, dealershipId, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx, true);

  if (jacket.workflowStatus !== "changes_requested") {
    throw conflict("Only jackets with changes requested can be resubmitted.");
  }

  const updated = await prisma.dealJacket.update({
    where: { id },
    data: { workflowStatus: "resubmitted" },
    include: jacketInclude(),
  });

  await logTransition(jacket, "resubmitted", ctx, {
    oldStatus: jacket.workflowStatus,
    newStatus: "resubmitted",
  });

  return serializeDealJacket(updated);
}

async function createCommissionOnApprove(jacket, tx) {
  if (!jacket.salesRepId) return null;
  const resolved = await resolveSalesRepCommission(jacket.salesRepId);
  const rate =
    resolved.type === "flat" ? resolved.amount ?? 0 : resolved.rate ?? 0;
  if (rate <= 0 && toNum(jacket.commissionAmount) <= 0) return null;

  const existing = await tx.salesRepCommission.findFirst({
    where: { dealJacketId: jacket.id, deletedAt: null },
  });
  if (existing) return existing;

  return tx.salesRepCommission.create({
    data: {
      dealershipId: jacket.dealershipId,
      salesRepId: jacket.salesRepId,
      dealJacketId: jacket.id,
      commissionAmount: toNum(jacket.commissionAmount) ?? 0,
      grossProfit: toNum(jacket.profitGross) ?? 0,
      soldPrice: toNum(jacket.soldPrice) ?? 0,
      commissionRate: rate,
      status: "approved",
    },
  });
}

export async function approveJacket(id, dealershipId, payload, ctx) {
  assertManagerAction(ctx);
  const jacket = await getJacketOrThrow(id, dealershipId);

  if (FINAL_STATUSES.includes(jacket.workflowStatus)) {
    throw conflict(`Deal jacket is already ${jacket.workflowStatus}.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.dealJacket.update({
      where: { id },
      data: {
        workflowStatus: "approved",
        reviewNotes: payload.reviewNotes ?? null,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
      include: jacketInclude(),
    });

    const vehicle = await tx.vehicle.findFirst({
      where: { id: jacket.vehicleId },
    });
    if (vehicle && vehicle.status !== "sold") {
      await tx.vehicle.update({
        where: { id: jacket.vehicleId },
        data: {
          status: "sold",
          soldAt: jacket.dateSold ?? new Date(),
          soldPrice: jacket.soldPrice,
        },
      });
      await tx.vehicleStatusHistory.create({
        data: {
          vehicleId: jacket.vehicleId,
          dealershipId,
          fromStatus: vehicle.status,
          toStatus: "sold",
          note: `Deal jacket ${jacket.jacketNumber} approved`,
          changedById: ctx.userId,
        },
      });
    }

    await createCommissionOnApprove(updated, tx);

    await createJacketActivity(
      {
        dealJacketId: id,
        action: "approved",
        actorId: ctx.userId,
        actorName: ctx.actorName ?? "User",
        oldStatus: jacket.workflowStatus,
        newStatus: "approved",
        detail: payload.reviewNotes
          ? { reviewNotes: payload.reviewNotes }
          : null,
      },
      tx,
    );

    return updated;
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "DealJacket",
    entityId: id,
    action: "approved",
    newValues: { jacketNumber: jacket.jacketNumber },
    ipAddress: ctx.ipAddress,
  });

  return serializeDealJacket(result);
}

export async function rejectJacket(id, dealershipId, payload, ctx) {
  assertManagerAction(ctx);
  const jacket = await getJacketOrThrow(id, dealershipId);

  if (FINAL_STATUSES.includes(jacket.workflowStatus)) {
    throw conflict(`Deal jacket is already ${jacket.workflowStatus}.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.dealJacket.update({
      where: { id },
      data: {
        workflowStatus: "rejected",
        rejectionReason: payload.rejectionReason,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
      include: jacketInclude(),
    });

    const vehicle = await tx.vehicle.findFirst({
      where: { id: jacket.vehicleId },
    });
    if (vehicle?.status === "pending_deal") {
      await tx.vehicle.update({
        where: { id: jacket.vehicleId },
        data: { status: "in_stock" },
      });
      await tx.vehicleStatusHistory.create({
        data: {
          vehicleId: jacket.vehicleId,
          dealershipId,
          fromStatus: "pending_deal",
          toStatus: "in_stock",
          note: `Deal jacket ${jacket.jacketNumber} rejected`,
          changedById: ctx.userId,
        },
      });
    }

    const commission = await tx.salesRepCommission.findFirst({
      where: { dealJacketId: id, deletedAt: null },
    });
    if (commission) {
      await tx.salesRepCommission.update({
        where: { id: commission.id },
        data: { status: "rejected" },
      });
    }

    await createJacketActivity(
      {
        dealJacketId: id,
        action: "rejected",
        actorId: ctx.userId,
        actorName: ctx.actorName ?? "User",
        oldStatus: jacket.workflowStatus,
        newStatus: "rejected",
        detail: { rejectionReason: payload.rejectionReason },
      },
      tx,
    );

    return updated;
  });

  return serializeDealJacket(result);
}

export async function addDocument(id, dealershipId, payload, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx, true);

  let fileUrl = payload.fileUrl;
  let compressionInfo = null;

  if (fileUrl && fileUrl.startsWith("data:")) {
    const result = await compressDataUrl(fileUrl, { maxBytes: 20 * 1024, maxDimension: 800 });
    if (result.compressed) {
      fileUrl = result.dataUrl;
      compressionInfo = {
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
      };
    }
  }

  const doc = await prisma.dealJacketDocument.create({
    data: {
      dealJacketId: id,
      fileUrl,
      documentName: payload.documentName,
      fileType: payload.fileType ?? "application/pdf",
    },
  });

  await logTransition(jacket, "document_added", ctx, {
    oldStatus: jacket.workflowStatus,
    newStatus: jacket.workflowStatus,
    detail: { documentName: payload.documentName, compression: compressionInfo },
  });

  return {
    id: doc.id,
    fileUrl: doc.fileUrl,
    documentName: doc.documentName,
    fileType: doc.fileType,
    uploadedAt: doc.uploadedAt,
  };
}

export async function removeDocument(id, documentId, dealershipId, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx, true);

  const doc = await prisma.dealJacketDocument.findFirst({
    where: { id: documentId, dealJacketId: id },
  });
  if (!doc) throw notFound("Document not found.");

  await prisma.dealJacketDocument.delete({ where: { id: documentId } });
  await purgeJacketFile(doc.fileUrl);

  await logTransition(jacket, "document_removed", ctx, {
    oldStatus: jacket.workflowStatus,
    newStatus: jacket.workflowStatus,
    detail: { documentName: doc.documentName, documentId },
  });

  return {
    id: doc.id,
    documentName: doc.documentName,
  };
}

/**
 * Sync deal-jacket documents to a desired final set:
 * - keepDocumentIds: existing docs to keep
 * - any DB doc NOT in keepDocumentIds is deleted (DB + R2)
 * - addDocuments: new uploads to create after removals
 *
 * This is the "previous vs after" diff the client wants: send the IDs that
 * should remain; missing ones are treated as removed.
 */
export async function syncDocuments(id, dealershipId, payload, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx, true);

  const keepIds = new Set(
    Array.isArray(payload.keepDocumentIds) ? payload.keepDocumentIds : [],
  );
  const existing = await prisma.dealJacketDocument.findMany({
    where: { dealJacketId: id },
  });

  const removed = [];
  for (const doc of existing) {
    if (keepIds.has(doc.id)) continue;
    await prisma.dealJacketDocument.delete({ where: { id: doc.id } });
    await purgeJacketFile(doc.fileUrl);
    removed.push({ id: doc.id, documentName: doc.documentName });
  }

  if (removed.length) {
    await logTransition(jacket, "documents_synced_removed", ctx, {
      oldStatus: jacket.workflowStatus,
      newStatus: jacket.workflowStatus,
      detail: { removedCount: removed.length, removed },
    });
  }

  const added = [];
  const toAdd = Array.isArray(payload.addDocuments) ? payload.addDocuments : [];
  for (const item of toAdd) {
    const created = await addDocument(id, dealershipId, item, ctx);
    added.push(created);
  }

  const finalDocs = await prisma.dealJacketDocument.findMany({
    where: { dealJacketId: id },
    orderBy: { uploadedAt: "desc" },
  });

  return {
    removed,
    added,
    documents: finalDocs.map((d) => ({
      id: d.id,
      fileUrl: d.fileUrl,
      documentName: d.documentName,
      fileType: d.fileType,
      uploadedAt: d.uploadedAt,
    })),
  };
}

export async function getActivity(id, dealershipId, ctx) {
  const jacket = await getJacketOrThrow(id, dealershipId);
  assertSalesRepAccess(jacket, ctx);

  const rows = await prisma.dealJacketActivity.findMany({
    where: { dealJacketId: id },
    orderBy: { createdAt: "desc" },
    include: {
      actor: { select: { id: true, fullName: true, email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actorId,
    actorName: r.actorName,
    actor: r.actor
      ? { id: r.actor.id, fullName: r.actor.fullName }
      : null,
    oldStatus: r.oldStatus,
    newStatus: r.newStatus,
    detail: r.detail,
    createdAt: r.createdAt,
  }));
}
