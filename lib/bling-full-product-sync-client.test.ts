import assert from "node:assert/strict";
import test from "node:test";
import { runBlingFullProductSyncFromEditor } from "./bling-full-product-sync-client";

test("a local save failure prevents preview and every external confirmation", async () => {
  let previews = 0;
  let confirmations = 0;
  await assert.rejects(
    runBlingFullProductSyncFromEditor({
      currentProduct: { id: "product_1" },
      hasLocalChanges: true,
      async saveLocal() {
        throw new Error("local save failed");
      },
      async preview() {
        previews += 1;
        throw new Error("must not run");
      },
      async confirm() {
        confirmations += 1;
        throw new Error("must not run");
      }
    }),
    /local save failed/
  );
  assert.equal(previews, 0);
  assert.equal(confirmations, 0);
});

test("a blocker in the preview prevents external confirmation", async () => {
  let confirmations = 0;
  await assert.rejects(
    runBlingFullProductSyncFromEditor({
      currentProduct: { id: "product_1" },
      hasLocalChanges: false,
      async saveLocal() {
        throw new Error("must not run");
      },
      async preview() {
        return {
          operation: "FULL_PRODUCT_SYNC",
          productId: "product_1",
          title: "Produto",
          populatedFieldCount: 1,
          populatedFields: ["name"],
          omittedFields: [],
          imageCount: 0,
          remoteImageCount: 0,
          remoteImagesToAddCount: 0,
          remoteImagesToRemoveCount: 0,
          stock: null,
          price: null,
          blockers: ["deposito ausente"],
          notices: [],
          endpoints: [],
          modules: [],
          planFingerprint: "fingerprint",
          planConfirmation: "confirmation",
          capabilityEnabled: true,
          payloads: {
            productFields: { nome: "Produto" },
            priceCost: null,
            stock: null,
            images: null
          }
        };
      },
      async confirm() {
        confirmations += 1;
        throw new Error("must not run");
      }
    }),
    /deposito ausente/
  );
  assert.equal(confirmations, 0);
});
