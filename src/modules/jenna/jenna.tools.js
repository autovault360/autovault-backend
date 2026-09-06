import { prisma } from "../../lib/prisma.js";
import { toNum, roundMoney } from "../../common/serialize.js";

function monthRange() {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  };
}

function money(n) {
  return roundMoney(toNum(n));
}

function vehicleAllIn(v) {
  return money(
    toNum(v.acquisitionCost) +
      toNum(v.reconditioningCost) +
      toNum(v.auctionFees) +
      toNum(v.flooringFees) +
      toNum(v.registrationFees) +
      toNum(v.additionalExpenses),
  );
}

function vehicleLine(v) {
  const allIn = vehicleAllIn(v);
  const sold = v.status === "sold" || v.status === "loss";
  const profit = sold ? money(toNum(v.soldPrice) - allIn) : null;
  return [
    `${v.year} ${v.make} ${v.model}`,
    `VIN ${v.vin}`,
    `status ${v.status}`,
    `paid $${money(v.acquisitionCost)}`,
    `all-in $${allIn}`,
    sold && v.soldPrice != null ? `sold $${money(v.soldPrice)}` : null,
    profit != null ? `net $${profit}` : null,
    v.notes ? `notes: ${String(v.notes).slice(0, 80)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

/** Compact live snapshot for the LLM (SQL-backed, no embeddings). */
export async function buildDealershipSnapshot(dealershipId) {
  const { from: monthStart } = monthRange();
  const activeStatuses = ["in_stock", "needs_attention", "pending_deal"];

  const [
    dealership,
    activeVehicles,
    soldMonth,
    unpaidExpenses,
    monthExpenseAgg,
    commissionsOwed,
    leadCount,
    dashboardNotes,
    calendarNotes,
  ] = await Promise.all([
    prisma.dealership.findFirst({
      where: { id: dealershipId, deletedAt: null },
      select: { name: true, plan: true, city: true, state: true },
    }),
    prisma.vehicle.findMany({
      where: {
        dealershipId,
        deletedAt: null,
        status: { in: activeStatuses },
      },
      select: {
        vin: true,
        year: true,
        make: true,
        model: true,
        status: true,
        acquisitionCost: true,
        reconditioningCost: true,
        auctionFees: true,
        flooringFees: true,
        registrationFees: true,
        additionalExpenses: true,
        soldPrice: true,
        notes: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.vehicle.findMany({
      where: {
        dealershipId,
        deletedAt: null,
        status: "sold",
        soldAt: { gte: monthStart },
      },
      select: {
        vin: true,
        year: true,
        make: true,
        model: true,
        acquisitionCost: true,
        reconditioningCost: true,
        auctionFees: true,
        flooringFees: true,
        registrationFees: true,
        additionalExpenses: true,
        soldPrice: true,
      },
      take: 30,
    }),
    prisma.dealershipExpense.findMany({
      where: {
        dealershipId,
        deletedAt: null,
        status: { in: ["unpaid", "partial"] },
      },
      select: {
        name: true,
        category: true,
        amount: true,
        expenseDate: true,
        vehicleVin: true,
      },
      orderBy: { expenseDate: "asc" },
      take: 25,
    }),
    prisma.dealershipExpense.aggregate({
      where: {
        dealershipId,
        deletedAt: null,
        expenseDate: { gte: monthStart },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.salesRepCommission.findMany({
      where: {
        dealershipId,
        deletedAt: null,
        status: { in: ["pending_review", "approved"] },
        paidAt: null,
      },
      select: {
        commissionAmount: true,
        status: true,
        salesRep: { select: { fullName: true } },
      },
      take: 40,
    }),
    prisma.customer.count({
      where: { dealershipId, deletedAt: null, status: "lead" },
    }),
    prisma.dashboardNote.findMany({
      where: { dealershipId },
      select: { text: true, updatedAt: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      take: 10,
    }),
    prisma.calendarDayNote.findMany({
      where: {
        dealershipId,
        noteDate: { gte: monthStart },
      },
      select: { noteDate: true, body: true, updatedAt: true },
      orderBy: { noteDate: "desc" },
      take: 12,
    }),
  ]);

  const activeAllIn = activeVehicles.reduce((s, v) => s + vehicleAllIn(v), 0);
  const soldNet = soldMonth.reduce((s, v) => {
    return s + money(toNum(v.soldPrice) - vehicleAllIn(v));
  }, 0);
  const unpaidTot = unpaidExpenses.reduce((s, e) => s + money(e.amount), 0);
  const commissionOwed = commissionsOwed.reduce(
    (s, c) => s + money(c.commissionAmount),
    0,
  );

  const byRep = {};
  for (const c of commissionsOwed) {
    const name = c.salesRep?.fullName || "Unknown";
    byRep[name] = money((byRep[name] || 0) + money(c.commissionAmount));
  }

  return {
    asOf: new Date().toISOString(),
    dealership: dealership
      ? {
          name: dealership.name,
          plan: dealership.plan,
          location: [dealership.city, dealership.state].filter(Boolean).join(", "),
        }
      : null,
    inventory: {
      activeCount: activeVehicles.length,
      allInCost: money(activeAllIn),
      vehicles: activeVehicles.slice(0, 25).map(vehicleLine),
    },
    soldThisMonth: {
      units: soldMonth.length,
      netProfit: money(soldNet),
    },
    expenses: {
      monthTotal: money(monthExpenseAgg._sum.amount),
      monthCount: monthExpenseAgg._count || 0,
      unpaidTotal: money(unpaidTot),
      unpaid: unpaidExpenses.slice(0, 15).map(
        (e) =>
          `${e.name} | ${e.category} | $${money(e.amount)} | ${e.expenseDate?.toISOString?.()?.slice(0, 10) || ""} | vin:${e.vehicleVin || "none"}`,
      ),
    },
    commissions: {
      owedTotal: money(commissionOwed),
      byRep,
    },
    leads: leadCount,
    notes: {
      dashboard: dashboardNotes
        .map((n) =>
          String(n.text || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200),
        )
        .filter(Boolean),
      calendar: calendarNotes
        .map((n) => {
          const day = n.noteDate?.toISOString?.()?.slice(0, 10) || "";
          const body = String(n.body || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160);
          return body ? `${day}: ${body}` : null;
        })
        .filter(Boolean),
    },
  };
}

export async function findVehicles(dealershipId, query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);

  const or = [
    { vin: { contains: q, mode: "insensitive" } },
    { make: { contains: q, mode: "insensitive" } },
    { model: { contains: q, mode: "insensitive" } },
    { stockNumber: { contains: q, mode: "insensitive" } },
  ];

  for (const t of tokens) {
    or.push({ make: { contains: t, mode: "insensitive" } });
    or.push({ model: { contains: t, mode: "insensitive" } });
  }

  const yearMatch = q.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  const rows = await prisma.vehicle.findMany({
    where: {
      dealershipId,
      deletedAt: null,
      AND: [
        { OR: or },
        ...(year ? [{ year }] : []),
      ],
    },
    select: {
      vin: true,
      year: true,
      make: true,
      model: true,
      status: true,
      acquisitionCost: true,
      reconditioningCost: true,
      auctionFees: true,
      flooringFees: true,
      registrationFees: true,
      additionalExpenses: true,
      soldPrice: true,
      notes: true,
    },
    take: 8,
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((v) => ({
    line: vehicleLine(v),
    vin: v.vin,
    status: v.status,
    allIn: vehicleAllIn(v),
    soldPrice: v.soldPrice != null ? money(v.soldPrice) : null,
  }));
}

export function snapshotToPromptText(snapshot) {
  if (!snapshot) return "No CRM snapshot available.";
  const d = snapshot.dealership;
  const lines = [
    `As of ${snapshot.asOf}`,
    d
      ? `Dealership: ${d.name} (${d.plan || "plan n/a"}${d.location ? ", " + d.location : ""})`
      : "Dealership: unknown",
    `INVENTORY: ${snapshot.inventory.activeCount} active, all-in $${snapshot.inventory.allInCost}`,
    snapshot.inventory.vehicles.length
      ? `Vehicles:\n${snapshot.inventory.vehicles.join("\n")}`
      : "Vehicles: none",
    `SOLD THIS MONTH: ${snapshot.soldThisMonth.units} units, net $${snapshot.soldThisMonth.netProfit}`,
    `EXPENSES: month $${snapshot.expenses.monthTotal} (${snapshot.expenses.monthCount}); unpaid $${snapshot.expenses.unpaidTotal}`,
    snapshot.expenses.unpaid.length
      ? `Unpaid:\n${snapshot.expenses.unpaid.join("\n")}`
      : "Unpaid: none",
    `COMMISSIONS OWED: $${snapshot.commissions.owedTotal}`,
    Object.keys(snapshot.commissions.byRep || {}).length
      ? `By rep: ${Object.entries(snapshot.commissions.byRep)
          .map(([n, a]) => `${n}=$${a}`)
          .join("; ")}`
      : "By rep: none",
    `LEADS: ${snapshot.leads}`,
    snapshot.notes?.dashboard?.length
      ? `DASHBOARD NOTES:\n${snapshot.notes.dashboard
          .map((t, i) => `${i + 1}. ${t}`)
          .join("\n")}`
      : "DASHBOARD NOTES: none",
    snapshot.notes?.calendar?.length
      ? `CALENDAR DAY NOTES (this month):\n${snapshot.notes.calendar.join("\n")}`
      : "CALENDAR DAY NOTES: none",
  ];
  return lines.join("\n");
}
