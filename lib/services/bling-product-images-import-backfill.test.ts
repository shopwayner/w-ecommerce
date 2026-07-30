import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  appendMissingBlingProductImages,
  hydrateNewBlingProductFromDetail,
  normalizeBlingCatalogPage
} from "./bling-product-import-service";
import {
  type BlingProductImageBackfillDependencies,
  runBlingProductImageBackfill
} from "./bling-product-image-backfill";
import { readBlingProductImageUrls } from "./bling-product-update-service";
import { parseBlingProductImageBackfillArguments } from "../../scripts/backfill-bling-product-images";

type StoredImage = {
  organizationId: string;
  productId: string;
  url: string;
  position: number;
};

function summaryProduct() {
  return normalizeBlingCatalogPage({
    data: [{
      id: "external-1",
      codigo: "SKU-1",
      nome: "Produto com foto",
      situacao: "A",
      formato: "S"
    }],
    total: 1
  }).products[0];
}

function detailPayload(images: unknown[]) {
  return {
    data: {
      id: "external-1",
      codigo: "SKU-1",
      nome: "Produto com foto",
      situacao: "A",
      formato: "S",
      midia: {
        imagens: {
          externas: images
        }
      }
    }
  };
}

function imageTransaction(initial: StoredImage[] = []) {
  const stored = [...initial];
  const transaction = {
    productImage: {
      findMany: async () => stored.map(({ url, position }) => ({ url, position })),
      createMany: async ({ data }: { data: StoredImage[] }) => {
        stored.push(...data);
        return { count: data.length };
      }
    }
  } as unknown as Prisma.TransactionClient;
  return {
    transaction,
    stored
  };
}

function candidates() {
  return [
    {
      productId: "product-1",
      mappings: [{ mappingId: "mapping-1", externalProductId: "external-1" }]
    },
    {
      productId: "product-2",
      mappings: [{ mappingId: "mapping-2", externalProductId: "external-2" }]
    }
  ];
}

function backfillDependencies(
  overrides: Partial<BlingProductImageBackfillDependencies> = {}
): BlingProductImageBackfillDependencies {
  return {
    validateScope: async () => undefined,
    countProductsWithoutImages: async () => 2,
    listCandidates: async () => candidates(),
    productHasImages: async () => false,
    fetchDetail: async ({ externalProductId }) => detailPayload([
      { link: `https://cdn.example.com/${externalProductId}.jpg` }
    ]),
    persistImages: async ({ images }) => images.length,
    ...overrides
  };
}

test("1. detalhe Bling com uma imagem propaga a URL para ProductImage", async () => {
  const hydrated = await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-a",
      connectionId: "connection-a",
      product: summaryProduct()
    },
    async () => detailPayload([{ link: "https://cdn.example.com/a.jpg" }])
  );
  const state = imageTransaction();
  await appendMissingBlingProductImages(
    state.transaction,
    "organization-a",
    "product-a",
    hydrated.images
  );
  assert.deepEqual(state.stored.map((image) => image.url), [
    "https://cdn.example.com/a.jpg"
  ]);
});

test("2. varias imagens preservam a ordem recebida do detalhe", () => {
  assert.deepEqual(readBlingProductImageUrls(detailPayload([
    { link: "https://cdn.example.com/a.jpg" },
    { link: "https://cdn.example.com/b.jpg" },
    { link: "https://cdn.example.com/c.jpg" }
  ])), [
    "https://cdn.example.com/a.jpg",
    "https://cdn.example.com/b.jpg",
    "https://cdn.example.com/c.jpg"
  ]);
});

test("3. primeira imagem ocupa position zero e representa a principal", async () => {
  const state = imageTransaction();
  await appendMissingBlingProductImages(
    state.transaction,
    "organization-a",
    "product-a",
    ["https://cdn.example.com/main.jpg", "https://cdn.example.com/second.jpg"]
  );
  assert.deepEqual(state.stored.map(({ url, position }) => ({ url, position })), [
    { url: "https://cdn.example.com/main.jpg", position: 0 },
    { url: "https://cdn.example.com/second.jpg", position: 1 }
  ]);
});

test("4. URL vazia ou insegura e ignorada sem perder URL valida", async () => {
  const state = imageTransaction();
  await appendMissingBlingProductImages(
    state.transaction,
    "organization-a",
    "product-a",
    ["", "http://cdn.example.com/insecure.jpg", "https://cdn.example.com/valid.jpg"]
  );
  assert.deepEqual(state.stored.map((image) => image.url), [
    "https://cdn.example.com/valid.jpg"
  ]);
});

