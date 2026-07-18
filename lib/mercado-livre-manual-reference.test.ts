import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMercadoLivreManualReference,
  parseMercadoLivreReferenceInput
} from "./mercado-livre-manual-reference";
import {
  calculateProductSuggestionCompatibility,
  productSuggestionNeedsAttention
} from "./intelligent-product-compatibility";

test("accepts a Mercado Livre item ID", () => {
  assert.equal(parseMercadoLivreReferenceInput("MLB1234567890"), "MLB1234567890");
  assert.equal(parseMercadoLivreReferenceInput("mlb-1234567890"), "MLB1234567890");
});

test("accepts an official HTTPS Mercado Livre product URL", () => {
  assert.equal(
    parseMercadoLivreReferenceInput("https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM?utm_source=teste"),
    "MLB1234567890"
  );
});

test("rejects external domains, lookalike domains and shortened URLs", () => {
  assert.equal(parseMercadoLivreReferenceInput("https://example.com/MLB-1234567890-produto"), null);
  assert.equal(parseMercadoLivreReferenceInput("https://mercadolivre.com.br.example.com/MLB-1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("https://bit.ly/MLB1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("https://localhost/MLB-1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("https://127.0.0.1/MLB-1234567890"), null);
});

test("rejects non-HTTPS protocols, invalid IDs and unsafe URL content", () => {
  assert.equal(parseMercadoLivreReferenceInput("http://produto.mercadolivre.com.br/MLB-1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("javascript:alert('MLB1234567890')"), null);
  assert.equal(parseMercadoLivreReferenceInput("data:text/plain,MLB1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("file:///MLB1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("ftp://produto.mercadolivre.com.br/MLB-1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("https://user:password@produto.mercadolivre.com.br/MLB-1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("https://produto.mercadolivre.com.br:444/MLB-1234567890"), null);
  assert.equal(parseMercadoLivreReferenceInput("MLB12abc"), null);
  assert.equal(
    parseMercadoLivreReferenceInput("https://produto.mercadolivre.com.br/MLB-1234567890?next=%3Cscript%3Ealert(1)%3C/script%3E"),
    null
  );
  assert.equal(
    parseMercadoLivreReferenceInput("https://produto.mercadolivre.com.br/%3Cscript%3EMLB-1234567890%3C/script%3E"),
    null
  );
  assert.equal(
    parseMercadoLivreReferenceInput("https://produto.mercadolivre.com.br/MLB-1234567890-MLB-1234567891"),
    null
  );
});

test("returns only normalized fields needed by the preview and compatibility check", () => {
  const reference = normalizeMercadoLivreManualReference({
    externalItemId: "MLB1234567890",
    title: "  Sensor Hibrido PCX 150  ",
    brand: " T-Mac ",
    gtin: "7891234567890",
    price: 189.9,
    currencyId: " BRL ",
    imageUrl: "http://http2.mlstatic.com/D_NQ_NP_test.jpg",
    imageUrls: [
      "https://http2.mlstatic.com/D_NQ_NP_test.jpg",
      "https://example.com/not-allowed.jpg"
    ],
    categoryId: "MLB1234",
    categoryName: "Sensores",
    categoryPath: "Motos > Sensores",
    attributes: [
      { id: "BRAND", name: "Marca", value: "T-Mac" },
      { id: "COLOR", name: "Cor", value: "Preto" }
    ]
  });

  assert.deepEqual(reference, {
    itemId: "MLB1234567890",
    title: "Sensor Hibrido PCX 150",
    brand: "T-Mac",
    images: ["https://http2.mlstatic.com/D_NQ_NP_test.jpg"],
    gtin: "7891234567890",
    price: 189.9,
    currencyId: "BRL",
    category: {
      id: "MLB1234",
      name: "Sensores",
      path: "Motos > Sensores"
    },
    attributes: [{ id: "BRAND", name: "Marca", value: "T-Mac" }]
  });
});

const localProduct = {
  name: "Sensor Hibrido PCX 150 13-15 / Lead 110 10-16 T-Mac",
  brand: "T-Mac",
  gtin: "7891234567890"
};

test("allows a compatible manually informed listing", () => {
  const compatibility = calculateProductSuggestionCompatibility(localProduct, {
    title: "Sensor Hibrido PCX 150 Lead 110 T-Mac",
    brand: "T-Mac",
    gtin: "7891234567890"
  });

  assert.equal(compatibility.level, "HIGH");
  assert.equal(productSuggestionNeedsAttention(compatibility), false);
});

test("keeps a divergent GTIN available with an attention warning in the manual flow", () => {
  const compatibility = calculateProductSuggestionCompatibility(localProduct, {
    title: "Sensor Hibrido PCX 150 Lead 110 T-Mac",
    brand: "T-Mac",
    gtin: "7891234567891"
  });

  assert.equal(compatibility.level, "DIFFERENT");
  assert.equal(productSuggestionNeedsAttention(compatibility), true);
});

test("keeps incompatible model and brand references available with an attention warning", () => {
  const differentModel = calculateProductSuggestionCompatibility(localProduct, {
    title: "Sensor Hibrido Titan 160 T-Mac",
    brand: "T-Mac"
  });
  const differentBrand = calculateProductSuggestionCompatibility(localProduct, {
    title: "Sensor Hibrido PCX 150 Lead 110 Magnetron",
    brand: "Magnetron"
  });

  assert.equal(productSuggestionNeedsAttention(differentModel), true);
  assert.equal(productSuggestionNeedsAttention(differentBrand), true);
});
