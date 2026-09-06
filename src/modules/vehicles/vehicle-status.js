/** Inventory statuses — vehicles still on the lot / not exited. */
export const ACTIVE_INVENTORY_STATUSES = [
  "in_stock",
  "needs_attention",
  "pending_deal",
  "arbitration",
];

/** Exit statuses — vehicle has left active inventory. */
export const EXIT_INVENTORY_STATUSES = [
  "sold",
  "loss",
  "wholesale",
  "out_of_state_sale",
];

/** Prisma where-clause for current (unsold) inventory. */
export function currentInventoryWhere(dealershipId) {
  return {
    dealershipId,
    deletedAt: null,
    status: { in: ACTIVE_INVENTORY_STATUSES },
    soldAt: null,
  };
}

/** Prisma where-clause for all non-deleted vehicles in the system. */
export function allVehiclesWhere(dealershipId) {
  return {
    dealershipId,
    deletedAt: null,
  };
}
