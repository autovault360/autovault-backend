import { prisma } from "../../lib/prisma.js";
import { notFound, conflict, forbidden } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { toNum, roundMoney } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";
import {
  resolveSalesRepCommission,
  computeCommissionAmount,
} from "../../common/commission.js";
import {
  nextJacketNumber,
  createJacketActivity,
  serializeDealJacket,
  generateDealNumber,
} from "../jackets/jackets.service.js";
import { nextPlaceholderVin, normalizeVin } from "../../common/vin.js";
import { mergeJsonFees } from "../../common/fees.js";

function serializeVehicle(v) {
  if (!v) return null;
  const hasDealJacket = !!(v.dealJackets && v.dealJackets[0]);
  return {
    id: v.id,
    vin: v.vin,
    stockNumber: v.stockNumber,
    make: v.make,
    model: v.model,
    trim: v.trim,
    year: v.year,
    status: v.status,
    soldAt: v.soldAt,
    soldPrice: toNum(v.soldPrice),
    totalInvested: toNum(v.totalInvested),
    askingPrice: toNum(v.askingPrice),
    hasDealJacket,
    dealJacket: hasDealJacket,
    customer: v.deal?.customer
      ? {
          id: v.deal.customer.id,
          name: v.deal.customer.name,
          phone: v.deal.customer.phone,
          email: v.deal.customer.email,
        }
      : null,
    deal: v.deal
      ? {
          id: v.deal.id,
          saleDate: v.deal.saleDate,
          totalPriceOtd: toNum(v.deal.totalPriceOtd),
          netProfit: toNum(v.deal.netProfit),
        }
      : null,
    dealJacketRecord: v.dealJackets?.[0]
      ? serializeDealJacket(v.dealJackets[0])
      : null,
  };
}

async function assertVehicleForDeal(vehicleId, dealershipId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, dealershipId, deletedAt: null },
    include: {
      expenses: { where: { deletedAt: null } },
      deal: true,
      dealJackets: { where: { deletedAt: null }, take: 1 },
    },
  });
  if (!vehicle) throw notFound("Vehicle not found.");
  if (vehicle.status === "loss") {
    throw conflict("Vehicle is already marked as a loss.");
  }
  // Already sold WITH a jacket → cannot mark-sold / create jacket again
  if (vehicle.dealJackets.length > 0) {
    throw conflict("A deal jacket already exists for this vehicle.");
  }
  // Sold without jacket is allowed — jacket will be created below
  if (vehicle.status === "sold" && vehicle.deal) {
    return vehicle;
  }
  if (vehicle.status === "sold" && !vehicle.deal) {
    return vehicle;
  }
  if (vehicle.deal) {
    throw conflict("A deal already exists for this vehicle.");
  }
  return vehicle;
}

