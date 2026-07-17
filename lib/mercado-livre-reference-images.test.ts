import assert from "node:assert/strict";
import test from "node:test";
import {
  filterMercadoLivreReferencesWithImages,
  hasValidMercadoLivreImage,
  mercadoLivreReferenceImageUrls,
  normalizeMercadoLivreReferenceImageUrl
} from "./mercado-livre-reference-images";

test("accepts normalized HTTPS images and preserves compatibility levels", () => {
  const items = [
    { id: "high", level: "HIGH", secure_thumbnail: "https://http2.mlstatic.com/D_1.jpg" },
    { id: "low", level: "LOW", pictures: [{ secure_url: "https://http2.mlstatic.com/D_2.jpg" }] },
    { id: "different", level: "DIFFERENT", images: [{ url: "https://http2.mlstatic.com/D_3.jpg" }] }
  ];

  assert.deepEqual(filterMercadoLivreReferencesWithImages(items).map((item) => item.level), ["HIGH", "LOW", "DIFFERENT"]);
});

test("rejects missing, insecure, embedded, local and placeholder images", () => {
  const invalidSources = [
    {},
    { imageUrl: null },
    { imageUrl: "http://http2.mlstatic.com/D_1.jpg" },
    { imageUrl: "data:image/png;base64,abc" },
    { imageUrl: "https://localhost/no-image.jpg" },
    { imageUrl: "https://http2.mlstatic.com/placeholder.png" },
    { imageUrl: "https://http2.mlstatic.com/images/sem-foto.svg" },
    { imageUrl: "/images/no-photo.png" }
  ];

  for (const source of invalidSources) assert.equal(hasValidMercadoLivreImage(source), false);
});

test("deduplicates valid images while preserving their source order", () => {
  const urls = mercadoLivreReferenceImageUrls({
    pictures: [
      { secure_url: "https://http2.mlstatic.com/first.jpg" },
      { secure_url: "https://http2.mlstatic.com/second.jpg" }
    ],
    imageUrls: ["https://http2.mlstatic.com/first.jpg"]
  });

  assert.deepEqual(urls, [
    "https://http2.mlstatic.com/first.jpg",
    "https://http2.mlstatic.com/second.jpg"
  ]);
});

test("filters images before pagination so a page is filled with visible results", () => {
  const items = [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `without-${index}`, imageUrl: null })),
    ...Array.from({ length: 12 }, (_, index) => ({ id: `with-${index}`, imageUrl: `https://http2.mlstatic.com/${index}.jpg` }))
  ];
  const visible = filterMercadoLivreReferencesWithImages(items);
  const firstPage = visible.slice(0, 10);
  const secondPage = visible.slice(10, 20);

  assert.equal(items.length, 20);
  assert.equal(visible.length, 12);
  assert.equal(firstPage.length, 10);
  assert.equal(secondPage.length, 2);
  assert.equal(firstPage.every(hasValidMercadoLivreImage), true);
});

test("normalizes a safe URL without issuing a network request", () => {
  assert.equal(
    normalizeMercadoLivreReferenceImageUrl(" https://http2.mlstatic.com/D_NQ_NP_123.jpg "),
    "https://http2.mlstatic.com/D_NQ_NP_123.jpg"
  );
});
