import { prisma } from "../../lib/prisma.js";
import { notFound, conflict } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { pageMeta } from "../../common/validate.js";
import { serializeDecimals, roundMoney, toNum } from "../../common/serialize.js";
import { recalculateTotalInvested } from "./vehicle-expenses.service.js";
import {
  ACTIVE_INVENTORY_STATUSES,
  EXIT_INVENTORY_STATUSES,
  allVehiclesWhere,
  currentInventoryWhere,
} from "./vehicle-status.js";
import { mergeJsonFees } from "../../common/fees.js";

function toDecimal(value) {
  if (value == null) return 0;
  return Number(value);
}

function moneySum(agg, field) {
  return roundMoney(toNum(agg?._sum?.[field]) ?? 0);
}

export function serializeVehicle(vehicle) {
  if (!vehicle) return null;
  const { passwordHash, ...rest } = vehicle;
  const jackets = vehicle.dealJackets;
  const hasDealJacket = Array.isArray(jackets)
    ? jackets.length > 0
    : !!vehicle.dealJacket;
  return {
    ...serializeDecimals(rest),
    hasDealJacket,
    dealJacket: hasDealJacket,
  };
}

async function findVehicleRecord(dealershipId, vehicleId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, dealershipId, deletedAt: null },
  });
  if (!vehicle) throw notFound("Vehicle not found.");
  return vehicle;
}

export async function listVehicles(dealershipId, query) {
  const { page, limit, q, status, scope } = query;
  const where =
    scope === "inventory"
      ? { ...currentInventoryWhere(dealershipId) }
      : { dealershipId, deletedAt: null };

  // Explicit status wins over scope when both are provided.
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { vin: { contains: q, mode: "insensitive" } },
      { make: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { stockNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        flooringPlan: true,
        expenses: {
          where: { deletedAt: null },
          orderBy: { repairDate: "desc" },
        },
        deal: { include: { customer: true, salesRep: true } },
        dealJackets: { where: { deletedAt: null }, take: 1, orderBy: { createdAt: "desc" }, include: { documents: { orderBy: { uploadedAt: "desc" } } } },
      },
    }),
  ]);

  return {
    vehicles: rows.map(serializeVehicle),
    meta: {
      ...pageMeta(total, page, limit),
      scope: scope || "all",
    },
  };
}

function calendarRange(year, month /* 1–12 or null for full year */) {
  if (month == null) {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year + 1, 0, 1),
    };
  }
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  };
}

function thisMonthRange() {
  const now = new Date();
  return calendarRange(now.getFullYear(), now.getMonth() + 1);
}

function soldBaseWhere(dealershipId) {
  return {
    dealershipId,
    deletedAt: null,
    OR: [
      { status: { in: EXIT_INVENTORY_STATUSES } },
      { soldAt: { not: null } },
    ],
  };
}

/** Sold vehicles whose soldAt (or deal.saleDate fallback) falls in [start, end). */
function soldInRangeWhere(dealershipId, start, end) {
  return {
    dealershipId,
    deletedAt: null,
    OR: [
      { soldAt: { gte: start, lt: end } },
      {
        soldAt: null,
        status: { in: EXIT_INVENTORY_STATUSES },
        deal: { saleDate: { gte: start, lt: end } },
      },
    ],
  };
}

const COST_SUM_SELECT = {
  _sum: {
    acquisitionCost: true,
    auctionFees: true,
    reconditioningCost: true,
    registrationFees: true,
    flooringFees: true,
    totalInvested: true,
    soldPrice: true,
  },
};

function mapCosts(agg) {
  return {
    purchaseCost: moneySum(agg, "acquisitionCost"),
    fees: moneySum(agg, "auctionFees"),
    repairs: moneySum(agg, "reconditioningCost"),
    registrationFees: moneySum(agg, "registrationFees"),
    flooringFees: moneySum(agg, "flooringFees"),
    totalInvested: moneySum(agg, "totalInvested"),
  };
}

