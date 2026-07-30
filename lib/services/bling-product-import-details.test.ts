import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildImportedProductCreateData,
  hydrateNewBlingProductFromDetail,
  normalizeBlingCatalogPage,
  processBlingImportItemsIndependently,
  resolveImportedGtin
} from "./bling-product-import-service";

function summaryProduct() {
  const page = normalizeBlingCatalogPage({
    data: [{
      id: "external-product-1",
      codigo: "10321",
      nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
      unidade: "UN",
      formato: "S",
      situacao: "A"
    }],
    total: 1
  });
  assert.equal(page.products.length, 1);
  return page.products[0];
}

test("list without GTIN plus detail with GTIN supplies Product.ean", async () => {
  const product = await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-a",
      connectionId: "connection-a",
      product: summaryProduct()
    },
    async () => ({
      data: {
        id: "external-product-1",
        codigo: "10321",
        nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
        gtin: "7908073723457",
        unidade: "UN",
        formato: "S",
        situacao: "A"
      }
    })
  );

  assert.equal(product.gtin, "7908073723457");
  assert.equal(resolveImportedGtin(product.gtin), "7908073723457");
});

test("detail keeps gtinEmbalagem separate from the primary GTIN", async () => {
  const product = await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-a",
      connectionId: "connection-a",
      product: summaryProduct()
    },
    async () => ({
      data: {
        id: "external-product-1",
        codigo: "10321",
        nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
        gtin: "7908073723457",
        gtinEmbalagem: "7891234567895"
      }
    })
  );

  assert.equal(resolveImportedGtin(product.gtin), "7908073723457");
  assert.equal(resolveImportedGtin(product.packagingGtin), "7891234567895");
});

test("detail completo mapeia os campos comerciais e a galeria da carga inicial", async () => {
  const product = await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-a",
      connectionId: "connection-a",
      product: summaryProduct()
    },
    async () => ({
      data: {
        id: "external-product-1",
        codigo: "10321",
        nome: "Capacete Race Tech",
        gtin: "7908073723457",
        gtinEmbalagem: "7891234567895",
        descricaoCurta: "Capacete fechado",
        descricaoComplementar: "Descricao completa do produto.",
        preco: 123.45,
        precoCusto: 80.25,
        unidade: "UN",
        marca: "Race Tech",
        categoria: { descricao: "Capacetes" },
        tributacao: { ncm: "65061000", origem: "0" },
        pesoLiquido: 1.25,
        pesoBruto: 1.5,
        dimensoes: {
          altura: 12.3,
          largura: 4.5,
          profundidade: 6.7,
          unidadeMedida: 1
        },
        condicao: 1,
        formato: "S",
        tipo: "P",
        situacao: "I",
        tipoProducao: "P",
        dataValidade: "2030-12-31",
        freteGratis: false,
        volumes: 0,
        itensPorCaixa: 0,
        midia: {
          imagemURL: "https://cdn.example.com/a.jpg",
          imagens: {
            externas: [
              { link: "https://cdn.example.com/a.jpg" },
              { link: "https://cdn.example.com/b.jpg" }
            ],
            internas: []
          }
        }
      }
    })
  );

  assert.deepEqual(product.images, [
    "https://cdn.example.com/a.jpg",
    "https://cdn.example.com/b.jpg"
  ]);
  assert.equal(product.description, "Descricao completa do produto.");
  assert.equal(product.shortDescription, "Capacete fechado");
  assert.equal(product.weight, 1.25);
  assert.equal(product.grossWeight, 1.5);
  assert.equal(product.height, 12.3);
  assert.equal(product.width, 4.5);
  assert.equal(product.depth, 6.7);
  assert.equal(product.freeShipping, false);
  assert.equal(product.volumes, 0);
  assert.equal(product.itemsPerBox, 0);
  assert.equal(product.unit, "UN");
  assert.equal(product.category, "Capacetes");
  assert.equal(product.brand, "Race Tech");
  assert.equal(product.ncm, "65061000");
  assert.equal(product.condition, "NEW");
  assert.equal(product.format, "SIMPLE");
  assert.equal(product.productType, "PRODUCT");
  assert.equal(product.commercialStatus, "INACTIVE");
  assert.equal(product.productionType, "OWN");
  assert.equal(
    product.expirationDate?.toISOString().slice(0, 10),
    "2030-12-31"
  );
  assert.equal(product.origin, "0");

  const data = buildImportedProductCreateData({
    organizationId: "organization-a",
    connectionId: "connection-a",
    product,
    statusCheckedAt: "2026-07-30T12:00:00.000Z"
  });
  assert.equal(data.organizationId, "organization-a");
  assert.equal(data.name, "Capacete Race Tech");
  assert.equal(data.sku, "10321");
  assert.equal(data.ean, "7908073723457");
  assert.equal(data.packagingGtin, "7891234567895");
  assert.equal(data.description, "Descricao completa do produto.");
  assert.equal(data.weight, 1.25);
  assert.equal(data.grossWeight, 1.5);
  assert.equal(data.height, 12.3);
  assert.equal(data.width, 4.5);
  assert.equal(data.depth, 6.7);
  assert.equal(data.freeShipping, false);
  assert.equal(data.volumes, 0);
  assert.equal(data.itemsPerBox, 0);
  assert.equal(data.category, "Capacetes");
  assert.equal(data.brand, "Race Tech");
  assert.equal(data.ncm, "65061000");
  assert.equal(data.condition, "NEW");
  assert.equal(data.format, "SIMPLE");
  assert.equal(data.productType, "PRODUCT");
  assert.equal(data.commercialStatus, "INACTIVE");
  assert.equal(data.productionType, "OWN");
  assert.equal(
    (data.expirationDate as Date | null)?.toISOString().slice(0, 10),
    "2030-12-31"
  );
  const attributes = data.attributes as {
    bling?: {
      unit?: string;
      origin?: string;
      shortDescription?: string;
    };
  };
  assert.deepEqual(
    {
      unit: attributes.bling?.unit,
      origin: attributes.bling?.origin,
      shortDescription: attributes.bling?.shortDescription
    },
    {
      unit: "UN",
      origin: "0",
      shortDescription: "Capacete fechado"
    }
  );
});

