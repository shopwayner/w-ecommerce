import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeProductBrand,
  extractBlingProductBrand,
  normalizeProductBrand,
  resolveProductBrandFromBling
} from "./product-brand";

test("normalizes a valid Bling brand without changing its casing", () => {
  assert.equal(normalizeProductBrand("  T-Mac  "), "T-Mac");
  assert.equal(normalizeProductBrand("Marca   Composta"), "Marca Composta");
});

test("rejects empty and generic brand values", () => {
  for (const value of [null, "", "   ", "Sem marca", "SEM MARCA", "N/A", "Não informado", "Não se aplica", "Genérico"]) {
    assert.equal(normalizeProductBrand(value), null);
  }
});

test("distinguishes an empty brand from a generic value", () => {
  assert.deepEqual(analyzeProductBrand(" "), { brand: null, rejection: "EMPTY" });
  assert.deepEqual(analyzeProductBrand("N/A"), { brand: null, rejection: "GENERIC" });
  assert.deepEqual(analyzeProductBrand("T-Mac"), { brand: "T-Mac", rejection: null });
});

test("extracts the official Bling marca field", () => {
  assert.equal(extractBlingProductBrand({ marca: "T-Mac" }), "T-Mac");
  assert.equal(extractBlingProductBrand({ marca: { nome: "CINBORG" } }), "CINBORG");
  assert.equal(extractBlingProductBrand({ brand: "Nao e o campo oficial" }), null);
});

test("invalid Bling values do not overwrite the current local brand", () => {
  assert.equal(resolveProductBrandFromBling("T-Mac", "Sem marca"), "T-Mac");
  assert.equal(resolveProductBrandFromBling("T-Mac", " "), "T-Mac");
  assert.equal(resolveProductBrandFromBling(null, "Sem marca"), null);
});