async function summarizeSoldInRange(dealershipId, start, end) {
  const where = soldInRangeWhere(dealershipId, start, end);
  const [count, costAgg, soldRows] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.aggregate({ where, ...COST_SUM_SELECT }),
    prisma.vehicle.findMany({
      where,
      select: {
        soldPrice: true,
        totalInvested: true,
        deal: {
          select: {
            salesTaxAmount: true,
            commissionAmount: true,
            netProfit: true,
          },
        },
      },
    }),
  ]);

  let salesTax = 0;
  let commission = 0;
  let profit = 0;
  for (const row of soldRows) {
    const deal = row.deal;
    const soldPrice = toNum(row.soldPrice) ?? 0;
    const invested = toNum(row.totalInvested) ?? 0;
    const comm = toNum(deal?.commissionAmount) ?? 0;
    salesTax += toNum(deal?.salesTaxAmount) ?? 0;
    commission += comm;
    if (deal?.netProfit != null) {
      profit += toNum(deal.netProfit) ?? 0;
    } else {
      profit += soldPrice - invested - comm;
    }
  }

  return {
    soldCount: count,
    soldValue: moneySum(costAgg, "soldPrice"),
    profit: roundMoney(profit),
    salesTax: roundMoney(salesTax),
    commission: roundMoney(commission),
    costs: mapCosts(costAgg),
  };
}

/**
 * Authoritative inventory vs total counts (+ cost rollups) for the Vehicles page.
 * Current inventory = unsold / not exited. Total = every non-deleted vehicle.
 * Optional year/month scopes Costs + sold-history KPIs without changing live lot stats.
 */
export async function getInventoryStats(dealershipId, query = {}) {
  const mode = query.mode || "all";
  const inventoryWhere = currentInventoryWhere(dealershipId);
  const allWhere = allVehiclesWhere(dealershipId);
  const soldWhere = soldBaseWhere(dealershipId);
  const liveMonth = thisMonthRange();
  const flooredCutoff = new Date();
  flooredCutoff.setDate(flooredCutoff.getDate() - 30);

  const [
    currentInventoryCount,
    totalCount,
    soldCount,
    titlesPresentCount,
    upcomingFlooredCount,
    inventoryCosts,
    allCosts,
    soldThisMonth,
  ] = await Promise.all([
    prisma.vehicle.count({ where: inventoryWhere }),
    prisma.vehicle.count({ where: allWhere }),
    prisma.vehicle.count({ where: soldWhere }),
    prisma.vehicle.count({
      where: { ...inventoryWhere, titlePresent: true },
    }),
    prisma.vehicle.count({
      where: {
        ...inventoryWhere,
        flooringStartDate: { not: null },
        OR: [
          { acquisitionDate: { lte: flooredCutoff } },
          {
            acquisitionDate: null,
            flooringStartDate: { lte: flooredCutoff },
          },
        ],
      },
    }),
    prisma.vehicle.aggregate({ where: inventoryWhere, ...COST_SUM_SELECT }),
    prisma.vehicle.aggregate({ where: allWhere, ...COST_SUM_SELECT }),
    summarizeSoldInRange(dealershipId, liveMonth.start, liveMonth.end),
  ]);

  const liveCosts = mapCosts(inventoryCosts);
  const payload = {
    currentInventoryCount,
    totalCount,
    soldCount,
    titlesPresentCount,
    upcomingFlooredCount,
    currentInventoryValue: liveCosts.totalInvested,
    costs: {
      currentInventory: liveCosts,
      allVehicles: mapCosts(allCosts),
    },
    soldThisMonth: {
      count: soldThisMonth.soldCount,
      soldValue: soldThisMonth.soldValue,
      profit: soldThisMonth.profit,
      salesTax: soldThisMonth.salesTax,
      commission: soldThisMonth.commission,
    },
    period: null,
    statuses: {
      active: ACTIVE_INVENTORY_STATUSES,
      exited: EXIT_INVENTORY_STATUSES,
    },
  };

  if (mode === "year" || mode === "month") {
    const year = query.year;
    const month = mode === "month" ? query.month : null;
    const range = calendarRange(year, month);
    const periodSold = await summarizeSoldInRange(
      dealershipId,
      range.start,
      range.end,
    );
    payload.period = {
      mode,
      year,
      month: month ?? null,
      soldCount: periodSold.soldCount,
      soldValue: periodSold.soldValue,
      profit: periodSold.profit,
      costs: {
        ...periodSold.costs,
        salesTax: periodSold.salesTax,
        commission: periodSold.commission,
      },
    };
  }

  return payload;
}

