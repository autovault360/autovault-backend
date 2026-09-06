import { prisma } from "../lib/prisma.js";
import { toNum, roundMoney } from "./serialize.js";

/**
 * Resolve a sales rep's default commission settings from their profile.
 * - percentage: `rate` is a 0–1 fraction; `amount` is null
 * - flat: `amount` is a dollar figure; `rate` is null
 */
export async function resolveSalesRepCommission(salesRepId) {
  if (!salesRepId) {
    return { type: "percentage", rate: 0, amount: null };
  }
  const profile = await prisma.salesRepProfile.findFirst({
    where: { userId: salesRepId },
  });
  const type = profile?.commissionType === "flat" ? "flat" : "percentage";
  const value = toNum(profile?.commissionRate);
  if (type === "flat") {
    return {
      type: "flat",
      rate: null,
      amount: value != null && value >= 0 ? value : 0,
    };
  }
  return {
    type: "percentage",
    rate: value != null && value >= 0 ? value : 0.1,
    amount: null,
  };
}

/**
 * Compute commission dollars from optional payload overrides + resolved profile.
 * Payload `commissionAmount` always wins when present.
 */
export function computeCommissionAmount(grossProfit, opts = {}) {
  const {
    commissionAmount,
    commissionRate,
    commissionType,
    resolved,
  } = opts;

  if (commissionAmount != null) {
    return roundMoney(commissionAmount);
  }

  const type =
    commissionType ||
    resolved?.type ||
    (commissionRate != null && commissionRate > 1 ? "flat" : "percentage");

  if (type === "flat") {
    const flat =
      resolved?.amount != null
        ? resolved.amount
        : commissionRate != null
          ? commissionRate
          : 0;
    return roundMoney(Math.max(0, flat));
  }

  const rate =
    commissionRate != null
      ? commissionRate
      : resolved?.rate != null
        ? resolved.rate
        : 0.1;
  return roundMoney(Math.max(0, Number(grossProfit) || 0) * rate);
}

/** Snapshot rate stored on deal/ledger rows (null for flat). */
export function snapshotCommissionRate(type, rate, amount) {
  if (type === "flat") return null;
  if (rate != null && rate > 0) return rate;
  return null;
}
