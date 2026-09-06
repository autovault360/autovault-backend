import { prisma } from "../../lib/prisma.js";
import { toNum, roundMoney } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";

export async function getMetrics() {
  const baseWhere = { deletedAt: null };

  const [totalDealerships, activeDealerships, mrrAgg, stateGroups] =
    await Promise.all([
      prisma.dealership.count({ where: baseWhere }),
      prisma.dealership.count({
        where: { ...baseWhere, status: "active" },
      }),
      prisma.dealership.aggregate({
        where: { ...baseWhere, status: "active" },
        _sum: { monthlyFee: true },
      }),
      prisma.dealership.groupBy({
        by: ["state"],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

  const byState = stateGroups
    .map((row) => ({
      state: row.state || "unknown",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDealerships,
    activeDealerships,
    mrr: roundMoney(toNum(mrrAgg._sum.monthlyFee) ?? 0),
    byState,
  };
}

export async function listDealerships({ page = 1, limit = 25, q, status, state } = {}) {
  const where = { deletedAt: null };
  if (status) where.status = status;
  if (state) where.state = state.toUpperCase();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.dealership.count({ where }),
    prisma.dealership.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        plan: true,
        city: true,
        state: true,
        monthlyFee: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    dealerships: rows.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      plan: d.plan,
      city: d.city,
      state: d.state,
      monthlyFee: toNum(d.monthlyFee),
      createdAt: d.createdAt,
    })),
    meta: pageMeta(total, page, limit),
  };
}