export async function getVehicle(dealershipId, vehicleId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, dealershipId, deletedAt: null },
    include: {
      flooringPlan: true,
      expenses: { where: { deletedAt: null }, orderBy: { repairDate: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      pricingHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      deal: { include: { customer: true, salesRep: true } },
      dealJackets: { where: { deletedAt: null }, take: 1, orderBy: { createdAt: "desc" }, include: { documents: { orderBy: { uploadedAt: "desc" } } } },
    },
  });
  if (!vehicle) throw notFound("Vehicle not found.");
  return serializeVehicle(vehicle);
}

export async function createVehicle(dealershipId, data, createdById, ipAddress) {
  const normalizedVin = (data.vin || "").toUpperCase().trim();
  const duplicate = await prisma.vehicle.findFirst({
    where: { dealershipId, vin: normalizedVin, deletedAt: null },
  });
  if (duplicate) throw conflict("A vehicle with this VIN already exists.");

  if (data.flooringPlanId) {
    const plan = await prisma.flooringPlan.findFirst({
      where: { id: data.flooringPlanId, dealershipId, deletedAt: null },
    });
    if (!plan) throw notFound("Flooring plan not found.");
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      dealershipId,
      createdById,
      vin: normalizedVin,
      stockNumber: data.stockNumber ?? null,
      make: data.make,
      model: data.model,
      trim: data.trim ?? null,
      year: data.year,
      bodyStyle: data.bodyStyle ?? null,
      exteriorColor: data.exteriorColor ?? null,
      interiorColor: data.interiorColor ?? null,
      drivetrain: data.drivetrain ?? null,
      fuelType: data.fuelType ?? null,
      engine: data.engine ?? null,
      transmission: data.transmission ?? null,
      mileage: data.mileage ?? null,
      doors: data.doors ?? null,
      acquisitionDate: data.acquisitionDate ?? null,
      acquisitionCost: data.acquisitionCost ?? null,
      askingPrice: data.askingPrice ?? null,
      marketValue: data.marketValue ?? null,
      wholesalePrice: data.wholesalePrice ?? null,
      reconditioningCost: data.reconditioningCost ?? 0,
      registrationFees: data.registrationFees ?? 0,
      auctionFees: data.auctionFees ?? 0,
      flooringFees: data.flooringFees ?? 0,
      titleStatus: data.titleStatus ?? null,
      licensePlate: data.licensePlate ?? null,
      state: data.state ?? null,
      sellerAuction: data.sellerAuction ?? null,
      purchaseType: data.purchaseType ?? null,
      notes: data.notes ?? null,
      titleReceived: data.titleReceived ?? true,
      titlePresent:
        data.titlePresent ?? data.titleReceived ?? true,
      flooringStartDate: data.flooringStartDate ?? null,
      flooringPlanId: data.flooringPlanId ?? null,
      status: data.status ?? "in_stock",
      isWholesale: data.isWholesale ?? false,
    },
  });

  const updated = await recalculateTotalInvested(vehicle.id);

  if (data.askingPrice != null || data.marketValue != null) {
    await prisma.pricingHistory.create({
      data: {
        vehicleId: vehicle.id,
        dealershipId,
        askingPrice: data.askingPrice ?? null,
        marketValue: data.marketValue ?? null,
        changedById: createdById,
        note: "Initial pricing",
      },
    });
  }

  await writeAuditLog({
    dealershipId,
    changedById: createdById,
    entityType: "Vehicle",
    entityId: vehicle.id,
    action: "create",
    newValues: {
      vin: vehicle.vin,
      stockNumber: vehicle.stockNumber,
      titlePresent: vehicle.titlePresent,
      titleReceived: vehicle.titleReceived,
    },
    ipAddress,
  });

  return serializeVehicle(updated);
}

