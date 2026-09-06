import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { serializeDecimal, serializeDecimals } from "../../common/serialize.js";

function toNumber(value) {
  if (value == null) return 0;
  return Number(value);
}

function daysBetween(start, end) {
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function estimateFlooringCost(plan, principal, daysOnFloor) {
  const rate = toNumber(plan.baseRate);
  const amount = toNumber(principal);

  if (plan.rateType === "daily") {
    return rate * daysOnFloor;
  }
  if (plan.rateType === "monthly") {
    return (rate / 30) * daysOnFloor;
  }
  // apr  baseRate treated as annual percentage
  return amount * (rate / 100) * (daysOnFloor / 365);
}

function serializePlan(plan) {
  return serializeDecimals(plan);
}

export async function listFlooringPlans(dealershipId) {
  const plans = await prisma.flooringPlan.findMany({
    where: { dealershipId, deletedAt: null },
    orderBy: { effectiveDate: "desc" },
  });
  return plans.map(serializePlan);
}

export async function createFlooringPlan(
  dealershipId,
  data,
  createdById,
  ipAddress,
) {
  const plan = await prisma.flooringPlan.create({
    data: {
      dealershipId,
      createdById,
      name: data.name ?? "Standard Floor Plan",
      rateType: data.rateType ?? "monthly",
      baseRate: data.baseRate,
      effectiveDate: data.effectiveDate,
      rateIncreaseEnabled: data.rateIncreaseEnabled ?? false,
      increaseAfterDays: data.increaseAfterDays ?? null,
      increaseAmountType: data.increaseAmountType ?? null,
      increaseAmount: data.increaseAmount ?? null,
      maxCap: data.maxCap ?? null,
      buyFee: data.buyFee ?? null,
      lateFeePerDay: data.lateFeePerDay ?? null,
      lateFeeAfterDays: data.lateFeeAfterDays ?? null,
      gracePeriodDays: data.gracePeriodDays ?? null,
      isActive: data.isActive ?? true,
      configJson: data.configJson ?? null,
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: createdById,
    entityType: "FlooringPlan",
    entityId: plan.id,
    action: "create",
    ipAddress,
  });

  if (plan.isActive) {
    await clearFlooringUndo(dealershipId, createdById, ipAddress);
  }

  return serializePlan(plan);
}

export async function updateFlooringPlan(
  dealershipId,
  planId,
  data,
  changedById,
  ipAddress,
) {
  const existing = await prisma.flooringPlan.findFirst({
    where: { id: planId, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Flooring plan not found.");

  const plan = await prisma.flooringPlan.update({
    where: { id: planId },
    data,
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "FlooringPlan",
    entityId: planId,
    action: "update",
    ipAddress,
  });

  const applied =
    data.isActive === true ||
    (data.configJson &&
      typeof data.configJson === "object" &&
      data.configJson.applied === true);
  if (applied) {
    await clearFlooringUndo(dealershipId, changedById, ipAddress);
  }

  return serializePlan(plan);
}

export async function deleteFlooringPlan(
  dealershipId,
  planId,
  changedById,
  ipAddress,
) {
  const existing = await prisma.flooringPlan.findFirst({
    where: { id: planId, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Flooring plan not found.");

  const plan = await prisma.flooringPlan.update({
    where: { id: planId },
    data: { deletedAt: new Date(), isActive: false },
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "FlooringPlan",
    entityId: planId,
    action: "soft_delete",
    ipAddress,
  });

  return serializePlan(plan);
}

export async function getFlooringBreakdown(dealershipId, { asOfDate }) {
  const asOf = asOfDate ?? new Date();
  const vehicles = await prisma.vehicle.findMany({
    where: {
      dealershipId,
      deletedAt: null,
      flooringPlanId: { not: null },
      flooringStartDate: { not: null },
    },
    include: { flooringPlan: true },
  });

  const items = vehicles.map((vehicle) => {
    const daysOnFloor = daysBetween(vehicle.flooringStartDate, asOf);
    const principal = vehicle.acquisitionCost ?? 0;
    const estimatedCost = vehicle.flooringPlan
      ? estimateFlooringCost(vehicle.flooringPlan, principal, daysOnFloor)
      : 0;

    return {
      vehicleId: vehicle.id,
      vin: vehicle.vin,
      stockNumber: vehicle.stockNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      flooringPlanId: vehicle.flooringPlanId,
      flooringPlanName: vehicle.flooringPlan?.name ?? null,
      rateType: vehicle.flooringPlan?.rateType ?? null,
      baseRate: serializeDecimal(vehicle.flooringPlan?.baseRate),
      flooringStartDate: vehicle.flooringStartDate,
      daysOnFloor,
      principal: serializeDecimal(principal),
      estimatedFlooringCost: Math.round(estimatedCost * 100) / 100,
    };
  });

  const totalEstimatedCost = items.reduce(
    (sum, item) => sum + item.estimatedFlooringCost,
    0,
  );

  return {
    asOfDate: asOf,
    items,
    summary: {
      vehicleCount: items.length,
      totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
    },
  };
}

const FLOORING_UNDO_MS = 3 * 60 * 60 * 1000;

function jsonFees(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value };
  return {};
}

function toIsoDate(value) {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function serializeUndoRow(row) {
  const snap = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const vehicles = Array.isArray(snap.vehicles) ? snap.vehicles : [];
  return {
    expiresAt: row.expiresAt,
    vehicleCount: vehicles.length,
    config: snap.config || null,
    vehicles,
  };
}

async function captureFlooringUndoFromDb(dealershipId) {
  const plans = await prisma.flooringPlan.findMany({
    where: { dealershipId, deletedAt: null },
    orderBy: { effectiveDate: "desc" },
  });
  const active =
    plans.find((p) => p.isActive) || plans[0] || null;
  const vehicles = await prisma.vehicle.findMany({
    where: { dealershipId, deletedAt: null },
    select: {
      id: true,
      vin: true,
      flooringFees: true,
      flooringStartDate: true,
      flooringPlanId: true,
      fees: true,
    },
  });

  const cfg = active?.configJson && typeof active.configJson === "object"
    ? active.configJson
    : {};

  return {
    config: {
      buyFee: toNumber(cfg.buyFee ?? active?.buyFee),
      gracePeriod: toNumber(cfg.gracePeriod),
      payoffDays: toNumber(cfg.payoffDays ?? active?.gracePeriodDays) || 90,
      applied: !!(cfg.applied ?? active?.isActive),
      configured: !!(cfg.configured ?? cfg.applied ?? active?.isActive),
      scope: cfg.scope || "all",
      planId: active?.id || null,
      tiers: Array.isArray(cfg.tiers)
        ? cfg.tiers.map((t) => ({
            max: t?.max == null ? null : toNumber(t.max),
            rate: toNumber(t?.rate),
          }))
        : [],
    },
    vehicles: vehicles.map((v) => {
      const fees = jsonFees(v.fees);
      return {
        id: v.id,
        vin: v.vin,
        floored: !!(
          v.flooringPlanId ||
          v.flooringStartDate ||
          toNumber(v.flooringFees) > 0 ||
          fees.flooringManual
        ),
        flooringOverride: fees.flooringManual
          ? toNumber(v.flooringFees)
          : null,
        flooringPaidOff: !!fees.flooringPaidOff,
        flooringPaidDate: fees.flooringPaidDate || null,
        flooringPaidAmount:
          fees.flooringPaidAmount != null ? toNumber(fees.flooringPaidAmount) : null,
        flooringStartDate: toIsoDate(v.flooringStartDate),
        flooringPlanId: v.flooringPlanId,
        flooringManual: !!fees.flooringManual,
        flooringFees: toNumber(v.flooringFees),
      };
    }),
  };
}

async function findLiveUndo(dealershipId) {
  const row = await prisma.flooringUndoSnapshot.findUnique({
    where: { dealershipId },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.flooringUndoSnapshot
      .delete({ where: { id: row.id } })
      .catch(() => {});
    return null;
  }
  return row;
}

export async function getFlooringUndo(dealershipId) {
  const row = await findLiveUndo(dealershipId);
  if (!row) return null;
  return serializeUndoRow(row);
}

export async function saveFlooringUndo(
  dealershipId,
  data,
  createdById,
  ipAddress,
) {
  const captured = await captureFlooringUndoFromDb(dealershipId);
  const snapshot = {
    config: data?.config && typeof data.config === "object"
      ? { ...captured.config, ...data.config }
      : captured.config,
    vehicles:
      Array.isArray(data?.vehicles) && data.vehicles.length
        ? data.vehicles
        : captured.vehicles,
  };
  const expiresAt = new Date(Date.now() + FLOORING_UNDO_MS);

  const row = await prisma.flooringUndoSnapshot.upsert({
    where: { dealershipId },
    create: {
      dealershipId,
      expiresAt,
      snapshot,
      createdById: createdById || null,
    },
    update: {
      expiresAt,
      snapshot,
      createdById: createdById || null,
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: createdById,
    entityType: "FlooringUndoSnapshot",
    entityId: row.id,
    action: "create",
    ipAddress,
  });

  return serializeUndoRow(row);
}

export async function clearFlooringUndo(
  dealershipId,
  changedById,
  ipAddress,
) {
  const existing = await prisma.flooringUndoSnapshot.findUnique({
    where: { dealershipId },
  });
  if (!existing) return { cleared: false };
  await prisma.flooringUndoSnapshot.delete({ where: { id: existing.id } });
  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "FlooringUndoSnapshot",
    entityId: existing.id,
    action: "delete",
    ipAddress,
  });
  return { cleared: true };
}

function planPayloadFromUndoConfig(config) {
  const tiers = Array.isArray(config?.tiers) ? config.tiers : [];
  const firstRate = tiers[0] ? toNumber(tiers[0].rate) : 0;
  return {
    name: "Dealer Floor Plan",
    rateType: "daily",
    baseRate: firstRate,
    buyFee: toNumber(config?.buyFee),
    isActive: !!config?.applied,
    gracePeriodDays: toNumber(config?.payoffDays) || 90,
    configJson: {
      buyFee: toNumber(config?.buyFee),
      tiers: tiers.map((t) => ({
        max: t.max == null ? null : toNumber(t.max),
        rate: toNumber(t.rate),
      })),
      applied: !!config?.applied,
      scope: config?.scope || "all",
      payoffDays: toNumber(config?.payoffDays) || 90,
      gracePeriod: toNumber(config?.gracePeriod),
    },
  };
}

export async function restoreFlooringUndo(
  dealershipId,
  changedById,
  ipAddress,
) {
  const row = await findLiveUndo(dealershipId);
  if (!row) throw notFound("Undo is no longer available.");

  const snap = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const config = snap.config && typeof snap.config === "object" ? snap.config : {};
  const vehiclesSnap = Array.isArray(snap.vehicles) ? snap.vehicles : [];

  const planFields = planPayloadFromUndoConfig(config);
  let planId = config.planId || null;
  if (planId) {
    const existingPlan = await prisma.flooringPlan.findFirst({
      where: { id: planId, dealershipId },
    });
    if (existingPlan) {
      await prisma.flooringPlan.update({
        where: { id: planId },
        data: {
          ...planFields,
          deletedAt: null,
        },
      });
    } else {
      planId = null;
    }
  }
  if (!planId) {
    const created = await prisma.flooringPlan.create({
      data: {
        dealershipId,
        createdById: changedById || null,
        effectiveDate: new Date(),
        ...planFields,
      },
    });
    planId = created.id;
  }

  const liveVehicles = await prisma.vehicle.findMany({
    where: { dealershipId, deletedAt: null },
    select: { id: true, vin: true, fees: true },
  });
  const byId = new Map(liveVehicles.map((v) => [v.id, v]));
  const byVin = new Map(
    liveVehicles.map((v) => [String(v.vin || "").toUpperCase(), v]),
  );
  const validPlanIds = new Set(
    (
      await prisma.flooringPlan.findMany({
        where: { dealershipId, deletedAt: null },
        select: { id: true },
      })
    ).map((p) => p.id),
  );
  if (planId) validPlanIds.add(planId);

  let restoredVehicleCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of vehiclesSnap) {
      const vinKey = String(item.vin || "").toUpperCase();
      const live =
        (item.id && byId.get(item.id)) || (vinKey ? byVin.get(vinKey) : null);
      if (!live) continue;

      const fees = jsonFees(live.fees);
      fees.flooringManual = !!item.flooringManual;
      fees.flooringPaidOff = !!item.flooringPaidOff;
      if (item.flooringPaidDate != null) fees.flooringPaidDate = item.flooringPaidDate;
      if (item.flooringPaidAmount != null) {
        fees.flooringPaidAmount = toNumber(item.flooringPaidAmount);
      }

      const feesAmount =
        item.flooringOverride != null
          ? toNumber(item.flooringOverride)
          : toNumber(item.flooringFees);
      const startDate = item.flooringStartDate
        ? new Date(item.flooringStartDate)
        : null;
      const wantedPlanId = item.flooringPlanId || null;
      const shouldFloor = !!(
        item.floored ||
        item.flooringStartDate ||
        item.flooringManual ||
        feesAmount > 0
      );
      const vehiclePlanId = validPlanIds.has(wantedPlanId)
        ? wantedPlanId
        : shouldFloor
          ? planId
          : null;

      await tx.vehicle.update({
        where: { id: live.id },
        data: {
          flooringFees: feesAmount,
          flooringStartDate:
            startDate && !Number.isNaN(startDate.getTime()) ? startDate : null,
          flooringPlanId: vehiclePlanId || null,
          fees,
        },
      });
      restoredVehicleCount += 1;
    }

    await tx.flooringUndoSnapshot.delete({ where: { id: row.id } });
  }, { timeout: 60000 });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "FlooringUndoSnapshot",
    entityId: row.id,
    action: "restore",
    newValues: { restoredVehicleCount, planId },
    ipAddress,
  });

  return { restoredVehicleCount, planId };
}