async function resolveCustomer(dealershipId, payload, createdById, tx) {
  if (payload.customerId) {
    const existing = await tx.customer.findFirst({
      where: {
        id: payload.customerId,
        dealershipId,
        deletedAt: null,
      },
    });
    if (!existing) throw notFound("Customer not found.");
    await tx.customer.update({
      where: { id: existing.id },
      data: { status: "customer" },
    });
    return existing.id;
  }

  const phone = payload.customerPhone?.trim() || null;
  const email = payload.customerEmail?.trim() || null;

  let existing = null;
  if (phone || email) {
    existing = await tx.customer.findFirst({
      where: {
        dealershipId,
        deletedAt: null,
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (existing) {
    await tx.customer.update({
      where: { id: existing.id },
      data: {
        name: payload.customerName ?? existing.name,
        phone: phone ?? existing.phone,
        email: email ?? existing.email,
        address: payload.customerAddress ?? existing.address,
        city: payload.customerCity ?? existing.city,
        state: payload.customerState ?? existing.state,
        zip: payload.customerZip ?? existing.zip,
        status: "customer",
      },
    });
    return existing.id;
  }

  const created = await tx.customer.create({
    data: {
      dealershipId,
      type: "individual",
      name: payload.customerName,
      phone,
      email,
      address: payload.customerAddress ?? null,
      city: payload.customerCity ?? null,
      state: payload.customerState ?? null,
      zip: payload.customerZip ?? null,
      status: "customer",
      salesRepId: payload.salesRepId ?? null,
      createdById,
    },
  });
  return created.id;
}

export async function markSold(vehicleId, payload, ctx) {
  const { dealershipId, userId, role } = ctx;
  if (!["owner", "manager", "platform_owner"].includes(role)) {
    throw forbidden("Only managers can mark vehicles as sold.");
  }

  const vehicle = await assertVehicleForDeal(vehicleId, dealershipId);
  const soldPrice = roundMoney(payload.soldPrice);
  const totalInvested = toNum(vehicle.totalInvested) ?? 0;
  const grossProfit = roundMoney(soldPrice - totalInvested);
  const resolved = payload.salesRepId
    ? await resolveSalesRepCommission(payload.salesRepId)
    : { type: "percentage", rate: 0, amount: null };
  const commissionType =
    payload.commissionType ||
    (payload.commissionAmount != null && payload.commissionRate == null
      ? "manual"
      : resolved.type === "flat"
        ? "flat"
        : "percentage");
  const commissionRate =
    payload.commissionRate ??
    (commissionType === "flat" ? null : resolved.rate ?? 0);
  const commissionAmount = computeCommissionAmount(grossProfit, {
    commissionAmount: payload.commissionAmount,
    commissionRate:
      commissionType === "flat"
        ? (payload.commissionRate ?? resolved.amount)
        : commissionRate,
    commissionType,
    resolved,
  });

  const salesTax = roundMoney(payload.salesTaxAmount ?? 0);
  const licenseFees = roundMoney(payload.licenseFees ?? 0);
  const feesObj = mergeJsonFees(
    vehicle.fees,
    payload.fees && typeof payload.fees === "object" ? payload.fees : {},
  );
  const addOnItems = Array.isArray(feesObj.addOnItems) ? feesObj.addOnItems : [];
  const addOnCostFromItems = roundMoney(
    addOnItems.reduce((s, a) => s + (Number(a.cost) || 0), 0),
  );
  const addOnRevFromItems = roundMoney(
    addOnItems.reduce((s, a) => s + (Number(a.price) || 0), 0),
  );
  const hasItemizedAddOnCosts = addOnItems.some(
    (a) => a.cost != null && Number(a.cost) > 0,
  );
  // additionalExpenses = dealer add-on COGS (not upcharge revenue).
  // Prefer payload; else itemized costs; else legacy scalar when items lack cost.
  const additionalExpenses = roundMoney(
    payload.additionalExpenses != null
      ? payload.additionalExpenses
      : hasItemizedAddOnCosts
        ? addOnCostFromItems
        : addOnCostFromItems || 0,
  );
  const totalPriceOtd = roundMoney(
    soldPrice + addOnRevFromItems + salesTax + licenseFees,
  );
  const netCheckRaw =
    payload.netCheck ??
    (feesObj.netCheck != null ? feesObj.netCheck : null);
  const hasNetCheck =
    netCheckRaw !== null &&
    netCheckRaw !== undefined &&
    netCheckRaw !== "";
  // Financed: Net Check already includes dealer reserve / add-on upcharges.
  // Cash/retail: sold price + add-on revenue − invested − add-on cost − commission.
  const profitNet = hasNetCheck
    ? roundMoney(
        Number(netCheckRaw) -
          salesTax -
          licenseFees -
          totalInvested -
          additionalExpenses -
          commissionAmount,
      )
    : roundMoney(
        soldPrice +
          addOnRevFromItems -
          totalInvested -
          additionalExpenses -
          commissionAmount,
      );
  const saleDate = payload.saleDate || vehicle.soldAt || new Date();

  // Sequential writes (not interactive $transaction) — Neon pooled
  // connections drop interactive transactions mid-flight.
  let customerId = vehicle.deal?.customerId ?? null;
  if (!customerId) {
    customerId = await resolveCustomer(
      dealershipId,
      payload,
      userId,
      prisma,
    );
  } else if (payload.customerName || payload.customerPhone || payload.customerEmail) {
    // Refresh customer contact from jacket form when completing a pending jacket
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(payload.customerName && { name: payload.customerName }),
        ...(payload.customerPhone !== undefined && {
          phone: payload.customerPhone?.trim() || null,
        }),
        ...(payload.customerEmail !== undefined && {
          email: payload.customerEmail?.trim() || null,
        }),
        ...(payload.customerAddress !== undefined && {
          address: payload.customerAddress,
        }),
        status: "customer",
      },
    });
  }

  let deal = vehicle.deal;
  if (!deal) {
    deal = await prisma.deal.create({
      data: {
        vehicleId,
        customerId,
        dealershipId,
        saleDate,
        totalPriceOtd,
        totalCollected: totalPriceOtd,
        salesTaxAmount: salesTax,
        licenseFees,
        soldPriceBeforeTax: soldPrice,
        commissionAmount,
        commissionRate:
          commissionType === "flat" || commissionType === "manual"
            ? null
            : commissionRate != null && commissionRate > 0
              ? commissionRate
              : null,
        commissionType,
        netProfit: profitNet,
        salesRepId: payload.salesRepId ?? null,
        rosNumber: payload.rosNumber ?? null,
        notes: payload.notes ?? null,
        createdById: userId,
      },
    });
  } else {
    deal = await prisma.deal.update({
      where: { id: deal.id },
      data: {
        saleDate,
        totalPriceOtd,
        totalCollected: totalPriceOtd,
        salesTaxAmount: salesTax,
        licenseFees,
        soldPriceBeforeTax: soldPrice,
        commissionAmount,
        commissionRate:
          commissionType === "flat" || commissionType === "manual"
            ? null
            : commissionRate != null && commissionRate > 0
              ? commissionRate
              : null,
        commissionType: commissionType ?? deal.commissionType ?? "percentage",        netProfit: profitNet,
        salesRepId: payload.salesRepId ?? deal.salesRepId,
        rosNumber: payload.rosNumber ?? deal.rosNumber,
        notes: payload.notes ?? deal.notes,
        customerId,
      },
    });
  }

  const jacketNumber = await nextJacketNumber(dealershipId, prisma);

  const jacket = await prisma.dealJacket.create({
    data: {
      dealershipId,
      vehicleId,
      customerId,
      dealId: deal.id,
      salesRepId: payload.salesRepId ?? deal.salesRepId ?? null,
      jacketNumber,
      soldPrice,
      totalTax: salesTax,
      totalSalePrice: totalPriceOtd,
      totalInvested,
      additionalExpenses,
      commissionAmount,
      profitGross: grossProfit,
      profitNet,
      workflowStatus: "approved",
      dateSold: saleDate,
      rosNumber: payload.rosNumber ?? null,
      notes: payload.notes ?? null,
      fees: hasNetCheck
        ? { ...feesObj, netCheck: roundMoney(Number(netCheckRaw)) }
        : feesObj,
      createdById: userId,
      reviewedById: userId,
      reviewedAt: new Date(),
    },
  });

  const updatedVehicle = await prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      status: "sold",
      soldAt: saleDate,
      soldPrice,
      ...(payload.titleReceived !== undefined
        ? { titleReceived: !!payload.titleReceived }
        : {}),
      ...(payload.titlePresent !== undefined
        ? { titlePresent: !!payload.titlePresent }
        : payload.titleReceived !== undefined
          ? { titlePresent: !!payload.titleReceived }
          : {}),
    },
  });

  if (vehicle.status !== "sold") {
    await prisma.vehicleStatusHistory.create({
      data: {
        vehicleId,
        dealershipId,
        fromStatus: vehicle.status,
        toStatus: "sold",
        note: `Sold via jacket ${jacketNumber}`,
        changedById: userId,
      },
    });
  }

  await createJacketActivity(
    {
      dealJacketId: jacket.id,
      action: "created",
      actorId: userId,
      actorName: ctx.actorName ?? "System",
      oldStatus: null,
      newStatus: "approved",
      detail: {
        source:
          vehicle.status === "sold"
            ? "complete_sold_jacket"
            : "mark_sold",
      },
    },
    prisma,
  );

  if (jacket.salesRepId && toNum(jacket.commissionAmount) > 0) {
    const existingComm = await prisma.salesRepCommission.findFirst({
      where: { dealJacketId: jacket.id },
    });
    if (!existingComm) {
      const resolved = await resolveSalesRepCommission(jacket.salesRepId);
      const ledgerRate =
        resolved.type === "flat"
          ? resolved.amount ?? 0
          : resolved.rate ?? 0;
      await prisma.salesRepCommission.create({
        data: {
          dealershipId,
          salesRepId: jacket.salesRepId,
          dealJacketId: jacket.id,
          commissionAmount: toNum(jacket.commissionAmount) ?? 0,
          grossProfit: toNum(jacket.profitGross) ?? 0,
          soldPrice: toNum(jacket.soldPrice) ?? 0,
          commissionRate: ledgerRate,
          status: "approved",
        },
      });
    }
  }

  await createJacketActivity(
    {
      dealJacketId: jacket.id,
      action: "approved",
      actorId: userId,
      actorName: ctx.actorName ?? "System",
      oldStatus: null,
      newStatus: "approved",
      detail: { source: "mark_sold", autoApproved: true },
    },
    prisma,
  );

  const result = { deal, jacket, vehicle: updatedVehicle };
  await writeAuditLog({
    dealershipId,
    changedById: userId,
    entityType: "Vehicle",
    entityId: vehicleId,
    action:
      vehicle.status === "sold" ? "complete_deal_jacket" : "mark_sold",
    newValues: {
      soldPrice,
      grossProfit,
      dealId: result.deal.id,
      dealJacketId: result.jacket.id,
      hasDealJacket: true,
    },
    ipAddress: ctx.ipAddress,
  });

  return {
    deal: serializeRecord(result.deal),
    dealJacket: serializeDealJacket(result.jacket),
    vehicle: serializeVehicle({
      ...result.vehicle,
      deal: result.deal,
      dealJackets: [result.jacket],
    }),
  };
}

