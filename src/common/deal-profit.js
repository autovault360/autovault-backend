import { roundMoney } from "./serialize.js";

function hasNetCheckValue(netCheck) {
  return netCheck !== null && netCheck !== undefined && netCheck !== "";
}

export function addOnRevenueFromFees(fees) {
  const items =
    fees && typeof fees === "object" && Array.isArray(fees.addOnItems)
      ? fees.addOnItems
      : [];
  return roundMoney(items.reduce((s, a) => s + (Number(a.price) || 0), 0));
}

export function addOnCostFromFees(fees) {
  const items =
    fees && typeof fees === "object" && Array.isArray(fees.addOnItems)
      ? fees.addOnItems
      : [];
  return roundMoney(items.reduce((s, a) => s + (Number(a.cost) || 0), 0));
}

export function computeDealNetProfit({
  soldPrice = 0,
  addOnRevenue = 0,
  totalInvested = 0,
  additionalExpenses = 0,
  commissionAmount = 0,
  netCheck = null,
  salesTax = 0,
  licenseFees = 0,
} = {}) {
  const sold = roundMoney(Number(soldPrice) || 0);
  const addOnRev = roundMoney(Number(addOnRevenue) || 0);
  const cogs = roundMoney(
    (Number(totalInvested) || 0) + (Number(additionalExpenses) || 0),
  );
  const commission = roundMoney(Number(commissionAmount) || 0);
  let revenue = 0;
  if (sold > 0) {
    revenue = roundMoney(sold + addOnRev);
  } else if (hasNetCheckValue(netCheck)) {
    revenue = roundMoney(
      Number(netCheck) -
        roundMoney(Number(salesTax) || 0) -
        roundMoney(Number(licenseFees) || 0),
    );
  }
  return roundMoney(revenue - cogs - commission);
}

export function dealerRevenueFromDeal({
  soldPrice = 0,
  addOnRevenue = 0,
  netCheck = null,
  salesTax = 0,
  licenseFees = 0,
} = {}) {
  const sold = roundMoney(Number(soldPrice) || 0);
  if (sold > 0) return roundMoney(sold + roundMoney(Number(addOnRevenue) || 0));
  if (hasNetCheckValue(netCheck)) {
    return roundMoney(
      Number(netCheck) -
        roundMoney(Number(salesTax) || 0) -
        roundMoney(Number(licenseFees) || 0),
    );
  }
  return 0;
}
