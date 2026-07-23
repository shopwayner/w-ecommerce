import assert from "node:assert/strict";
import test from "node:test";

import {
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
  description: "Descricao preservada"
};

test("uses one stable field order in view and edit modes", () => {
  assert.deepEqual(productDetailsFieldDefinitions.map((field) => field.id), [
    "name", "brand", "sku", "ean", "unit", "category", "origin", "blingStatus",
    "costPrice", "salePrice", "stock", "weight", "grossWeight", "condition",
    "height", "width", "depth", "updatedAt"
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
  assert.deepEqual(createProductDetailsEditForm(completeSource), completeSource);
});

test("initializes missing unit, category and brand as empty inputs", () => {
  const form = createProductDetailsEditForm({ name: "Produto", brand: null, unit: null, category: null });
  assert.equal(form.brand, "");
  assert.equal(form.unit, "");
  assert.equal(form.category, "");
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