/**
 * Import a historically sold vehicle and auto-create its deal jacket.
 * Sale data is stored on the vehicle, a Deal record is created for
 * customer/tax/commission tracking, and a completed DealJacket is
 * created automatically so hasDealJacket is true from the start.
 */
export async function importPreviousSold(payload, ctx) {
  const { dealershipId, userId, role, plan } = ctx;
  if (!["owner", "manager", "platform_owner"].includes(role)) {
    throw forbidden("Only managers can import previously sold vehicles.");
  }

  let vin = normalizeVin(payload.vin);
  if (!vin) vin = await nextPlaceholderVin(dealershipId);
  const duplicate = await prisma.vehicle.findFirst({
    where: { dealershipId, vin, deletedAt: null },
  });
  if (duplicate) throw conflict("A vehicle with this VIN already exists.");

  const price = roundMoney(payload.acquisitionCost);
  const fees = roundMoney(payload.auctionFees ?? 0);
  const repairs = roundMoney(payload.reconditioningCost ?? 0);
  const other = roundMoney(payload.otherExpenses ?? 0);
  const flooring = roundMoney(payload.flooringFees ?? 0);
  const addOnItems = Array.isArray(payload.addOnItems)
    ? payload.addOnItems
        .map((a) => ({
          desc: String(a.desc || a.name || "").trim(),
          type: String(a.type || a.category || "Add-On").trim() || "Add-On",
          price: roundMoney(a.price ?? 0),
          cost: roundMoney(a.cost ?? 0),
        }))
        .filter(
          (a) =>
            a.cost > 0 ||
            a.price > 0 ||
            a.desc ||
            (a.type && a.type !== "Add-On"),
        )
    : [];
  const addOnsFromItems = roundMoney(
    addOnItems.reduce((s, a) => s + (Number(a.cost) || 0), 0),
  );
  const addOnRevenue = roundMoney(
    addOnItems.reduce((s, a) => s + (Number(a.price) || 0), 0),
  );
  const hasItemizedCosts = addOnItems.some(
    (a) => a.cost != null && Number(a.cost) > 0,
  );
  const addOns = roundMoney(
    hasItemizedCosts
      ? addOnsFromItems
      : payload.addOnsCost != null
        ? payload.addOnsCost
        : addOnsFromItems,
  );
  const soldPrice = roundMoney(payload.soldPrice);
  const salesTax = roundMoney(payload.salesTaxAmount ?? 0);
  const licenseFees = roundMoney(payload.licenseFees ?? 0);
  const netCheckRaw = payload.netCheck;
  const hasNetCheck =
    netCheckRaw !== null &&
    netCheckRaw !== undefined &&
    netCheckRaw !== "";
  const jacketFees = {
    addOnItems,
    ...(hasNetCheck ? { netCheck: roundMoney(Number(netCheckRaw) || 0) } : {}),
    ...(payload.netCheckReason
      ? { netCheckReason: String(payload.netCheckReason).slice(0, 200) }
      : {}),
    ...(payload.netCheckNotes
      ? { netCheckNotes: String(payload.netCheckNotes).slice(0, 2000) }
      : {}),
  };

  const totalInvested = roundMoney(
    price + fees + repairs + other + flooring + addOns,
  );

  const allowCommission = plan === "growing_dealership";
  const salesRepId = allowCommission ? payload.salesRepId ?? null : null;
  let commissionAmount = 0;
  let commissionRate = 0;
  let commissionType = "manual";
  if (allowCommission && salesRepId) {
    const resolved = await resolveSalesRepCommission(salesRepId);
    commissionType =
      payload.commissionType ||
      (payload.commissionAmount != null && payload.commissionRate == null
        ? "manual"
        : resolved.type === "flat"
          ? "flat"
          : "percentage");
    commissionRate =
      payload.commissionRate ??
      (resolved.type === "flat" ? resolved.amount ?? 0 : resolved.rate ?? 0);
    commissionAmount = computeCommissionAmount(soldPrice - totalInvested, {
      commissionAmount: payload.commissionAmount,
      commissionRate,
      commissionType,
      resolved,
    });
  } else if (allowCommission && payload.commissionAmount != null) {
    commissionAmount = roundMoney(payload.commissionAmount);
    commissionType = payload.commissionType || "manual";
  }

  const year = payload.year || new Date(payload.acquisitionDate).getFullYear();
  const make = (payload.make || "Vehicle").trim() || "Vehicle";
  const model = (payload.model || "—").trim() || "—";

  const vehicle = await prisma.vehicle.create({
    data: {
      dealershipId,
      createdById: userId,
      vin,
      year,
      make,
      model,
      acquisitionDate: payload.acquisitionDate,
      acquisitionCost: price,
      auctionFees: fees,
      reconditioningCost: repairs + other + addOns,
      flooringFees: flooring,
      flooringStartDate: flooring > 0 ? payload.acquisitionDate : null,
      totalInvested,
      titleReceived: payload.titleReceived !== false,
      titlePresent:
        payload.titlePresent !== undefined
          ? !!payload.titlePresent
          : payload.titleReceived !== false,
      status: "sold",
      soldAt: payload.saleDate,
      soldPrice,
      notes:
        payload.notes ||
        "Imported as a previously sold vehicle.",
    },
  });

  await prisma.vehicleStatusHistory.create({
    data: {
      vehicleId: vehicle.id,
      dealershipId,
      fromStatus: null,
      toStatus: "sold",
      note: "Historical import — previously sold vehicle",
      changedById: userId,
    },
  });

  const customerPayload = {
    customerName: payload.customerName || "Previous customer",
    customerPhone: payload.customerPhone,
    customerEmail: payload.customerEmail,
    salesRepId,
  };
  const customerId = await resolveCustomer(
    dealershipId,
    customerPayload,
    userId,
    prisma,
  );

  const grossProfit = roundMoney(soldPrice + addOnRevenue - totalInvested);
  const totalPriceOtd = roundMoney(soldPrice + addOnRevenue + salesTax + licenseFees);
  const profitNet = hasNetCheck
    ? roundMoney(
        Number(netCheckRaw) -
          salesTax -
          licenseFees -
          totalInvested -
          commissionAmount,
      )
    : roundMoney(grossProfit - commissionAmount);

  // Deal stores sale/customer data; deal jacket is auto-created below.
  const deal = await prisma.deal.create({
    data: {
      vehicleId: vehicle.id,
      customerId,
      dealershipId,
      saleDate: payload.saleDate,
      totalPriceOtd,
      totalCollected: totalPriceOtd,
      salesTaxAmount: salesTax,
      licenseFees,
      soldPriceBeforeTax: soldPrice,
      commissionAmount,
      commissionRate:
        commissionType === "flat" || commissionType === "manual"
          ? null
          : commissionRate > 0
            ? commissionRate
            : null,
      commissionType,
      netProfit: profitNet,
      salesRepId,
      notes: "Historical import",
      createdById: userId,
    },
  });

  // Auto-create the deal jacket for previously sold vehicles.
  const jacketNumber = await nextJacketNumber(dealershipId);
  let rosNumber = payload.rosNumber || null;
  if (!rosNumber) {
    try {
      const generated = await generateDealNumber(dealershipId);
      rosNumber = generated.rosNumber;
    } catch (_) {
      rosNumber = `DL-${Date.now().toString().slice(-5)}`;
    }
  }
  const jacket = await prisma.dealJacket.create({
    data: {
      dealershipId,
      vehicleId: vehicle.id,
      customerId,
      dealId: deal.id,
      salesRepId,
      jacketNumber,
      soldPrice,
      totalTax: salesTax,
      totalSalePrice: totalPriceOtd,
      downPayment: 0,
      amountFinanced: 0,
      balanceDue: totalPriceOtd,
      totalInvested,
      additionalExpenses: addOns,
      commissionAmount,
      profitGross: grossProfit,
      profitNet,
      tradeInAllowance: 0,
      warrantyAmount: 0,
      gapAmount: 0,
      fees: jacketFees,
      lender: null,
      rosNumber,
      notes: payload.notes || "Imported as a previously sold vehicle.",
      dealType: "Retail",
      workflowStatus: "approved",
      dateSold: payload.saleDate,
      createdById: userId,
    },
  });

  await createJacketActivity({
    dealJacketId: jacket.id,
    action: "created",
    actorId: userId,
    actorName: ctx.actorName ?? "User",
    oldStatus: null,
    newStatus: "approved",
  });

  const expenseRows = [];
  if (repairs > 0) {
    expenseRows.push({
      name: "Recon / repairs (historical)",
      subcategory: "Repairs",
      amount: repairs,
    });
  }
  if (other > 0) {
    expenseRows.push({
      name: "Other expenses (historical)",
      subcategory: "Other",
      amount: other,
    });
  }
  if (flooring > 0) {
    expenseRows.push({
      name: "Flooring (historical)",
      subcategory: "Other",
      amount: flooring,
    });
  }
  for (const row of expenseRows) {
    await prisma.dealershipExpense.create({
      data: {
        dealershipId,
        expenseDate: payload.saleDate,
        category: "Vehicle Expense",
        subcategory: row.subcategory,
        name: row.name,
        vendor: row.name,
        description: row.name,
        amount: row.amount,
        status: "paid",
        recurringFrequency: "One-Time",
        isRecurring: false,
        vehicleVin: vin,
        notes:
          "[vehicle-cost] Historical import — already included in vehicle cost.",
        taxDeductible: true,
        createdById: userId,
      },
    });
  }

  await writeAuditLog({
    dealershipId,
    changedById: userId,
    entityType: "Vehicle",
    entityId: vehicle.id,
    action: "previous_sold_import",
    newValues: {
      vin,
      soldPrice,
      totalInvested,
      dealId: deal.id,
      dealJacketId: jacket.id,
      hasDealJacket: true,
      titlePresent: vehicle.titlePresent,
      titleReceived: vehicle.titleReceived,
    },
    ipAddress: ctx.ipAddress,
  });

  const vehicleWithDeal = await prisma.vehicle.findFirst({
    where: { id: vehicle.id },
    include: {
      deal: { include: { customer: true, salesRep: true } },
      dealJackets: { where: { deletedAt: null }, take: 1 },
    },
  });

  return {
    deal: serializeRecord(deal),
    dealJacket: serializeDealJacket(jacket),
    hasDealJacket: true,
    vehicle: serializeVehicle(vehicleWithDeal),
  };
}

