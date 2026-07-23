import assert from "node:assert/strict";
import test from "node:test";
import {
  createBlingProductImageAppendPlan,
  verifyBlingProductImageAppendResult
} from "./bling-product-image-append";

const image = (name: string) => ({ url: `https://images.example.com/${name}.jpg` });

test("appends two selected photos after the current remote gallery", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [image("a")],
    selectedImages: [image("b"), image("c")]
  });

  assert.equal(plan.status, "READY");
  assert.deepEqual(plan.finalImages.map((item) => item.url), [image("a").url, image("b").url, image("c").url]);
  assert.equal(plan.remoteImageCount, 1);
  assert.equal(plan.finalImageCount, 3);
  assert.equal(plan.remotePrincipalPreserved, true);
  assert.equal(plan.remoteOrderPreserved, true);
});

test("uses the first selected photo as principal only when the remote gallery is empty", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [],
    selectedImages: [image("b"), image("c")]
  });

  assert.equal(plan.status, "READY");
  assert.equal(plan.finalImages[0]?.url, image("b").url);
  assert.equal(plan.finalImageCount, 2);
});

test("ignores a selected photo that already exists remotely", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [image("a")],
    selectedImages: [image("a"), image("b")]
  });

  assert.equal(plan.status, "READY");
  assert.equal(plan.duplicateImageCount, 1);
  assert.deepEqual(plan.finalImages.map((item) => item.url), [image("a").url, image("b").url]);
});

test("deduplicates different URLs by a known content fingerprint and keeps the larger selected resolution", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [image("a")],
    selectedImages: [
      { ...image("b-small"), contentFingerprint: "sha256:same", width: 320, height: 240 },
      { ...image("b-large"), contentFingerprint: "sha256:same", width: 1600, height: 1200 }
    ]
  });

  assert.equal(plan.newImageCount, 1);
  assert.equal(plan.duplicateImageCount, 1);
  assert.equal(plan.newImages[0]?.url, image("b-large").url);
});

test("deduplicates Mercado Livre URLs for the same official asset in different resolutions", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [
      {
        url: "https://http2.mlstatic.com/D_NQ_NP_123456-MLB99999999999_012026-F.jpg"
      }
    ],
    selectedImages: [
      {
        url: "https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLB99999999999_012026-O.jpg"
      },
      { url: "https://cdn.example.com/new.jpg" }
    ]
  });

  assert.equal(plan.status, "READY");
  assert.equal(plan.duplicateImageCount, 1);
  assert.deepEqual(plan.finalImages.map((item) => item.url), [
    "https://http2.mlstatic.com/D_NQ_NP_123456-MLB99999999999_012026-F.jpg",
    "https://cdn.example.com/new.jpg"
  ]);
});

test("does not treat merely similar official names as duplicate images", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [{ ...image("a"), officialName: "produto-frente" }],
    selectedImages: [{ ...image("b"), officialName: "produto-frente-nova" }]
  });

  assert.equal(plan.status, "READY");
  assert.equal(plan.newImageCount, 1);
  assert.equal(plan.duplicateImageCount, 0);
});

test("fails closed when the current remote gallery contains duplicates", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [image("a"), image("a")],
    selectedImages: [image("b")]
  });

  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.violations.includes("REMOTE_GALLERY_HAS_DUPLICATES"));
});

test("fails closed when the complete remote gallery cannot be proven", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: [image("a")],
    selectedImages: [image("b")],
    remoteGalleryComplete: false
  });

  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.violations.includes("REMOTE_GALLERY_INCOMPLETE"));
});

test("fails closed instead of truncating a gallery above the Bling limit", () => {
  const plan = createBlingProductImageAppendPlan({
    remoteImages: Array.from({ length: 12 }, (_, index) => image(`remote-${index}`)),
    selectedImages: [image("new-1"), image("new-2")]
  });

  assert.equal(plan.status, "BLOCKED");
  assert.equal(plan.finalImageCount, 14);
  assert.ok(plan.violations.includes("IMAGE_LIMIT_EXCEEDED"));
});

test("post-write verification rejects loss, reordering and duplicates", () => {
  const expected = createBlingProductImageAppendPlan({
    remoteImages: [image("a")],
    selectedImages: [image("b"), image("c")]
  });

  assert.equal(verifyBlingProductImageAppendResult({
    expected,
    actualImages: [image("a"), image("b"), image("c")]
  }).matches, true);
  assert.equal(verifyBlingProductImageAppendResult({
    expected,
    actualImages: [image("b"), image("a"), image("c")]
  }).matches, false);
  assert.equal(verifyBlingProductImageAppendResult({
    expected,
    actualImages: [image("a"), image("b"), image("c"), image("c")]
  }).matches, false);
});
