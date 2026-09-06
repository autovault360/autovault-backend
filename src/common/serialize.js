/** Convert Prisma Decimal / numeric strings to JS numbers for API responses. */
export function toNum(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value.toNumber === "function") return value.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value) {
  const n = toNum(value) ?? 0;
  return Math.round(n * 100) / 100;
}

/** Deep-serialize Prisma records: Decimals ? numbers, Dates ? ISO strings. */
export function serializeRecord(record) {
  if (record == null) return record;
  if (Array.isArray(record)) return record.map(serializeRecord);
  if (record instanceof Date) return record.toISOString();
  if (typeof record !== "object") return record;

  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value == null) {
      out[key] = value;
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === "bigint") {
      out[key] = Number(value);
    } else if (
      typeof value === "object" &&
      typeof value.toFixed === "function" &&
      typeof value.toNumber === "function"
    ) {
      out[key] = toNum(value);
    } else if (Array.isArray(value)) {
      out[key] = serializeRecord(value);
    } else if (typeof value === "object") {
      out[key] = serializeRecord(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const serializeDecimal = toNum;
export const serializeDecimals = serializeRecord;