export async function markLoss(vehicleId, payload, ctx) {
  const { dealershipId, userId, role } = ctx;
  if (!["owner", "manager", "platform_owner"].includes(role)) {
    throw forbidden("Only managers can mark vehicles as a loss.");
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, dealershipId, deletedAt: null },
  });
  if (!vehicle) throw notFound("Vehicle not found.");
  if (vehicle.status === "sold") {
    throw conflict("Cannot mark a sold vehicle as a loss.");
  }
  if (vehicle.status === "loss") {
    throw conflict("Vehicle is already marked as a loss.");
  }

  const [updated] = await prisma.$transaction([
    prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        status: "loss",
        soldAt: vehicle.soldAt || new Date(),
      },
    }),
    prisma.vehicleStatusHistory.create({
      data: {
        vehicleId,
        dealershipId,
        fromStatus: vehicle.status,
        toStatus: "loss",
        note: payload.note ?? "Marked as loss",
        changedById: userId,
      },
    }),
  ]);

  await writeAuditLog({
    dealershipId,
    changedById: userId,
    entityType: "Vehicle",
    entityId: vehicleId,
    action: "mark_loss",
    newValues: { note: payload.note },
    ipAddress: ctx.ipAddress,
  });

  return serializeVehicle(updated);
}

export async function listSoldVehicles(dealershipId, query) {
  const { page, limit, q, from, to } = query;
  const where = {
    dealershipId,
    deletedAt: null,
    OR: [
      { status: { in: ["sold", "loss", "wholesale", "out_of_state_sale"] } },
      { soldAt: { not: null } },
    ],
  };

  if (from || to) {
    where.soldAt = {};
    if (from) where.soldAt.gte = from;
    if (to) where.soldAt.lte = to;
  }

  if (q) {
    where.OR = [
      { vin: { contains: q, mode: "insensitive" } },
      { stockNumber: { contains: q, mode: "insensitive" } },
      { make: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({
      where,
      include: {
        deal: {
          include: {
            customer: true,
          },
        },
        dealJackets: {
          where: { deletedAt: null },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { soldAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    vehicles: rows.map(serializeVehicle),
    meta: pageMeta(total, page, limit),
  };
}

function serializeRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    customerId: record.customerId,
    saleDate: record.saleDate,
    totalPriceOtd: toNum(record.totalPriceOtd),
    totalCollected: toNum(record.totalCollected),
    salesTaxAmount: toNum(record.salesTaxAmount),
    netProfit: toNum(record.netProfit),
    commissionAmount: toNum(record.commissionAmount),
    createdAt: record.createdAt,
  };
}
