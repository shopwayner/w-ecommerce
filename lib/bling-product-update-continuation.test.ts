import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyBlingProductUpdateCompletion,
  type BlingProductModalEditableState
} from "./bling-product-update-continuation";

const remoteA = "https://cdn.example.com/remote-a.jpg";
const localB = "https://cdn.example.com/local-b.jpg";
const localC = "https://cdn.example.com/local-c.jpg";

function editableState(): BlingProductModalEditableState {
  return {
    title: "Titulo ainda nao enviado",
    nameTouched: true,
    remoteImages: [remoteA],
    selectedImageIndex: 0,
    selectedLocalImages: [localB, localC]
  };
}

test("image success refreshes the gallery and clears only the photos that were sent", () => {
  const next = applyBlingProductUpdateCompletion(
    editableState(),
    {
      sequence: 1,
      operation: "IMAGES_ONLY_APPEND",
      sentImages: [localB]
    },
    [remoteA, localB]
  );

  assert.equal(next.title, "Titulo ainda nao enviado");
  assert.equal(next.nameTouched, true);
  assert.deepEqual(next.remoteImages, [remoteA, localB]);
  assert.deepEqual(next.selectedLocalImages, [localC]);
});

test("name success confirms the title while preserving selected photos and their order", () => {
  const next = applyBlingProductUpdateCompletion(
    editableState(),
    {
      sequence: 2,
      operation: "NAME_ONLY",
      confirmedName: "Titulo confirmado",
      sentImages: []
    },
    [remoteA]
  );

  assert.equal(next.title, "Titulo confirmado");
  assert.equal(next.nameTouched, false);
  assert.deepEqual(next.selectedLocalImages, [localB, localC]);
  assert.deepEqual(next.remoteImages, [remoteA]);
});

test("continues from images to name without losing the unsent title", () => {
  const afterImages = applyBlingProductUpdateCompletion(
    editableState(),
    {
      sequence: 1,
      operation: "IMAGES_ONLY_APPEND",
      sentImages: [localB]
    },
    [remoteA, localB]
  );
  const afterName = applyBlingProductUpdateCompletion(
    afterImages,
    {
      sequence: 2,
      operation: "NAME_ONLY",
      confirmedName: "Titulo confirmado depois das fotos",
      sentImages: []
    },
    [remoteA, localB]
  );

  assert.equal(afterImages.title, "Titulo ainda nao enviado");
  assert.equal(afterName.title, "Titulo confirmado depois das fotos");
  assert.deepEqual(afterName.remoteImages, [remoteA, localB]);
  assert.deepEqual(afterName.selectedLocalImages, [localC]);
});

test("continues from name to images without requiring photo reselection", () => {
  const afterName = applyBlingProductUpdateCompletion(
    editableState(),
    {
      sequence: 1,
      operation: "NAME_ONLY",
      confirmedName: "Titulo confirmado antes das fotos",
      sentImages: []
    },
    [remoteA]
  );
  const afterImages = applyBlingProductUpdateCompletion(
    afterName,
    {
      sequence: 2,
      operation: "IMAGES_ONLY_APPEND",
      sentImages: [localB, localC]
    },
    [remoteA, localB, localC]
  );

  assert.deepEqual(afterName.selectedLocalImages, [localB, localC]);
  assert.equal(afterImages.title, "Titulo confirmado antes das fotos");
  assert.deepEqual(afterImages.remoteImages, [remoteA, localB, localC]);
  assert.deepEqual(afterImages.selectedLocalImages, []);
});

test("successful handlers refresh only the current product and never clear table selection", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  const nameStart = pageSource.indexOf("async function confirmBlingProductUpdate");
  const imagesStart = pageSource.indexOf("async function confirmBlingProductImages");
  const nextHandler = pageSource.indexOf("async function confirmBlingProductLinkMismatch");
  const nameHandler = pageSource.slice(nameStart, imagesStart);
  const imageHandler = pageSource.slice(imagesStart, nextHandler);

  assert.doesNotMatch(nameHandler, /setSelectedProductIds/);
  assert.doesNotMatch(imageHandler, /setSelectedProductIds/);
  assert.doesNotMatch(nameHandler, /loadProducts\(\)/);
  assert.doesNotMatch(imageHandler, /loadProducts\(\)/);
  assert.doesNotMatch(nameHandler, /closeBlingUpdateModal|setBlingUpdateOpen\(false\)/);
  assert.doesNotMatch(imageHandler, /closeBlingUpdateModal|setBlingUpdateOpen\(false\)/);
  assert.match(nameHandler, /fetchBlingUpdatePreview\(result\.productId\)/);
  assert.match(imageHandler, /fetchBlingUpdatePreview\(result\.productId\)/);
});

test("operation-specific resets and continuation messages remain independent", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );

  assert.match(pageSource, /function resetNameOperationState\(\)/);
  assert.match(pageSource, /function resetImageOperationState\(\)/);
  assert.match(
    pageSource,
    /Fotos adicionadas ao Bling\. Você ainda pode atualizar o título deste produto\./
  );
  assert.match(
    pageSource,
    /Título atualizado\. Gere novamente a prévia das fotos antes de enviá-las\./
  );
  assert.match(
    pageSource,
    /blingImageAppendIdempotencyKey\.current = null;[\s\S]*setBlingUpdateCompletion\(createOperationCompletion\("NAME_ONLY"/
  );
});

test("failure branches preserve the modal state and do not trigger an automatic request", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  const modalSource = readFileSync(
    path.join(process.cwd(), "components/bling-product-update-modal.tsx"),
    "utf8"
  );

  assert.match(pageSource, /if \(result\.status === "FAILED"\) \{[\s\S]*setBlingUpdateResult\(result\);[\s\S]*return;/);
  assert.match(pageSource, /if \(outcome\.kind === "REJECTED"\) \{[\s\S]*setBlingUpdateMessage\(outcome\.message\);[\s\S]*return;/);
  assert.match(modalSource, /useEffect\(\(\) => \{[\s\S]*applyBlingProductUpdateCompletion/);
});
