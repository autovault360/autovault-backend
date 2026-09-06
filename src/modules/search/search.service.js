import { prisma } from "../../lib/prisma.js";
import { toNum } from "../../common/serialize.js";

const STATUS_LABEL = {
  in_stock: "In Stock",
  needs_attention: "Needs Attention",
  pending_deal: "Pending Deal",
  sold: "Sold",
  loss: "Sold Loss",
  wholesale: "Wholesale",
  out_of_state_sale: "Out of State",
  arbitration: "Arbitration",
};

function vehicleTitle(v) {
  return [v.year, v.make, v.model].filter(Boolean).join(" ").trim() || "Vehicle";
}

function money(n) {
  const v = toNum(n);
  if (v == null || Number.isNaN(v)) return null;
  return v;
}

function mapVehicle(v) {
  const title = vehicleTitle(v);
  const bits = [];
  if (v.vin) bits.push(`VIN ${v.vin}`);
  if (v.stockNumber) bits.push(`Stock ${v.stockNumber}`);
  return {
    id: v.id,
    type: "vehicle",
    title,
    subtitle: bits.join(" · "),
    meta: STATUS_LABEL[v.status] || v.status || "",
    status: v.status,
    vin: v.vin,
    stockNumber: v.stockNumber || null,
    year: v.year,
    make: v.make,
    model: v.model,
    askingPrice: money(v.askingPrice),
    soldPrice: money(v.soldPrice),
    customerName: v.customerName || null,
    hasDealJacket: Array.isArray(v.dealJackets)
      ? v.dealJackets.length > 0
      : false,
  };
}

function mapCustomer(c) {
  const contact = [c.phone, c.email].filter(Boolean).join(" · ");
  const isLead = c.status === "lead";
  return {
    id: c.id,
    type: "customer",
    title: c.name || "Customer",
    subtitle: contact || (isLead ? "Lead" : "Customer"),
    meta: isLead ? "Lead" : "Customer",
    status: c.status,
    phone: c.phone || null,
    email: c.email || null,
    vin: null,
  };
}

function mapJacket(j) {
  const v = j.vehicle || {};
  const c = j.customer || {};
  const title = j.jacketNumber || "Deal Jacket";
  const car = vehicleTitle(v);
  const bits = [];
  if (car) bits.push(car);
  if (c.name) bits.push(c.name);
  if (j.rosNumber) bits.push(`ROS ${j.rosNumber}`);
  return {
    id: j.id,
    type: "jacket",
    title,
    subtitle: bits.join(" · "),
    meta: j.workflowStatus || "",
    status: j.workflowStatus,
    vin: v.vin || null,
    vehicleId: j.vehicleId,
    customerId: j.customerId,
    customerName: c.name || null,
    rosNumber: j.rosNumber || null,
    jacketNumber: j.jacketNumber || null,
  };
}

function mapExpense(e) {
  const bits = [];
  if (e.vendor) bits.push(e.vendor);
  if (e.vehicleVin) bits.push(`VIN ${e.vehicleVin}`);
  const amt = money(e.amount);
  return {
    id: e.id,
    type: "expense",
    title: e.name || e.description || "Expense",
    subtitle: bits.join(" · ") || e.category || "",
    meta: amt != null ? `$${amt.toLocaleString()}` : e.status || "",
    status: e.status,
    vin: e.vehicleVin || null,
    amount: amt,
  };
}

/**
 * Parallel tenant-scoped search across vehicles, customers, deal jackets, expenses.
 */
export async function globalSearch(dealershipId, query, auth = {}) {
  const raw = String(query.q || "").trim();
  const limit = query.limit || 8;

  if (raw.length < 2) {
    return {
      query: raw,
      results: { vehicles: [], customers: [], jackets: [], expenses: [] },
      counts: { vehicles: 0, customers: 0, jackets: 0, expenses: 0 },
      total: 0,
    };
  }

  const q = raw;
  const yearNum = /^\d{4}$/.test(q) ? Number(q) : null;

  const vehicleOr = [
    { vin: { contains: q, mode: "insensitive" } },
    { make: { contains: q, mode: "insensitive" } },
    { model: { contains: q, mode: "insensitive" } },
    { trim: { contains: q, mode: "insensitive" } },
    { stockNumber: { contains: q, mode: "insensitive" } },
    { licensePlate: { contains: q, mode: "insensitive" } },
    { customerName: { contains: q, mode: "insensitive" } },
    { customerPhone: { contains: q, mode: "insensitive" } },
    { customerEmail: { contains: q, mode: "insensitive" } },
    { notes: { contains: q, mode: "insensitive" } },
  ];
  if (yearNum) vehicleOr.push({ year: yearNum });

  const jacketWhere = {
    dealershipId,
    deletedAt: null,
    OR: [
      { jacketNumber: { contains: q, mode: "insensitive" } },
      { rosNumber: { contains: q, mode: "insensitive" } },
      { lender: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { vehicle: { vin: { contains: q, mode: "insensitive" } } },
      { vehicle: { stockNumber: { contains: q, mode: "insensitive" } } },
      { vehicle: { make: { contains: q, mode: "insensitive" } } },
      { vehicle: { model: { contains: q, mode: "insensitive" } } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { phone: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
    ],
  };
  if (auth.role === "sales_rep") {
    jacketWhere.salesRepId = auth.userId;
  }

  const [vehicles, customers, jackets, expenses] = await Promise.all([
    prisma.vehicle.findMany({
      where: { dealershipId, deletedAt: null, OR: vehicleOr },
      select: {
        id: true,
        vin: true,
        stockNumber: true,
        year: true,
        make: true,
        model: true,
        status: true,
        askingPrice: true,
        soldPrice: true,
        customerName: true,
        dealJackets: {
          where: { deletedAt: null },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.customer.findMany({
      where: {
        dealershipId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { address: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
          { driversLicenseNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.dealJacket.findMany({
      where: jacketWhere,
      select: {
        id: true,
        vehicleId: true,
        customerId: true,
        jacketNumber: true,
        rosNumber: true,
        workflowStatus: true,
        vehicle: {
          select: { vin: true, year: true, make: true, model: true },
        },
        customer: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.dealershipExpense.findMany({
      where: {
        dealershipId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { vendor: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { referenceNumber: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
          { vehicleVin: { contains: q, mode: "insensitive" } },
          { subcategory: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        vendor: true,
        description: true,
        category: true,
        amount: true,
        status: true,
        vehicleVin: true,
      },
      orderBy: { expenseDate: "desc" },
      take: limit,
    }),
  ]);

  const mappedVehicles = vehicles.map(mapVehicle);
  const mappedCustomers = customers.map(mapCustomer);
  const mappedJackets = jackets.map(mapJacket);
  const mappedExpenses = expenses.map(mapExpense);

  return {
    query: raw,
    results: {
      vehicles: mappedVehicles,
      customers: mappedCustomers,
      jackets: mappedJackets,
      expenses: mappedExpenses,
    },
    counts: {
      vehicles: mappedVehicles.length,
      customers: mappedCustomers.length,
      jackets: mappedJackets.length,
      expenses: mappedExpenses.length,
    },
    total:
      mappedVehicles.length +
      mappedCustomers.length +
      mappedJackets.length +
      mappedExpenses.length,
  };
}