test("5. URLs duplicadas sao persistidas uma unica vez", async () => {
  const state = imageTransaction();
  await appendMissingBlingProductImages(
    state.transaction,
    "organization-a",
    "product-a",
    ["https://cdn.example.com/a.jpg", "https://cdn.example.com/a.jpg"]
  );
  assert.equal(state.stored.length, 1);
});

test("6. segunda execucao nao duplica ProductImage", async () => {
  const state = imageTransaction();
  const input = ["https://cdn.example.com/a.jpg"];
  assert.equal(await appendMissingBlingProductImages(
    state.transaction,
    "organization-a",
    "product-a",
    input
  ), true);
  assert.equal(await appendMissingBlingProductImages(
    state.transaction,
    "organization-a",
    "product-a",
    input
  ), false);
  assert.equal(state.stored.length, 1);
});

test("7. falha de validacao de uma foto nao remove produto nem fotos validas", async () => {
  let productMutationCalled = false;
  const state = imageTransaction();
  (state.transaction as unknown as { product: { delete: () => void } }).product = {
    delete: () => {
      productMutationCalled = true;
    }
  };
  await appendMissingBlingProductImages(
    state.transaction,
    "organization-a",
    "product-a",
    ["javascript:alert(1)", "https://cdn.example.com/a.jpg"]
  );
  assert.equal(productMutationCalled, false);
  assert.equal(state.stored.length, 1);
});

test("8. ProductImage recebe organizationId e productId do mesmo tenant", async () => {
  const state = imageTransaction();
  await appendMissingBlingProductImages(
    state.transaction,
    "organization-willian",
    "product-willian",
    ["https://cdn.example.com/a.jpg"]
  );
  assert.deepEqual(state.stored[0], {
    organizationId: "organization-willian",
    productId: "product-willian",
    url: "https://cdn.example.com/a.jpg",
    position: 0
  });
});

test("9. API da listagem filtra ProductImage pela organizacao autenticada", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/route.ts"),
    "utf8"
  );
  assert.match(
    source,
    /images:\s*\{\s*\.\.\.productListSelect\.images,\s*where:\s*\{\s*organizationId:\s*auth\.context\.organizationId\s*\}/
  );
});

test("10. API retorna somente a primeira ProductImage como imageUrl", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/route.ts"),
    "utf8"
  );
  assert.match(source, /images:\s*\{\s*take:\s*1,\s*orderBy:\s*\{\s*position:\s*"asc"/);
  assert.match(source, /imageUrl:\s*product\.images\[0\]\?\.url\s*\?\?\s*null/);
});

test("11. frontend usa imageUrl retornada pela API", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  assert.match(source, /<ProductListThumbnail[\s\S]+src=\{product\.imageUrl\}/);
  assert.match(source, /src=\{src\}/);
});

test("12. frontend mostra fallback quando nao existe imagem", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  assert.match(source, /if \(!src \|\| failed\)[\s\S]+<ImageIcon/);
});

test("13. frontend mostra fallback quando a URL falha", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  assert.match(source, /onError=\{\(\) => setFailed\(true\)\}/);
});

test("14. CREATE usa o detalhe completo antes de persistir", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  assert.match(
    source,
    /operation === "IMPORT" && input\.preliminaryMatch\.kind === "CREATE"[\s\S]+hydrateBlingProductForPersistence/
  );
});

test("15. SYNC de mapping atualiza imagens sem criar novo Product", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  assert.match(
    source,
    /operation === "SYNC" && input\.preliminaryMatch\.kind === "MAPPING"[\s\S]+hydrateBlingProductForPersistence/
  );
  assert.match(
    source,
    /export async function applyMappedBlingProductSync[\s\S]+appendMissingBlingProductImages/
  );
});

test("16. backfill seleciona somente mappings cujos Products nao possuem imagem", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-image-backfill.ts"),
    "utf8"
  );
  assert.match(source, /images:\s*\{\s*none:\s*\{\}\s*\}[\s\S]+connectionId:\s*input\.connectionId/);
});

