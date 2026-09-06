/** Shallow-copy a JSON fees object. Arrays are treated as empty. */
export function jsonFees(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

/**
 * Merge incoming fees into stored fees so a partial PATCH cannot wipe
 * netCheck / statusInfo / flooring keys the client omitted.
 */
export function mergeJsonFees(existing, incoming) {
  const prev = jsonFees(existing);
  const next = jsonFees(incoming);
  const merged = { ...prev, ...next };
  if (Object.prototype.hasOwnProperty.call(next, "netCheck") && next.netCheck == null) {
    delete merged.netCheck;
  }
  if (
    next.statusInfo &&
    typeof next.statusInfo === "object" &&
    !Array.isArray(next.statusInfo)
  ) {
    merged.statusInfo = {
      ...jsonFees(prev.statusInfo),
      ...next.statusInfo,
    };
  }
  return merged;
}
