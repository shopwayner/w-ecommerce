export const MERCADO_LIVRE_MARGIN_TAX_RATE = 0.085;

export type MercadoLivreProfitMarginInput = {
  salePrice: number | null;
  productCost: number | null;
  marketplaceFee: number | null;
  freightCost: number | null;
  taxRate?: number;
};

export type MercadoLivreProfitMargin = {
  status: "complete" | "partial";
  salePrice: number | null;
  productCost: number | null;
  marketplaceFee: number | null;
  freightCost: number | null;
  taxRate: number;
  taxAmount: number | null;
  exactProfit: number | null;
  exactPercent: number | null;
  displayedProfit: number | null;
  displayedPercent: number | null;
  profit: number | null;
  percent: number | null;
  missingData: string[];
};

function validMoney(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundToCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateMercadoLivreProfitMargin(input: MercadoLivreProfitMarginInput): MercadoLivreProfitMargin {
  const salePrice = validMoney(input.salePrice);
  const productCost = validMoney(input.productCost);
  const marketplaceFee = validMoney(input.marketplaceFee);
  const freightCost = validMoney(input.freightCost);
  const taxRate = typeof input.taxRate === "number" && Number.isFinite(input.taxRate) ? input.taxRate : MERCADO_LIVRE_MARGIN_TAX_RATE;
  const taxAmount = salePrice === null ? null : salePrice * taxRate;
  const missingData: string[] = [];

  if (salePrice === null) missingData.push("Preco");
  if (productCost === null) missingData.push("Custo local");
  if (marketplaceFee === null) missingData.push("Tarifa ML");
  if (freightCost === null) missingData.push("Frete");
  if (taxAmount === null) missingData.push("Imposto");

  const complete = missingData.length === 0;
  const exactProfit = complete
    ? (salePrice as number) - (productCost as number) - (marketplaceFee as number) - (freightCost as number) - (taxAmount as number)
    : null;
  const exactPercent = exactProfit !== null && (salePrice as number) > 0 ? (exactProfit / (salePrice as number)) * 100 : null;
  const displayedProfit = exactProfit === null ? null : roundToCents(exactProfit);
  // The visual percentage follows the rounded monetary margin to match Mercado Turbo.
  const displayedPercent = displayedProfit !== null && (salePrice as number) > 0 ? (displayedProfit / (salePrice as number)) * 100 : null;

  return {
    status: complete ? "complete" : "partial",
    salePrice,
    productCost,
    marketplaceFee,
    freightCost,
    taxRate,
    taxAmount,
    exactProfit,
    exactPercent,
    displayedProfit,
    displayedPercent,
    profit: displayedProfit,
    percent: displayedPercent,
    missingData
  };
}
