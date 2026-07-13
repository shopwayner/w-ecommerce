import assert from "node:assert/strict";
import test from "node:test";
import { calculateMercadoLivreProfitMargin } from "./mercado-livre-profit-margin";

test("calculates the Premium example without intermediate rounding", () => {
  const margin = calculateMercadoLivreProfitMargin({
    salePrice: 18.98,
    productCost: 7.22,
    marketplaceFee: 3.23,
    freightCost: 5.95
  });

  assert.equal(margin.status, "complete");
  assert.ok(Math.abs((margin.exactProfit ?? 0) - 0.9667) < 1e-10);
  assert.equal(margin.displayedProfit, 0.97);
  assert.equal(margin.profit, 0.97);
  assert.equal(margin.displayedPercent?.toFixed(2), "5.11");
  assert.equal(margin.percent?.toFixed(2), "5.11");
});

test("calculates the Classic example without intermediate rounding", () => {
  const margin = calculateMercadoLivreProfitMargin({
    salePrice: 16.98,
    productCost: 7.22,
    marketplaceFee: 2.04,
    freightCost: 5.95
  });

  assert.equal(margin.status, "complete");
  assert.ok(Math.abs((margin.exactProfit ?? 0) - 0.3267) < 1e-10);
  assert.equal(margin.displayedProfit, 0.33);
  assert.equal(margin.profit, 0.33);
  assert.equal(margin.displayedPercent?.toFixed(2), "1.94");
  assert.equal(margin.percent?.toFixed(2), "1.94");
});

test("does not turn unavailable freight into zero or a definitive margin", () => {
  const margin = calculateMercadoLivreProfitMargin({
    salePrice: 18.98,
    productCost: 7.22,
    marketplaceFee: 3.23,
    freightCost: null
  });

  assert.equal(margin.status, "partial");
  assert.equal(margin.exactProfit, null);
  assert.equal(margin.displayedProfit, null);
  assert.equal(margin.displayedPercent, null);
  assert.equal(margin.profit, null);
  assert.equal(margin.percent, null);
  assert.deepEqual(margin.missingData, ["Frete"]);
});

test("keeps confirmed zero freight as a complete margin input", () => {
  const margin = calculateMercadoLivreProfitMargin({
    salePrice: 18.98,
    productCost: 7.22,
    marketplaceFee: 3.23,
    freightCost: 0
  });

  assert.equal(margin.status, "complete");
  assert.equal(margin.freightCost, 0);
  assert.ok(typeof margin.profit === "number");
  assert.deepEqual(margin.missingData, []);
});

test("returns the same displayed margin for card and calculator consumers", () => {
  const input = { salePrice: 18.98, productCost: 7.22, marketplaceFee: 3.23, freightCost: 5.95 };
  const card = calculateMercadoLivreProfitMargin(input);
  const calculator = calculateMercadoLivreProfitMargin(input);

  assert.equal(card.displayedProfit, calculator.displayedProfit);
  assert.equal(card.displayedPercent, calculator.displayedPercent);
});
