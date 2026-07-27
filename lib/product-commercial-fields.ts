export const PRODUCT_FORMAT_VALUES = ["SIMPLE", "VARIATION", "COMPOSITION"] as const;
export const PRODUCT_TYPE_VALUES = ["PRODUCT", "SERVICE", "SERVICE_06_21_22"] as const;
export const PRODUCT_COMMERCIAL_STATUS_VALUES = ["ACTIVE", "INACTIVE"] as const;
export const PRODUCT_PRODUCTION_TYPE_VALUES = ["OWN", "THIRD_PARTY"] as const;
export const PRODUCT_DIMENSION_UNIT_VALUES = ["METER", "CENTIMETER", "MILLIMETER"] as const;

export type ProductFormatValue = (typeof PRODUCT_FORMAT_VALUES)[number];
export type ProductTypeValue = (typeof PRODUCT_TYPE_VALUES)[number];
export type ProductCommercialStatusValue = (typeof PRODUCT_COMMERCIAL_STATUS_VALUES)[number];
export type ProductProductionTypeValue = (typeof PRODUCT_PRODUCTION_TYPE_VALUES)[number];
export type ProductDimensionUnitValue = (typeof PRODUCT_DIMENSION_UNIT_VALUES)[number];

export function isValidDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidPackagingGtin(value: string) {
  if (![8, 12, 13].includes(value.length) || !/^\d+$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const checkDigit = digits.at(-1);
  const sum = digits
    .slice(0, -1)
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return checkDigit === (10 - (sum % 10)) % 10;
}
