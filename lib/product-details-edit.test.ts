import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyProductTitleSuggestion,
  buildProductDetailsPatch,
  createProductDetailsEditForm,
  PRODUCT_DETAILS_NAME_MAX_LENGTH,
  productDetailsFieldDefinitions,
  productDetailsReadOnlyFieldIds
} from "./product-details-edit";
import { productUpdateSchema } from "./validation";

const completeSource = {
  name: "Retentor Bengala Fazer 250 Smartfox",
  brand: "T-Mac",
  ean: "7908073723457",
  unit: "UN",
  category: "Suspensao",
  costPrice: "15,31",
  salePrice: "46,98",
  weight: "0.52",
  grossWeight: "0.60",
  height: "2",
  width: "2",
  depth: "3",
  condition: "NEW",
  format: "SIMPLE",
  productType: "PRODUCT",
  commercialStatus: "INACTIVE",
  productionType: "OWN",
  expirationDate: "2027-12-31",
  freeShipping: false,
  volumes: "1",
  itemsPerBox: "2",
  dimensionUnit: "CENTIMETER",
  packagingGtin: "7908073723457",
  description: "Descricao preservada"
};

test("uses one stable field order in view and edit modes", () => {
  assert.deepEqual(productDetailsFieldDefinitions.map((field) => field.id), [
    "name", "brand", "sku", "ean", "unit", "category", "origin", "blingStatus",
    "format", "productType", "commercialStatus",
    "costPrice", "salePrice", "stock", "weight", "grossWeight", "condition",
    "height", "width", "depth", "productionType", "expirationDate", "freeShipping",
    "volumes", "itemsPerBox", "dimensionUnit", "packagingGtin", "updatedAt"
  ]);
});

test("keeps protected fields read-only", () => {
  assert.deepEqual(productDetailsReadOnlyFieldIds, ["sku", "origin", "blingStatus", "stock", "updatedAt"]);
});

test("keeps brand visible and editable while protected cards stay in the grid", () => {
  const brand = productDetailsFieldDefinitions.find((field) => field.id === "brand");
  assert.deepEqual(brand, { id: "brand", label: "Marca", editable: true, placeholder: "Sem marca" });
  for (const fieldId of productDetailsReadOnlyFieldIds) {
    assert.equal(productDetailsFieldDefinitions.find((field) => field.id === fieldId)?.editable, false);
  }
});

test("initializes a complete edit snapshot and preserves brand casing", () => {
  assert.deepEqual(createProductDetailsEditForm(completeSource), {
    ...completeSource,
    freeShipping: "false"
  });
});

test("initializes missing unit, category and brand as empty inputs", () => {
  const form = createProductDetailsEditForm({ name: "Produto", brand: null, unit: null, category: null });
  assert.equal(form.brand, "");
  assert.equal(form.unit, "");
  assert.equal(form.category, "");
  assert.equal(form.format, "");
  assert.equal(form.freeShipping, "");
  assert.equal(form.volumes, "");
});

test("normalizes supported condition labels for the edit select", () => {
  assert.equal(createProductDetailsEditForm({ name: "Produto", condition: "Novo" }).condition, "NEW");
  assert.equal(createProductDetailsEditForm({ name: "Produto", condition: "Usado" }).condition, "USED");
});

test("builds no payload when the complete snapshot is unchanged", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline }), { payload: {} });
});

test("sends only the field that actually changed", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, brand: "Smart" }), {
    payload: { brand: "Smart" }
  });
});

test("omits brand and every unchanged field when only unit changes", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, unit: "PC" }), {
    payload: { unit: "PC" }
  });
});

test("clears brand only after an explicit change", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, brand: "" }), {
    payload: { brand: null }
  });
});

test("rejects generic brand values without changing another field", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, brand: "Sem marca" }), {
    error: "Informe uma marca valida ou deixe o campo vazio."
  });
});

test("compares decimal fields by value and does not rewrite equivalent formatting", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, costPrice: "15.31" }), { payload: {} });
});

test("returning a changed price to its original value clears the effective patch", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, salePrice: "50" }), {
    payload: { salePriceDisplay: "50" }
  });
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, salePrice: baseline.salePrice }), {
    payload: {}
  });
});

test("distinguishes an empty price from an explicit zero", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, costPrice: "" }), {
    error: "Custo nao pode ficar vazio."
  });
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, costPrice: "0" }), {
    payload: { displayValue: "0" }
  });
});

test("rejects invalid or non-digit GTIN values before the PATCH", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  for (const ean of ["790807372345", "790807372345X", "12345678"]) {
    assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, ean }), {
      error: "GTIN/EAN invalido. Informe 8, 12, 13 ou 14 digitos validos."
    });
  }
});

