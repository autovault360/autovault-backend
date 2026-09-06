import { toNum, roundMoney } from "../../common/serialize.js";

/**
 * Expand dealership expenses into amounts that belong in a date range.
 * Recurring templates carry forward from their expenseDate until deleted,
 * switched off recurring, or past recurringEndDate (Weekly/Monthly every
 * month; Quarterly every 3 months from start; Annual on anniversary month).
 *
 * When `activeMonths` is provided (Set/array of 0–11 month indexes that have
 * sales activity), yearly-style ranges only count recurring costs in those
 * months — empty months are excluded to avoid fake losses.
 */
export function expenseAmountInRange(expense, from, to, { activeMonths = null } = {}) {
  const amount = toNum(expense.amount) ?? 0;
  if (!amount) return 0;

  const start = toDateOnly(expense.expenseDate);
  if (!start) return 0;

  const rangeStart = toDateOnly(from);
  const rangeEnd = toDateOnly(to);
  if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) return 0;

  const isRecurring =
    !!expense.isRecurring &&
    expense.recurringFrequency &&
    expense.recurringFrequency !== "One-Time";

  if (!isRecurring) {
    return start >= rangeStart && start <= rangeEnd ? amount : 0;
  }

  const end = toDateOnly(expense.recurringEndDate || expense.endDate);
  const activeSet = toActiveMonthSet(activeMonths);

  const freq = expense.recurringFrequency;
  let total = 0;
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);

  while (cursor <= endMonth) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    if (!activeSet || activeSet.has(m)) {
      if (recurringOccursInMonth(start, freq, y, m, end)) {
        total += occurrenceAmount(amount, freq);
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return total;
}

export function sumExpensesInRange(
  expenses,
  from,
  to,
  { excludeVehicleVin = false, activeMonths = null } = {},
) {
  let total = 0;
  for (const e of expenses) {
    if (excludeVehicleVin && e.vehicleVin) continue;
    total += expenseAmountInRange(e, from, to, { activeMonths });
  }
  return roundMoney(total);
}

function toActiveMonthSet(activeMonths) {
  if (activeMonths == null) return null;
  if (activeMonths instanceof Set) return activeMonths.size ? activeMonths : new Set();
  if (Array.isArray(activeMonths)) return new Set(activeMonths);
  return null;
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const s = String(value).slice(0, 10);
  const parts = s.split("-");
  if (parts.length < 2) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = parts.length >= 3 ? Number(parts[2]) : 1;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m, d);
}

function recurringOccursInMonth(start, freq, year, month, end = null) {
  const startIdx = start.getFullYear() * 12 + start.getMonth();
  const targetIdx = year * 12 + month;
  if (targetIdx < startIdx) return false;
  if (end) {
    const endIdx = end.getFullYear() * 12 + end.getMonth();
    if (targetIdx > endIdx) return false;
  }
  switch (freq) {
    case "Weekly":
    case "Monthly":
      return true;
    case "Quarterly":
      return (targetIdx - startIdx) % 3 === 0;
    case "Annual":
      return month === start.getMonth();
    default:
      return false;
  }
}

function occurrenceAmount(amount, freq) {
  if (freq === "Weekly") return amount * 4.333;
  return amount;
}
