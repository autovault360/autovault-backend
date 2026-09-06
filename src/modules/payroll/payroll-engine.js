/**
 * Rule-based payroll engine.
 * Paydays reset automatically from each person's payday + frequency —
 * no manual weekly reset, and history can be reconstructed for taxes.
 */

export function parseYmd(str) {
  const [y, m, d] = String(str || "")
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthsInRange(from, to) {
  const a = from instanceof Date ? from : parseYmd(from);
  const b = to instanceof Date ? to : parseYmd(to);
  if (!a || !b) return 1;
  return Math.max(
    1,
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1,
  );
}

export function hourlyWeeklyHours(staff) {
  if (Array.isArray(staff.workDays) && staff.workDays.length) {
    return staff.workDays.length * (Number(staff.hoursPerDay) || 8);
  }
  if (staff.hours != null) return (Number(staff.hours) || 0) * 12 / 52;
  return 5 * (Number(staff.hoursPerDay) || 8);
}

export function hourlyMonthlyPay(staff) {
  return (hourlyWeeklyHours(staff) * (Number(staff.rate) || 0) * 52) / 12;
}

export function paycheckAmount(staff) {
  const weekly = hourlyWeeklyHours(staff) * (Number(staff.rate) || 0);
  return weekly * (staff.payFreq === "biweekly" ? 2 : 1);
}

export function isPayday(payable, dateStr) {
  if (payable == null || payable.payDay == null) return false;
  const d = parseYmd(dateStr);
  if (!d) return false;
  if (d.getDay() !== Number(payable.payDay)) return false;
  if (payable.payFreq !== "biweekly" || !payable.payAnchor) return true;
  const anchor = parseYmd(payable.payAnchor);
  if (!anchor) return true;
  const weeks = Math.round((d - anchor) / (7 * 86400000));
  return weeks % 2 === 0;
}

export function paydaysBetween(payable, startStr, endStr) {
  const out = [];
  if (!payable || payable.payDay == null) return out;
  const d = parseYmd(startStr);
  const end = parseYmd(endStr);
  if (!d || !end) return out;
  while (d <= end) {
    const ds = formatYmd(d);
    if (isPayday(payable, ds)) out.push(ds);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function buildPayables({ staff = [], salesReps = [] } = {}) {
  const out = [];
  staff.forEach((w) => {
    const payType = String(w.payType || "").toLowerCase();
    if (payType !== "hourly") return;
    const payDay = w.payDay != null ? Number(w.payDay) : 5;
    out.push({
      id: w.id,
      name: w.name || w.fullName,
      kind: "staff",
      role: w.role || w.title || "Staff",
      payDay,
      payFreq: w.payFreq || w.payFrequency || "weekly",
      payAnchor: w.payAnchor || null,
      amount: paycheckAmount({
        ...w,
        rate: w.rate != null ? w.rate : w.payRate,
        payFreq: w.payFreq || w.payFrequency || "weekly",
        hoursPerDay: w.hoursPerDay != null ? w.hoursPerDay : 8,
        workDays: Array.isArray(w.workDays) ? w.workDays : [1, 2, 3, 4, 5],
      }),
      staffMemberId: w.id,
    });
  });
  salesReps.forEach((r) => {
    if (r.payDay == null) return;
    out.push({
      id: r.id,
      name: r.name || r.fullName,
      kind: "rep",
      role: "Sales Rep",
      payDay: Number(r.payDay),
      payFreq: r.payFreq || r.payFrequency || "weekly",
      payAnchor: r.payAnchor || null,
      baseMonthly: Number(r.base != null ? r.base : r.baseSalary) || 0,
      salesRepId: r.id,
    });
  });
  return out;
}

export function payrollDueOn(payables, dateStr, amountFor) {
  const due = (payables || []).filter((e) => isPayday(e, dateStr));
  const total = due.reduce(
    (s, e) => s + (typeof amountFor === "function" ? amountFor(e, dateStr) : Number(e.amount) || 0),
    0,
  );
  return { count: due.length, total, people: due };
}

/**
 * Period labor that belongs on the P&L "Sales Commissions & Payroll" line.
 * Month view = 1 month of wages; year view = 12. Matches the Payroll page.
 */
export function periodLaborCost({
  staff = [],
  salesReps = [],
  commissionsByRep = {},
  monthCount = 1,
} = {}) {
  const mult = Math.max(1, Number(monthCount) || 1);
  const staffPayRows = [];
  for (const w of staff) {
    const payType = String(w.payType || "").toLowerCase();
    const name = w.name || w.fullName;
    const role = w.role || w.title || "Staff";
    let amount = 0;
    if (payType === "salary") {
      amount = (Number(w.monthly != null ? w.monthly : w.payRate) || 0) * mult;
    } else if (payType === "hourly") {
      amount =
        hourlyMonthlyPay({
          ...w,
          rate: w.rate != null ? w.rate : w.payRate,
          hoursPerDay: w.hoursPerDay != null ? w.hoursPerDay : 8,
          workDays: Array.isArray(w.workDays) ? w.workDays : [1, 2, 3, 4, 5],
        }) * mult;
    }
    if (amount > 0.005) {
      staffPayRows.push({
        name,
        role,
        amount,
        badge: payType === "hourly" ? "Hourly" : "Salary",
        staffMemberId: w.id,
      });
    }
  }
  const staffWages = staffPayRows.reduce((s, r) => s + r.amount, 0);

  const repTopRows = [];
  for (const r of salesReps) {
    const name = r.name || r.fullName;
    const base = (Number(r.base != null ? r.base : r.baseSalary) || 0) * mult;
    const comm = Number(commissionsByRep[name] || commissionsByRep[r.id] || 0) || 0;
    const topUp = Math.max(0, base - comm);
    if (topUp > 0.005) {
      repTopRows.push({
        name,
        role: "Sales Rep",
        amount: topUp,
        badge: "Base guarantee",
        salesRepId: r.id,
      });
    }
  }
  const repBaseTopUp = repTopRows.reduce((s, r) => s + r.amount, 0);

  return {
    staffPayRows,
    staffWages,
    repTopRows,
    repBaseTopUp,
    laborExCommissions: staffWages + repBaseTopUp,
  };
}

export function reconstructPayrollRunsYtd({
  payables = [],
  year,
  uptoStr,
  amountFor,
} = {}) {
  const end = uptoStr || formatYmd(new Date());
  const y = year || Number(String(end).slice(0, 4));
  const yStart = `${y}-01-01`;
  const runs = [];
  for (const e of payables) {
    for (const ds of paydaysBetween(e, yStart, end)) {
      const amount =
        typeof amountFor === "function" ? amountFor(e, ds) : Number(e.amount) || 0;
      runs.push({
        date: ds,
        name: e.name,
        kind: e.kind,
        role: e.role,
        amount,
        staffMemberId: e.staffMemberId || null,
        salesRepId: e.salesRepId || null,
      });
    }
  }
  runs.sort(
    (a, b) => b.date.localeCompare(a.date) || String(a.name).localeCompare(String(b.name)),
  );
  return runs;
}