test("accepts 60 title characters and rejects 61", () => {
  const baseline = createProductDetailsEditForm({ name: "Produto" });
  assert.equal(PRODUCT_DETAILS_NAME_MAX_LENGTH, 60);
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, name: "a".repeat(60) }), {
    payload: { name: "a".repeat(60) }
  });
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, name: "a".repeat(61) }), {
    error: "O titulo deve ter no maximo 60 caracteres."
  });
});

test("normalizes repeated title spaces before the limit and diff", () => {
  const baseline = createProductDetailsEditForm({ name: "Produto completo" });
  assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, name: "  Produto   completo  " }), { payload: {} });
});

test("applying an AI suggestion changes only the local name field", () => {
  const form = createProductDetailsEditForm(completeSource);
  const result = applyProductTitleSuggestion(form, "  Retentor   Fazer 250 Smartfox  ");
  assert.deepEqual(result, {
    form: {
      ...form,
      name: "Retentor Fazer 250 Smartfox"
    }
  });
  assert.deepEqual(form, createProductDetailsEditForm(completeSource));
});

test("an AI suggestion cannot bypass the 60 character title limit", () => {
  const form = createProductDetailsEditForm(completeSource);
  assert.deepEqual(applyProductTitleSuggestion(form, "a".repeat(60)), {
    form: { ...form, name: "a".repeat(60) }
  });
  assert.deepEqual(applyProductTitleSuggestion(form, "a".repeat(61)), {
    error: "O titulo deve ter no maximo 60 caracteres."
  });
  assert.deepEqual(applyProductTitleSuggestion(form, "   "), {
    error: "Escolha um titulo valido."
  });
});

test("backend accepts a partial brand patch without requiring name", () => {
  assert.deepEqual(productUpdateSchema.parse({ brand: "SCT" }), { brand: "SCT" });
});

test("backend preserves omitted fields in the validated partial contract", () => {
  assert.deepEqual(productUpdateSchema.parse({ category: "Suspensao" }), { category: "Suspensao" });
  assert.deepEqual(productUpdateSchema.parse({ condition: "NEW", grossWeight: 0.6 }), {
    condition: "NEW",
    grossWeight: 0.6
  });
});

test("builds a partial patch for the nine persisted fields and dimension unit", () => {
  const baseline = createProductDetailsEditForm({ name: "Produto" });
  const result = buildProductDetailsPatch(baseline, {
    ...baseline,
    format: "SIMPLE",
    productType: "PRODUCT",
    commercialStatus: "INACTIVE",
    productionType: "THIRD_PARTY",
    expirationDate: "2027-12-31",
    freeShipping: "false",
    volumes: "0",
    itemsPerBox: "0",
    dimensionUnit: "CENTIMETER",
    packagingGtin: "7908073723457"
  });
  assert.deepEqual(result, {
    payload: {
      format: "SIMPLE",
      productType: "PRODUCT",
      commercialStatus: "INACTIVE",
      productionType: "THIRD_PARTY",
      dimensionUnit: "CENTIMETER",
      expirationDate: "2027-12-31",
      freeShipping: false,
      volumes: 0,
      itemsPerBox: 0,
      packagingGtin: "7908073723457"
    }
  });
});

test("clearing optional commercial fields sends explicit null without touching omitted fields", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  assert.deepEqual(buildProductDetailsPatch(baseline, {
    ...baseline,
    format: "",
    freeShipping: "",
    volumes: "",
    packagingGtin: ""
  }), {
    payload: {
      format: null,
      freeShipping: null,
      volumes: null,
      packagingGtin: null
    }
  });
});

test("rejects invalid commercial enums, dates, counts and packaging GTINs", () => {
  const baseline = createProductDetailsEditForm({ name: "Produto" });
  for (const [changes, error] of [
    [{ format: "OTHER" }, "Selecione um formato valido."],
    [{ productType: "OTHER" }, "Selecione um tipo valido."],
    [{ commercialStatus: "OTHER" }, "Selecione uma situacao valida."],
    [{ productionType: "OTHER" }, "Selecione um tipo de producao valido."],
    [{ dimensionUnit: "OTHER" }, "Selecione uma unidade de medida valida."],
    [{ expirationDate: "2027-02-29" }, "Informe uma data de validade valida no formato AAAA-MM-DD."],
    [{ freeShipping: "maybe" }, "Selecione uma opcao valida para frete gratis."],
    [{ volumes: "1.5" }, "Volumes deve ser um numero inteiro."],
    [{ packagingGtin: "17891234567892" }, "GTIN/EAN tributario invalido. Informe 8, 12 ou 13 digitos validos."]
  ] as const) {
    assert.deepEqual(buildProductDetailsPatch(baseline, { ...baseline, ...changes }), { error });
  }
});