const DEAL_SYNC_KEYS = [
  "salesTaxAmount",
  "licenseFees",
  "rosNumber",
  "commissionAmount",
  "commissionRate",
  "commissionType",
  "saleDate",
  "salesRepId",
];

export async function updateVehicle(
  dealershipId,
  vehicleId,
  data,
  changedById,
  ipAddress,
) {
  const existing = await findVehicleRecord(dealershipId, vehicleId);

  // Allow cost / sold-price corrections from Deal Jacket (mock parity).
  // Previously blocked sold/loss money edits, which made DJ inline edits a no-op.

  const normalizedVin = data.vin ? data.vin.toUpperCase().trim() : null;

  if (normalizedVin && normalizedVin !== existing.vin) {
    const duplicate = await prisma.vehicle.findFirst({
      where: {
        dealershipId,
        vin: normalizedVin,
        deletedAt: null,
        id: { not: vehicleId },
      },
    });
    if (duplicate) throw conflict("A vehicle with this VIN already exists.");
  }

  if (data.flooringPlanId) {
    const plan = await prisma.flooringPlan.findFirst({
      where: { id: data.flooringPlanId, dealershipId, deletedAt: null },
    });
    if (!plan) throw notFound("Flooring plan not found.");
  }

  const pricingChanged =
    (data.askingPrice !== undefined && data.askingPrice !== toDecimal(existing.askingPrice)) ||
    (data.marketValue !== undefined && data.marketValue !== toDecimal(existing.marketValue));

  const dealSync = {};
  for (const key of DEAL_SYNC_KEYS) {
    if (data[key] !== undefined) dealSync[key] = data[key];
  }

  const updateData = { ...data };
  if (normalizedVin) updateData.vin = normalizedVin;
  delete updateData.status;
  for (const key of DEAL_SYNC_KEYS) delete updateData[key];
  if (updateData.fees !== undefined) {
    updateData.fees = mergeJsonFees(existing.fees, updateData.fees);
  }

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: updateData,
  });

  // Keep linked Deal + Customer + Jacket in sync for Deal Jacket autosave.
  const deal = await prisma.deal.findFirst({
    where: { vehicleId, dealershipId, deletedAt: null },
    select: {
      id: true,
      customerId: true,
      salesTaxAmount: true,
      licenseFees: true,
      soldPriceBeforeTax: true,
      commissionAmount: true,
      commissionRate: true,
      commissionType: true,
      salesRepId: true,
      rosNumber: true,
      notes: true,
      saleDate: true,
      totalPriceOtd: true,
    },
  });

  const customerFieldsTouched =
    data.customerName !== undefined ||
    data.customerPhone !== undefined ||
    data.customerEmail !== undefined ||
    data.customerAddress !== undefined;

  if (deal?.customerId && customerFieldsTouched) {
    const customerPatch = {};
    if (data.customerName !== undefined) {
      const name = (data.customerName || "").trim();
      if (name) customerPatch.name = name;
    }
    if (data.customerPhone !== undefined) {
      customerPatch.phone = data.customerPhone || null;
    }
    if (data.customerEmail !== undefined) {
      customerPatch.email = data.customerEmail || null;
    }
    if (data.customerAddress !== undefined) {
      customerPatch.address = data.customerAddress || null;
    }
    if (Object.keys(customerPatch).length) {
      await prisma.customer.update({
        where: { id: deal.customerId },
        data: customerPatch,
      });
    }
  }

  if (deal) {
    const dealPatch = {};
    if (dealSync.salesTaxAmount !== undefined) {
      dealPatch.salesTaxAmount = dealSync.salesTaxAmount ?? 0;
    }
    if (dealSync.licenseFees !== undefined) {
      dealPatch.licenseFees = dealSync.licenseFees ?? 0;
    }
    if (data.soldPrice !== undefined) {
      dealPatch.soldPriceBeforeTax = data.soldPrice;
    }
    if (dealSync.commissionAmount !== undefined) {
      dealPatch.commissionAmount = dealSync.commissionAmount;
    }
    if (dealSync.commissionRate !== undefined) {
      dealPatch.commissionRate = dealSync.commissionRate;
    }
    if (dealSync.commissionType !== undefined) {
      dealPatch.commissionType = dealSync.commissionType;
    }
    if (dealSync.rosNumber !== undefined) {
      dealPatch.rosNumber = dealSync.rosNumber || null;
    }
    if (data.notes !== undefined) {
      dealPatch.notes = data.notes || null;
    }
    if (dealSync.saleDate !== undefined && dealSync.saleDate) {
      dealPatch.saleDate = dealSync.saleDate;
    }
    if (dealSync.salesRepId !== undefined) {
      const nextRepId = dealSync.salesRepId || null;
      if (nextRepId) {
        const repUser = await prisma.user.findFirst({
          where: {
            id: nextRepId,
            dealershipId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!repUser) throw notFound("Sales rep not found.");
      }
      dealPatch.salesRepId = nextRepId;
    }

    const nextSold =
      data.soldPrice !== undefined
        ? toDecimal(data.soldPrice)
        : toDecimal(deal.soldPriceBeforeTax);
    const nextTax =
      dealSync.salesTaxAmount !== undefined
        ? toDecimal(dealSync.salesTaxAmount)
        : toDecimal(deal.salesTaxAmount);
    const nextLic =
      dealSync.licenseFees !== undefined
        ? toDecimal(dealSync.licenseFees)
        : toDecimal(deal.licenseFees);
    if (
      data.soldPrice !== undefined ||
      dealSync.salesTaxAmount !== undefined ||
      dealSync.licenseFees !== undefined
    ) {
      dealPatch.totalPriceOtd = nextSold + nextTax + nextLic;
    }

    if (Object.keys(dealPatch).length) {
      await prisma.deal.update({ where: { id: deal.id }, data: dealPatch });
    }

    const jacket = await prisma.dealJacket.findFirst({
      where: { vehicleId, dealershipId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (jacket) {
      const jacketPatch = {};
      if (data.soldPrice !== undefined) jacketPatch.soldPrice = data.soldPrice;
      if (dealSync.salesTaxAmount !== undefined) {
        jacketPatch.totalTax = dealSync.salesTaxAmount ?? 0;
      }
      if (
        data.soldPrice !== undefined ||
        dealSync.salesTaxAmount !== undefined ||
        dealSync.licenseFees !== undefined
      ) {
        jacketPatch.totalSalePrice = nextSold + nextTax + nextLic;
      }
      if (dealSync.commissionAmount !== undefined) {
        jacketPatch.commissionAmount = dealSync.commissionAmount ?? 0;
      }
      if (dealSync.rosNumber !== undefined) {
        jacketPatch.rosNumber = dealSync.rosNumber || null;
      }
      if (data.notes !== undefined) jacketPatch.notes = data.notes || null;
      if (dealSync.saleDate !== undefined && dealSync.saleDate) {
        jacketPatch.dateSold = dealSync.saleDate;
      }
      if (dealSync.salesRepId !== undefined) {
        jacketPatch.salesRepId = dealSync.salesRepId || null;
      }
      if (data.soldPrice !== undefined) {
        const invested = toDecimal(jacket.totalInvested);
        const commission = toDecimal(
          dealSync.commissionAmount !== undefined
            ? dealSync.commissionAmount
            : jacket.commissionAmount,
        );
        const gross = nextSold - invested;
        jacketPatch.profitGross = gross;
        jacketPatch.profitNet = gross - commission;
      }
      if (Object.keys(jacketPatch).length) {
        await prisma.dealJacket.update({
          where: { id: jacket.id },
          data: jacketPatch,
        });
      }
    }
  }

  if (pricingChanged) {
    await prisma.pricingHistory.create({
      data: {
        vehicleId,
        dealershipId,
        askingPrice: data.askingPrice ?? existing.askingPrice,
        marketValue: data.marketValue ?? existing.marketValue,
        changedById,
      },
    });
  }

  await recalculateTotalInvested(vehicleId);

  const withRelations = await prisma.vehicle.findFirst({
    where: { id: vehicleId, dealershipId, deletedAt: null },
    include: {
      flooringPlan: true,
      expenses: { where: { deletedAt: null }, orderBy: { repairDate: "desc" } },
      deal: { include: { customer: true, salesRep: true } },
      dealJackets: {
        where: { deletedAt: null },
        take: 1,
        orderBy: { createdAt: "desc" },
        include: { documents: { orderBy: { uploadedAt: "desc" } } },
      },
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "Vehicle",
    entityId: vehicleId,
    action: "update",
    oldValues: {
      vin: existing.vin,
      titlePresent: existing.titlePresent,
      titleReceived: existing.titleReceived,
    },
    newValues: {
      vin: withRelations?.vin,
      titlePresent: withRelations?.titlePresent,
      titleReceived: withRelations?.titleReceived,
    },
    ipAddress,
  });

  return serializeVehicle(withRelations);
}

export async function deleteVehicle(
  dealershipId,
  vehicleId,
  changedById,
  ipAddress,
) {
  const existing = await findVehicleRecord(dealershipId, vehicleId);
  const updated = await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "Vehicle",
    entityId: vehicleId,
    action: "soft_delete",
    oldValues: { vin: existing.vin },
    ipAddress,
  });

  return serializeVehicle(updated);
}

export async function changeVehicleStatus(
  dealershipId,
  vehicleId,
  { status, note },
  changedById,
  ipAddress,
) {
  const existing = await findVehicleRecord(dealershipId, vehicleId);
  const exitStatuses = new Set([
    "sold",
    "loss",
    "wholesale",
    "out_of_state_sale",
  ]);
  const activeStatuses = new Set([
    "in_stock",
    "needs_attention",
    "pending_deal",
    "arbitration",
  ]);
  const returningToInventory = activeStatuses.has(status);
  if (
    existing.status === status &&
    !(returningToInventory && existing.soldAt)
  ) {
    return serializeVehicle(existing);
  }
  const [updated] = await prisma.$transaction([
    prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        status,
        soldAt: exitStatuses.has(status)
          ? existing.soldAt || new Date()
          : returningToInventory
            ? null
            : existing.soldAt,
        soldPrice: returningToInventory ? null : existing.soldPrice,
        isWholesale:
          status === "wholesale"
            ? true
            : returningToInventory
              ? false
              : existing.isWholesale,
      },
    }),
    prisma.vehicleStatusHistory.create({
      data: {
        vehicleId,
        dealershipId,
        fromStatus: existing.status,
        toStatus: status,
        note: note ?? null,
        changedById,
      },
    }),
  ]);

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "Vehicle",
    entityId: vehicleId,
    action: "status_change",
    oldValues: { status: existing.status },
    newValues: { status },
    ipAddress,
  });

  return serializeVehicle(updated);
}