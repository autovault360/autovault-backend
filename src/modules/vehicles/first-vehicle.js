import { prisma } from "../../lib/prisma.js";

/** True when the dealership has no vehicles yet (used for GA4 trial_activated). */
export async function isFirstVehicleForDealership(dealershipId) {
  const existing = await prisma.vehicle.count({
    where: { dealershipId, deletedAt: null },
  });
  return existing === 0;
}