test("backend validates the nine fields while preserving false and zero", () => {
  assert.deepEqual(productUpdateSchema.parse({
    format: "SIMPLE",
    productType: "PRODUCT",
    commercialStatus: "ACTIVE",
    productionType: "OWN",
    expirationDate: "2028-02-29",
    freeShipping: false,
    volumes: 0,
    itemsPerBox: 0,
    packagingGtin: "7908073723457"
  }), {
    format: "SIMPLE",
    productType: "PRODUCT",
    commercialStatus: "ACTIVE",
    productionType: "OWN",
    expirationDate: "2028-02-29",
    freeShipping: false,
    volumes: 0,
    itemsPerBox: 0,
    packagingGtin: "7908073723457"
  });
  assert.equal(productUpdateSchema.safeParse({ expirationDate: "2027-02-29" }).success, false);
  assert.equal(productUpdateSchema.safeParse({ packagingGtin: "17891234567892" }).success, false);
  assert.equal(productUpdateSchema.safeParse({ volumes: 1.5 }).success, false);
});

test("all existing products remain valid when every new optional field is null", () => {
  assert.deepEqual(productUpdateSchema.parse({
    format: null,
    productType: null,
    commercialStatus: null,
    productionType: null,
    expirationDate: null,
    freeShipping: null,
    volumes: null,
    itemsPerBox: null,
    packagingGtin: null
  }), {
    format: null,
    productType: null,
    commercialStatus: null,
    productionType: null,
    expirationDate: null,
    freeShipping: null,
    volumes: null,
    itemsPerBox: null,
    packagingGtin: null
  });
});

test("backend rejects empty prices but accepts explicit zero", () => {
  assert.equal(productUpdateSchema.safeParse({ displayValue: null }).success, false);
  assert.equal(productUpdateSchema.safeParse({ displayValue: "" }).success, false);
  assert.deepEqual(productUpdateSchema.parse({ displayValue: "0" }), { displayValue: "0" });
});

test("backend rejects empty payloads and unknown protected fields", () => {
  assert.equal(productUpdateSchema.safeParse({}).success, false);
  assert.equal(productUpdateSchema.safeParse({ brand: "SCT", externalProductId: "forbidden" }).success, false);
});

test("cancel can restore the immutable baseline without carrying edited values", () => {
  const baseline = createProductDetailsEditForm(completeSource);
  const edited = { ...baseline, name: "Outro nome", unit: "PC" };
  const restored = createProductDetailsEditForm(completeSource);
  assert.notDeepEqual(edited, baseline);
  assert.deepEqual(restored, baseline);
});

test("the details page renders the same field contract in view and edit without a separate mobile layout", () => {
  const source = readFileSync(
    new URL("../components/product-details-view.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /productDetailsFieldDefinitions\.map/);
  assert.match(source, /field\.options\.map/);
  assert.match(source, /sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(source, /formFromProduct\(currentProduct\)/);
  assert.match(source, /const nextForm = formFromProduct\(currentProduct\)/);
  assert.match(source, /setForm\(nextForm\)/);
  assert.match(source, /dirtyFields\.size > 0/);
  assert.doesNotMatch(source, /JSON\.stringify\(form\)/);
  assert.doesNotMatch(source, /NEXT_PUBLIC.*BLING|requestWithoutRefresh/);
});

test("the detail response supplies edit capability without a duplicate session request", () => {
  const detailsSource = readFileSync(
    new URL("../components/product-details-view.tsx", import.meta.url),
    "utf8"
  );
  const pageSource = readFileSync(
    new URL("../components/pages/product-details-page.tsx", import.meta.url),
    "utf8"
  );
  const routeSource = readFileSync(
    new URL("../app/api/products/[id]/route.ts", import.meta.url),
    "utf8"
  );
  const serviceSource = readFileSync(
    new URL("./services/product-details-service.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(detailsSource, /fetch\("\/api\/auth\/session"\)/);
  assert.doesNotMatch(pageSource, /fetch\(/);
  assert.match(pageSource, /canEditProduct=\{canEditProduct\}/);
  assert.match(routeSource, /loadProductDetails\(auth\.context, id\)/);
  assert.match(serviceSource, /hasSystemPermission\(authContext, "products:write"\)/);
});