test("17. backfill preserva tenant e nao possui referencia especial a master", async () => {
  const scopes: unknown[] = [];
  await runBlingProductImageBackfill({
    organizationId: "organization-willian",
    connectionId: "connection-j-commerce"
  }, backfillDependencies({
    validateScope: async (input) => {
      scopes.push({
        organizationId: input.organizationId,
        connectionId: input.connectionId
      });
    }
  }));
  assert.deepEqual(scopes, [{
    organizationId: "organization-willian",
    connectionId: "connection-j-commerce"
  }]);
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-image-backfill.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /w-ecommerce-master|262 Moto/i);
});

test("18. dry-run nao persiste nem altera outros campos", async () => {
  let persists = 0;
  const result = await runBlingProductImageBackfill({
    organizationId: "organization-willian",
    connectionId: "connection-j-commerce"
  }, backfillDependencies({
    persistImages: async () => {
      persists += 1;
      return 1;
    }
  }));
  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.wouldUpdate, 2);
  assert.equal(result.updated, 0);
  assert.equal(persists, 0);
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-image-backfill.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /product\.update|productPrice|inventoryBalance|draft/i);
});

test("19. backfill retorna cursor e permite retomar a partir dele", async () => {
  const cursors: Array<string | null> = [];
  const result = await runBlingProductImageBackfill({
    organizationId: "organization-willian",
    connectionId: "connection-j-commerce",
    cursor: "mapping-before",
    limit: 1
  }, backfillDependencies({
    listCandidates: async (input) => {
      cursors.push(input.cursor);
      return candidates();
    }
  }));
  assert.deepEqual(cursors, ["mapping-before"]);
  assert.equal(result.nextCursor, "product-1");
  assert.equal(result.hasMore, true);
});

test("20. backfill e idempotente e continua apos falha individual", async () => {
  const fetched: string[] = [];
  let persists = 0;
  const result = await runBlingProductImageBackfill({
    organizationId: "organization-willian",
    connectionId: "connection-j-commerce",
    confirm: true
  }, backfillDependencies({
    productHasImages: async ({ productId }) => productId === "product-1",
    fetchDetail: async ({ externalProductId }) => {
      fetched.push(externalProductId);
      if (externalProductId === "external-2") throw new Error("DETAIL_FAILED");
      return detailPayload([]);
    },
    persistImages: async () => {
      persists += 1;
      return 1;
    }
  }));
  assert.deepEqual(fetched, ["external-2"]);
  assert.equal(result.skippedAlreadyFilled, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].code, "DETAIL_FAILED");
  assert.equal(persists, 0);
});

test("produto com mappings duplicados consulta em ordem ate encontrar uma galeria", async () => {
  const fetched: string[] = [];
  let persistedImages: readonly string[] = [];
  const result = await runBlingProductImageBackfill({
    organizationId: "organization-willian",
    connectionId: "connection-j-commerce",
    confirm: true
  }, backfillDependencies({
    countProductsWithoutImages: async () => 1,
    listCandidates: async () => [{
      productId: "product-1",
      mappings: [
        { mappingId: "mapping-1", externalProductId: "external-without-image" },
        { mappingId: "mapping-2", externalProductId: "external-with-image" }
      ]
    }],
    fetchDetail: async ({ externalProductId }) => {
      fetched.push(externalProductId);
      return externalProductId === "external-with-image"
        ? detailPayload([{ link: "https://cdn.example.com/found.jpg" }])
        : detailPayload([]);
    },
    persistImages: async ({ images }) => {
      persistedImages = images;
      return images.length;
    }
  }));
  assert.deepEqual(fetched, ["external-without-image", "external-with-image"]);
  assert.deepEqual(persistedImages, ["https://cdn.example.com/found.jpg"]);
  assert.equal(result.detailsRequested, 2);
  assert.equal(result.updated, 1);
});

test("CLI exige organizationId e connectionId e permanece dry-run por padrao", () => {
  assert.throws(() => parseBlingProductImageBackfillArguments([]));
  assert.deepEqual(parseBlingProductImageBackfillArguments([
    "--organization-id=organization-willian",
    "--connection-id=connection-j-commerce",
    "--limit=25",
    "--cursor=mapping-25"
  ]), {
    organizationId: "organization-willian",
    connectionId: "connection-j-commerce",
    limit: 25,
    cursor: "mapping-25",
    confirm: false
  });
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  assert.equal(
    packageJson.scripts["bling:backfill-product-images"],
    "tsx scripts/backfill-bling-product-images.ts"
  );
});
