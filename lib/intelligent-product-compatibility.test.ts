import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductReferenceSearchQueries,
  calculateProductSuggestionCompatibility,
  extractProductTitleSignals,
  isProductSuggestionPreviewAllowed,
  shouldContinueCompatibleReferenceSearch
} from "./intelligent-product-compatibility";

const localSensor = {
  name: "Sensor Hibrido PCX 150 13-15 / Lead 110 10-16 T-Mac",
  brand: "T-Mac"
};

test("classifies Titan 160 Magnetron as a different product", () => {
  const result = calculateProductSuggestionCompatibility(localSensor, {
    title: "Sensor Hibrido Titan160 Magnetron",
    brand: "Magnetron",
    gtin: "7899761404928"
  });

  assert.equal(result.level, "DIFFERENT");
  assert.equal(isProductSuggestionPreviewAllowed(result), false);
  assert.ok(result.blockingReasons.some((reason) => reason.includes("Modelo")));
});

test("classifies the matching PCX 150 and Lead 110 reference as high compatibility", () => {
  const result = calculateProductSuggestionCompatibility(localSensor, {
    title: "Sensor Hibrido PCX 150 Lead 110 T-Mac",
    brand: "T-Mac"
  });

  assert.equal(result.level, "HIGH");
  assert.equal(isProductSuggestionPreviewAllowed(result), true);
});

test("blocks the same part type when the application model is different", () => {
  const result = calculateProductSuggestionCompatibility(
    { name: "Rolamento roda dianteira Honda PCX 150", brand: "Honda" },
    { title: "Rolamento roda dianteira Honda Titan 160", brand: "Honda" }
  );

  assert.equal(result.level, "DIFFERENT");
});

test("keeps a matching model with a different relevant brand below the preview threshold", () => {
  const result = calculateProductSuggestionCompatibility(localSensor, {
    title: "Sensor Hibrido PCX 150 Lead 110 Magnetron",
    brand: "Magnetron"
  });

  assert.equal(result.level, "LOW");
  assert.equal(isProductSuggestionPreviewAllowed(result), false);
});

test("gives exact GTIN the maximum compatibility priority", () => {
  const result = calculateProductSuggestionCompatibility(
    { name: "Produto local especifico", gtin: "7891234567895" },
    { title: "Referencia catalogada", gtin: "7891234567895" }
  );

  assert.equal(result.level, "HIGH");
  assert.equal(isProductSuggestionPreviewAllowed(result), true);
});

test("blocks divergent GTIN values", () => {
  const result = calculateProductSuggestionCompatibility(
    { name: "Produto local especifico", gtin: "7891234567895" },
    { title: "Produto local especifico", gtin: "7891234567888" }
  );

  assert.equal(result.level, "DIFFERENT");
  assert.equal(isProductSuggestionPreviewAllowed(result), false);
});

test("does not open the preview for a generic title without application evidence", () => {
  const result = calculateProductSuggestionCompatibility(
    { name: "Sensor hibrido" },
    { title: "Sensor hibrido" }
  );

  assert.ok(result.level === "LOW" || result.level === "INSUFFICIENT");
  assert.equal(isProductSuggestionPreviewAllowed(result), false);
});

test("builds staged title queries without falling back to the generic part name", () => {
  const queries = buildProductReferenceSearchQueries({
    title: localSensor.name,
    brand: localSensor.brand
  });
  const signals = extractProductTitleSignals(localSensor.name, localSensor.brand);

  assert.deepEqual(signals.applicationModels, ["pcx 150", "lead 110"]);
  assert.deepEqual(signals.years, ["2013-2015", "2010-2016"]);
  assert.ok(queries.length <= 3);
  assert.ok(queries.some((query) => query.includes("pcx 150") && query.includes("lead 110")));
  assert.equal(queries.some((query) => query === "sensor hibrido"), false);
});

test("keeps SKU 8650 applications in search and blocks another motorcycle model", () => {
  const localProduct = {
    name: "Tubo Interno Bengala Twister 250 01 A 08 Cb 300 T-Mac",
    brand: "T-Mac"
  };
  const queries = buildProductReferenceSearchQueries({
    title: localProduct.name,
    brand: localProduct.brand
  });
  const result = calculateProductSuggestionCompatibility(localProduct, {
    title: "Tubo Interno Bengala Titan 160 T-Mac",
    brand: "T-Mac"
  });

  assert.ok(queries.some((query) => query.toLocaleLowerCase("pt-BR").includes("twister 250") && query.toLocaleLowerCase("pt-BR").includes("cb 300")));
  assert.equal(queries.some((query) => query.toLocaleLowerCase("pt-BR") === "tubo interno bengala"), false);
  assert.equal(result.level, "DIFFERENT");
  assert.equal(isProductSuggestionPreviewAllowed(result), false);
});

test("allows a controlled second page and stops at the configured page limit", () => {
  const firstPageResult = calculateProductSuggestionCompatibility(localSensor, {
    title: "Sensor Hibrido Titan160 Magnetron",
    brand: "Magnetron"
  });
  const secondPageResult = calculateProductSuggestionCompatibility(localSensor, {
    title: "Sensor Hibrido PCX 150 Lead 110 T-Mac",
    brand: "T-Mac"
  });

  assert.equal(
    shouldContinueCompatibleReferenceSearch({
      page: 1,
      maxPages: 3,
      hasNextPage: true,
      hasAcceptableResult: isProductSuggestionPreviewAllowed(firstPageResult)
    }),
    true
  );
  assert.equal(isProductSuggestionPreviewAllowed(secondPageResult), true);
  assert.equal(
    shouldContinueCompatibleReferenceSearch({
      page: 3,
      maxPages: 3,
      hasNextPage: true,
      hasAcceptableResult: false
    }),
    false
  );
});
