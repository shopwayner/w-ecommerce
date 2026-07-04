export function roundDecimalMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseDecimalPrice(value: unknown) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? roundDecimalMoney(value) : null;
  }

  if (typeof value !== "string") return null;

  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return null;

  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? roundDecimalMoney(parsed) : null;
}
