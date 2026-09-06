import { prisma } from "../../lib/prisma.js";
import { toNum, roundMoney } from "../../common/serialize.js";
import { sumExpensesInRange } from "../expenses/recurring-expenses.js";
import { periodLaborCost, monthsInRange } from "../payroll/payroll-engine.js";

function isEnginePayrollExpense(e) {
  const cat = String(e.category || "");
  const name = String(e.name || "");
  if (cat === "Payroll" || cat === "Commissions") return true;
  return /sales\s*team\s*payroll/i.test(name);
}

function defaultDateRange(from, to) {
  const now = new Date();
  const start = from ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ?? now;
  return { from: start, to: end };
}

export async function profitLoss(dealershipId, { from, to } = {}) {
  const range = defaultDateRange(from, to);

  const jackets = await prisma.dealJacket.findMany({
    where: {
      dealershipId,
      deletedAt: null,
      workflowStatus: "approved",
      dateSold: { gte: range.from, lte: range.to },
    },
    select: {
      soldPrice: true,
      totalInvested: true,
      profitGross: true,
      profitNet: true,
      commissionAmount: true,
      dateSold: true,
    },
  });

  const revenue = roundMoney(
    jackets.reduce((sum, j) => sum + (toNum(j.soldPrice) ?? 0), 0),
  );
  const cogs = roundMoney(
    jackets.reduce((sum, j) => sum + (toNum(j.totalInvested) ?? 0), 0),
  );
  const gross = roundMoney(revenue - cogs);

  // Multi-month / yearly ranges: only charge recurring costs in months that
  // actually have sales. Single-month ranges always count (explicit pick).
  const isMultiMonth =
    range.from.getFullYear() !== range.to.getFullYear() ||
    range.from.getMonth() !== range.to.getMonth();
  let activeMonths = null;
  if (isMultiMonth) {
    activeMonths = new Set();
    for (const j of jackets) {
      if (!j.dateSold) continue;
      const d = j.dateSold instanceof Date ? j.dateSold : new Date(j.dateSold);
      if (!Number.isNaN(d.getTime())) activeMonths.add(d.getMonth());
    }
  }

  // Include one-time expenses in-range plus recurring templates that
  // carry forward into months covered by the period.
  const expenseRows = await prisma.dealershipExpense.findMany({
    where: {
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
    },
    select: {
      amount: true,
      expenseDate: true,
      isRecurring: true,
      recurringFrequency: true,
      vehicleVin: true,
      notes: true,
      category: true,
      name: true,
    },
  });

  // Parse optional [recur-end:YYYY-MM] stop marker from notes until a
  // dedicated recurringEndDate column exists.
  const expensesWithEnd = expenseRows
    .filter((e) => !isEnginePayrollExpense(e))
    .map((e) => {
      const m = String(e.notes || "").match(/\[recur-end:(\d{4}-\d{2})(?:-\d{2})?\]/);
      return m ? { ...e, recurringEndDate: `${m[1]}-28` } : e;
    });

  const operatingExpenses = sumExpensesInRange(expensesWithEnd, range.from, range.to, {
    excludeVehicleVin: true,
    activeMonths,
  });

  const commissionsPaid = await prisma.salesRepCommission.aggregate({
    where: {
      dealershipId,
      deletedAt: null,
      status: "paid",
      paidAt: { gte: range.from, lte: range.to },
    },
    _sum: { commissionAmount: true },
  });
  const commissionsTotal = roundMoney(
    toNum(commissionsPaid._sum.commissionAmount) ?? 0,
  );

  const [staffRows, repRows] = await Promise.all([
    prisma.staffMember.findMany({
      where: { dealershipId, deletedAt: null, isActive: true },
    }),
    prisma.user.findMany({
      where: {
        dealershipId,
        role: "sales_rep",
        deletedAt: null,
        isActive: true,
      },
      include: { salesRepProfile: true },
    }),
  ]);

  const commissionsByRep = {};
  const paidCommissionRows = await prisma.salesRepCommission.findMany({
    where: {
      dealershipId,
      deletedAt: null,
      status: "paid",
      paidAt: { gte: range.from, lte: range.to },
    },
    select: {
      commissionAmount: true,
      salesRepId: true,
      salesRep: { select: { id: true, fullName: true } },
    },
  });
  for (const c of paidCommissionRows) {
    const amt = toNum(c.commissionAmount) || 0;
    const name = c.salesRep?.fullName;
    const id = c.salesRepId || c.salesRep?.id;
    if (name) commissionsByRep[name] = (commissionsByRep[name] || 0) + amt;
    if (id) commissionsByRep[id] = (commissionsByRep[id] || 0) + amt;
  }

  const labor = periodLaborCost({
    staff: staffRows.map((s) => ({
      id: s.id,
      name: s.fullName,
      fullName: s.fullName,
      role: s.title,
      title: s.title,
      payType: s.payType,
      rate: toNum(s.payRate) || 0,
      payRate: toNum(s.payRate) || 0,
      monthly: String(s.payType || "").toLowerCase() === "salary" ? toNum(s.payRate) || 0 : 0,
      hoursPerDay: s.hoursPerDay != null ? toNum(s.hoursPerDay) : 8,
      workDays: Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5],
    })),
    salesReps: repRows.map((u) => ({
      id: u.id,
      name: u.fullName,
      fullName: u.fullName,
      base: toNum(u.salesRepProfile?.baseSalary) || 0,
      baseSalary: toNum(u.salesRepProfile?.baseSalary) || 0,
    })),
    commissionsByRep,
    monthCount: monthsInRange(range.from, range.to),
  });

  const payrollTotal = roundMoney(
    commissionsTotal + labor.staffWages + labor.repBaseTopUp,
  );
  const net = roundMoney(gross - operatingExpenses - payrollTotal);

  return {
    period: {
      from: range.from,
      to: range.to,
    },
    revenue,
    cogs,
    gross,
    operatingExpenses,
    commissionsPaid: commissionsTotal,
    staffWages: roundMoney(labor.staffWages),
    repBaseTopUp: roundMoney(labor.repBaseTopUp),
    payrollTotal,
    net,
    soldVehicleCount: jackets.length,
  };
}
