import { prisma } from "../lib/prisma.js";

export const REAL_VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
export const PLACEHOLDER_VIN_RE = /^NO-VIN-\d+$/i;

export function normalizeVin(raw) {
  return String(raw || "").toUpperCase().trim();
}

export function isPlaceholderVin(raw) {
  return PLACEHOLDER_VIN_RE.test(normalizeVin(raw));
}

export function isAcceptedVin(raw) {
  const vin = normalizeVin(raw);
  return REAL_VIN_RE.test(vin) || PLACEHOLDER_VIN_RE.test(vin);
}

export const VIN_FORMAT_MESSAGE =
  "VIN must be exactly 17 characters, or a NO-VIN stock tag.";

/** Next unused `NO-VIN-N` tag for this dealership (active vehicles only). */
export async function nextPlaceholderVin(dealershipId) {
  const rows = await prisma.vehicle.findMany({
    where: {
      dealershipId,
      deletedAt: null,
      vin: { startsWith: "NO-VIN-" },
    },
    select: { vin: true },
  });
  let n = 0;
  for (const row of rows) {
    const m = /^NO-VIN-(\d+)$/i.exec(String(row.vin || ""));
    if (m) n = Math.max(n, parseInt(m[1], 10) || 0);
  }
  return `NO-VIN-${n + 1}`;
}
