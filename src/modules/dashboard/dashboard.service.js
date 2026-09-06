import { prisma } from "../../lib/prisma.js";
import { toNum, roundMoney, serializeRecord } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";
import { profitLoss } from "../reports/reports.service.js";
import { currentInventoryWhere } from "../vehicles/vehicle-status.js";

const PENDING_JACKET_STATUSES = [
  "pending_review",
  "changes_requested",
  "resubmitted",
];

function monthRange() {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  };
}

function jacketScope(dealershipId, role, userId) {
  const base = { dealershipId, deletedAt: null };
  if (role === "sales_rep") {
    base.salesRepId = userId;
  }
  return base;
}

function customerScope(dealershipId, role, userId) {
  const base = { dealershipId, deletedAt: null };
  if (role === "sales_rep") {
    base.salesRepId = userId;
  }
  return base;
}

export async function summary(dealershipId, role, userId) {
  const { from: monthStart, to: monthEnd } = monthRange();
  const jacketWhere = jacketScope(dealershipId, role, userId);
  const customerWhere = customerScope(dealershipId, role, userId);

  const [
    inventoryCount,
    soldThisMonth,
    soldAllTime,
    pendingJackets,
    leadsCount,
    openTaxPeriods,
    approvedJacketsThisMonth,
    expenseAgg,
    profitReport,
  ] = await Promise.all([
    prisma.vehicle.count({
      where: currentInventoryWhere(dealershipId),
    }),
    role === "sales_rep"
      ? prisma.dealJacket.count({
          where: {
            ...jacketWhere,
            workflowStatus: "approved",
            dateSold: { gte: monthStart, lte: monthEnd },
          },
        })
      : prisma.vehicle.count({
          where: {
            dealershipId,
            deletedAt: null,
            status: "sold",
            soldAt: { gte: monthStart, lte: monthEnd },
          },
        }),
    role === "sales_rep"
      ? prisma.dealJacket.count({
          where: { ...jacketWhere, workflowStatus: "approved" },
        })
      : prisma.vehicle.count({
          where: { dealershipId, deletedAt: null, status: "sold" },
        }),
    prisma.dealJacket.count({
      where: {
        ...jacketWhere,
        workflowStatus: { in: PENDING_JACKET_STATUSES },
      },
    }),
    prisma.customer.count({
      where: { ...customerWhere, status: "lead" },
    }),
    role === "sales_rep"
      ? Promise.resolve(0)
      : prisma.taxFilingPeriod.count({
          where: {
            dealershipId,
            status: { in: ["open", "due"] },
          },
        }),
    prisma.dealJacket.findMany({
      where: {
        ...jacketWhere,
        workflowStatus: "approved",
        dateSold: { gte: monthStart, lte: monthEnd },
      },
      select: { profitGross: true, profitNet: true },
    }),
    role === "sales_rep"
      ? Promise.resolve({ _sum: { amount: null } })
      : prisma.dealershipExpense.aggregate({
          where: {
            dealershipId,
            deletedAt: null,
            expenseDate: { gte: monthStart, lte: monthEnd },
          },
          _sum: { amount: true },
        }),
    role === "sales_rep"
      ? Promise.resolve(null)
      : profitLoss(dealershipId, { from: monthStart, to: monthEnd }),
  ]);

  const grossProfit = roundMoney(
    approvedJacketsThisMonth.reduce(
      (sum, j) => sum + (toNum(j.profitGross) ?? 0),
      0,
    ),
  );
  const netProfit = roundMoney(
    approvedJacketsThisMonth.reduce(
      (sum, j) => sum + (toNum(j.profitNet) ?? 0),
      0,
    ),
  );
  const expenseTotal = roundMoney(toNum(expenseAgg._sum.amount) ?? 0);

  return {
    inventoryCount,
    soldCount: {
      thisMonth: soldThisMonth,
      allTime: soldAllTime,
    },
    grossProfit,
    netProfit,
    expenseTotal,
    profitSummary: profitReport
      ? {
          revenue: profitReport.revenue,
          gross: profitReport.gross,
          net: profitReport.net,
        }
      : null,
    pendingJackets,
    leadsCount,
    openTaxPeriods,
    period: { from: monthStart, to: monthEnd },
  };
}

export async function listAuditLogs(dealershipId, { page = 1, limit = 25 }) {
  const where = { dealershipId };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        changedBy: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
    }),
  ]);

  return {
    auditLogs: rows.map(serializeRecord),
    meta: pageMeta(total, page, limit),
  };
}