test("summary without GTIN preserves an existing local EAN", () => {
  assert.equal(resolveImportedGtin(null, "7908073723457"), "7908073723457");
  assert.equal(resolveImportedGtin("", "7908073723457"), "7908073723457");
});

test("new product detail uses the organization and second connection provided", async () => {
  const requests: unknown[] = [];
  await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-b",
      connectionId: "connection-b",
      product: summaryProduct()
    },
    async (request) => {
      requests.push(request);
      return {
        data: {
          id: "external-product-1",
          codigo: "10321",
          nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
          gtin: "7908073723457"
        }
      };
    }
  );

  assert.deepEqual(requests, [{
    organizationId: "organization-b",
    connectionId: "connection-b",
    externalProductId: "external-product-1"
  }]);
});

test("invalid remote GTIN is not persisted", () => {
  assert.equal(resolveImportedGtin("7891234567890"), null);
  assert.equal(
    resolveImportedGtin("7891234567890", "7908073723457"),
    "7908073723457"
  );
});

test("detail failure marks only that item and processing continues", async () => {
  const processed: string[] = [];
  const failed: string[] = [];
  const state = await processBlingImportItemsIndependently({
    items: ["bad-detail", "next-product"],
    initialState: 0,
    processItem: async (item, current) => {
      if (item === "bad-detail") throw new Error("DETAIL_FAILED");
      processed.push(item);
      return current + 1;
    },
    recordFailure: async (item, current) => {
      failed.push(item);
      return current + 1;
    }
  });

  assert.equal(state, 2);
  assert.deepEqual(failed, ["bad-detail"]);
  assert.deepEqual(processed, ["next-product"]);
});

test("runtime busca detalhe para CREATE e SYNC e persiste mapping e imagens no tenant", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );

  assert.match(
    source,
    /preliminaryMatch\.kind === "CREATE"[\s\S]+hydrateBlingProductForPersistence/
  );
  assert.match(
    source,
    /operation === "SYNC" && input\.preliminaryMatch\.kind === "MAPPING"/
  );
  assert.match(source, /classifyBlingProductsForConnection\(\{[\s\S]+matches: matching\.matches/);
  assert.match(source, /path: `\/produtos\/\$\{encodeURIComponent\(request\.externalProductId\)\}`/);
  assert.match(source, /path: "\/estoques\/saldos"/);
  assert.match(source, /path: "\/produtos\/lojas"/);
  assert.match(source, /path: `\/categorias\/produtos\/\$\{encodeURIComponent\(input\.categoryId\)\}`/);
  assert.match(source, /buildImportedProductCreateData\(\{/);
  assert.match(source, /productExternalMapping\.create\(\{[\s\S]+organizationId: input\.organizationId[\s\S]+connectionId: input\.connectionId/);
  assert.match(source, /productImage\.createMany\(\{/);
  assert.match(source, /productPrice\.create\(\{/);
  assert.match(source, /inventoryBalance\.create\(\{/);
  assert.match(source, /input\.product\.weight !== null/);
  assert.match(source, /input\.product\.height !== null/);
  assert.match(source, /rawData: \{[\s\S]+packagingGtin: product\.packagingGtin/);
});
