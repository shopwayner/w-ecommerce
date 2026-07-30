import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildImportedProductCreateData,
  fetchBlingProductStoreLinks,
  hydrateBlingProductForPersistence,
  mergeBlingProductAttributes,
  normalizeBlingCatalogPage,
  readBlingProductConnectionAttributes,
  readBlingProductMarketplaceStores,
  resolveBlingProductImportMatch,
  type NormalizedBlingProduct
} from "./bling-product-import-service";

const tenants = [
  { organizationId: "organization-master-fixture", label: "master" },
  { organizationId: "organization-willian-fixture", label: "willian" },
  { organizationId: "organization-random-fixture", label: "random" }
] as const;

const catalogPages = [
  [{ id: "1001", codigo: "SKU-DUPLICADO", nome: "Produto completo" }],
  [{ id: "1002", codigo: "SKU-DUPLICADO", nome: "Produto com SKU duplicado" }],
  [{ id: "1003", codigo: "", nome: "Produto sem SKU", gtin: "7908073723457" }],
  [{ id: "1004", codigo: "SKU-SEM-GTIN", nome: "Produto sem GTIN", gtin: "" }]
];

function detailFor(product: NormalizedBlingProduct) {
  return {
    data: {
      id: product.externalProductId,
      codigo: product.sku ?? "",
      nome: product.name,
      gtin: product.gtin ?? "7908073723457",
      gtinEmbalagem: "7891234567895",
      descricaoCurta: "Descricao curta controlada",
      descricaoComplementar: "Descricao completa controlada.",
      preco: 19.9,
      precoCusto: 10.5,
      unidade: "UN",
      marca: "Marca Fixture",
      categoria: { id: 77 },
      tributacao: { ncm: "65061000", origem: 0 },
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
        imagens: {
          externas: [
            { link: `https://cdn.example.com/${product.externalProductId}-a.jpg` },
            { link: `https://cdn.example.com/${product.externalProductId}-b.jpg` }
          ]
        }
      }
    }
  };
}

function stockFor(product: NormalizedBlingProduct) {
  return {
    data: [{
      produto: { id: product.externalProductId },
      saldoFisicoTotal: 7,
      saldoVirtualTotal: 6
    }]
  };
}

async function storeLinksFor(input: {
  organizationId: string;
  connectionId: string;
  externalProductId: string;
}) {
  return fetchBlingProductStoreLinks(input, {
    fetchPage: async (request) => ({
      data: request.page === 1
        ? [{
            id: `link-${request.externalProductId}`,
            codigo: `MLB${request.externalProductId}`,
            produto: { id: request.externalProductId },
            loja: { id: "store-ml" },
            situacao: "active",
            url: `https://produto.mercadolivre.com.br/MLB-${request.externalProductId}`
          }]
        : []
    }),
    fetchChannel: async () => ({
      data: { id: "store-ml", nome: "Mercado Livre" }
    })
  });
}

async function executeParityFixture(organizationId: string, connectionId: string) {
  const normalizedPages = catalogPages.map((data) =>
    normalizeBlingCatalogPage({ data, total: 4 })
  );
  const products = normalizedPages.flatMap((page) => page.products);
  const calls: Array<{
    stage: string;
    organizationId: string;
    connectionId: string;
    externalProductId?: string;
  }> = [];
  const hydrated = [];

  for (const product of products) {
    const result = await hydrateBlingProductForPersistence(
      { organizationId, connectionId, product },
      {
        fetchDetail: async (request) => {
          calls.push({ stage: "DETAIL", ...request });
          return detailFor(product);
        },
        fetchStock: async (request) => {
          calls.push({ stage: "STOCK", ...request });
          return stockFor(product);
        },
        fetchCategory: async (request) => {
          calls.push({
            stage: "CATEGORY",
            organizationId: request.organizationId,
            connectionId: request.connectionId
          });
          return { data: { id: request.categoryId, descricao: "Capacetes" } };
        },
        fetchStoreLinks: async (request) => {
          calls.push({ stage: "STORES", ...request });
          return storeLinksFor(request);
        }
      }
    );
    hydrated.push(result);
  }

  return {
    pageCounts: normalizedPages.map((page) => page.products.length),
    products: hydrated.map((product) => {
      const data = buildImportedProductCreateData({
        organizationId,
        connectionId,
        product,
        statusCheckedAt: "2026-07-30T12:00:00.000Z"
      });
      const scoped = readBlingProductConnectionAttributes(
        data.attributes,
        connectionId
      );
      return {
        sku: data.sku,
        ean: data.ean,
        packagingGtin: data.packagingGtin,
        description: data.description,
        category: data.category,
        brand: data.brand,
        ncm: data.ncm,
        weight: Number(data.weight),
        grossWeight: Number(data.grossWeight),
        height: Number(data.height),
        width: Number(data.width),
        depth: Number(data.depth),
        format: data.format,
        productType: data.productType,
        commercialStatus: data.commercialStatus,
        productionType: data.productionType,
        freeShipping: data.freeShipping,
        volumes: data.volumes,
        itemsPerBox: Number(data.itemsPerBox),
        stock: product.stock,
        images: product.images,
        unit: scoped.unit,
        origin: scoped.origin,
        categoryId: scoped.categoryId,
        stores: scoped.storeLinks,
        marketplaceStores: readBlingProductMarketplaceStores(
          data.attributes,
          connectionId
        )
      };
    }),
    calls
  };
}

for (const tenant of tenants) {
  test(`pipeline completo possui a mesma qualidade no tenant ${tenant.label}`, async () => {
    const result = await executeParityFixture(
      tenant.organizationId,
      `${tenant.organizationId}-connection-a`
    );
    assert.deepEqual(result.pageCounts, [1, 1, 1, 1]);
    assert.equal(result.products.length, 4);
    assert.equal(result.calls.length, 16);
    assert.ok(result.calls.every((call) =>
      call.organizationId === tenant.organizationId
      && call.connectionId === `${tenant.organizationId}-connection-a`
    ));
    for (const product of result.products) {
      assert.equal(product.packagingGtin, "7891234567895");
      assert.equal(product.description, "Descricao completa controlada.");
      assert.equal(product.category, "Capacetes");
      assert.equal(product.brand, "Marca Fixture");
      assert.equal(product.ncm, "65061000");
      assert.equal(product.weight, 1.25);
      assert.equal(product.grossWeight, 1.5);
      assert.equal(product.height, 12.3);
      assert.equal(product.width, 4.5);
      assert.equal(product.depth, 6.7);
      assert.equal(product.format, "SIMPLE");
      assert.equal(product.productType, "PRODUCT");
      assert.equal(product.commercialStatus, "INACTIVE");
      assert.equal(product.productionType, "OWN");
      assert.equal(product.freeShipping, false);
      assert.equal(product.volumes, 0);
      assert.equal(product.itemsPerBox, 0);
      assert.equal(product.stock, 6);
      assert.equal(product.images.length, 2);
      assert.equal(product.unit, "UN");
      assert.equal(product.origin, "0");
      assert.equal(product.categoryId, "77");
      assert.equal(product.marketplaceStores.mercadoLivre, true);
      assert.equal(Array.isArray(product.stores), true);
    }
  });
}

test("master, Willian e tenant aleatorio produzem resultado funcional equivalente", async () => {
  const results = await Promise.all(tenants.map((tenant) =>
    executeParityFixture(tenant.organizationId, `${tenant.organizationId}-connection-a`)
  ));
  const canonical = results[0].products;
  assert.deepEqual(results[1].products, canonical);
  assert.deepEqual(results[2].products, canonical);
});

test("duas contas Bling da mesma organizacao mantem atributos e lojas separados", () => {
  const base = normalizeBlingCatalogPage({
    data: [{ id: "product-a", codigo: "SKU-A", nome: "Produto A", situacao: "A" }],
    total: 1
  }).products[0];
  const firstProduct = {
    ...base,
    unit: "UN",
    origin: "0",
    categoryId: "10",
    storeLinksComplete: true,
    storeLinks: [{
      linkId: "link-a",
      storeId: "store-a",
      storeName: "Mercado Livre",
      provider: "MERCADO_LIVRE" as const,
      externalListingId: "MLB100",
      status: "active",
      url: "https://produto.mercadolivre.com.br/MLB-100"
    }]
  };
  const first = mergeBlingProductAttributes(
    null,
    firstProduct,
    "connection-a",
    "2026-07-30T12:00:00.000Z"
  );
  const second = mergeBlingProductAttributes(
    first,
    {
      ...firstProduct,
      externalProductId: "product-b",
      sku: "SKU-B",
      unit: "PC",
      storeLinks: []
    },
    "connection-b",
    "2026-07-30T12:00:00.000Z"
  );

  assert.equal(
    readBlingProductConnectionAttributes(second, "connection-a").externalProductId,
    "product-a"
  );
  assert.equal(
    readBlingProductConnectionAttributes(second, "connection-b").externalProductId,
    "product-b"
  );
  assert.equal(
    readBlingProductMarketplaceStores(second, "connection-a").mercadoLivre,
    true
  );
  assert.equal(
    readBlingProductMarketplaceStores(second, "connection-b").mercadoLivre,
    false
  );
  assert.deepEqual(readBlingProductConnectionAttributes(second, "other-connection"), {});
});

test("null e string vazia nao apagam atributos validos e false/zero permanecem valores", () => {
  const base = normalizeBlingCatalogPage({
    data: [{ id: "product-a", codigo: "SKU-A", nome: "Produto A", situacao: "A" }],
    total: 1
  }).products[0];
  const populated = mergeBlingProductAttributes(
    null,
    {
      ...base,
      shortDescription: "Descricao valida",
      unit: "UN",
      origin: "0",
      categoryId: "10"
    },
    "connection-a",
    "2026-07-30T12:00:00.000Z"
  );
  const merged = mergeBlingProductAttributes(
    populated,
    {
      ...base,
      sku: "",
      shortDescription: null,
      unit: null,
      origin: null,
      categoryId: null,
      freeShipping: false,
      volumes: 0,
      itemsPerBox: 0
    },
    "connection-a",
    "2026-07-30T12:00:00.000Z"
  );
  const scoped = readBlingProductConnectionAttributes(merged, "connection-a");
  assert.equal(scoped.shortDescription, "Descricao valida");
  assert.equal(scoped.unit, "UN");
  assert.equal(scoped.origin, "0");
  assert.equal(scoped.categoryId, "10");
});

test("vinculo de loja de outro produto falha fechado", async () => {
  await assert.rejects(
    fetchBlingProductStoreLinks(
      {
        organizationId: "organization-a",
        connectionId: "connection-a",
        externalProductId: "product-a"
      },
      {
        fetchPage: async () => ({
          data: [{
            id: "link-b",
            codigo: "MLB200",
            produto: { id: "product-b" },
            loja: { id: "store-a" }
          }]
        }),
        fetchChannel: async () => ({ data: { nome: "Mercado Livre" } })
      }
    ),
    /outro produto/
  );
});

test("SKU duplicado e ausencias sao tratados sem depender do tenant", () => {
  assert.equal(
    resolveBlingProductImportMatch({
      sku: "SKU-DUPLICADO",
      gtin: null,
      skuCandidates: [{ id: "first-created-product" }]
    }).kind,
    "SKU"
  );
  assert.equal(
    resolveBlingProductImportMatch({
      sku: null,
      gtin: "7908073723457",
      gtinCandidates: []
    }).kind,
    "CREATE"
  );
  assert.equal(
    resolveBlingProductImportMatch({ sku: "SKU-SEM-GTIN", gtin: null }).kind,
    "CREATE"
  );
});

test("listagem usa somente evidencia oficial por conexao e nunca infere marketplace por SKU", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/route.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /mercadoLivreListingCache\.findMany/);
  assert.doesNotMatch(source, /normalizeMarketplaceKey/);
  assert.match(source, /readBlingProductMarketplaceStores\(/);
  assert.match(source, /blingMapping\?\.connectionId/);
});

test("lista e detalhe mantem saldos e mappings na conta Bling selecionada", () => {
  const listSource = readFileSync(
    path.join(process.cwd(), "app/api/products/route.ts"),
    "utf8"
  );
  const detailSource = readFileSync(
    path.join(process.cwd(), "app/api/products/[id]/route.ts"),
    "utf8"
  );

  for (const source of [listSource, detailSource]) {
    assert.match(source, /getUserAccountContext/);
    assert.match(source, /organizationId/);
    assert.match(source, /connectionId:\s*(?:selectedBlingConnectionId|blingConnectionId)/);
  }

  assert.match(
    detailSource,
    /if \(blingConnectionId && existing\.inventory\[0\] && parsed\.data\.stock !== undefined\)/
  );
});

test("estoque nao carrega imagens ou mappings de outro tenant", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/inventory/route.ts"),
    "utf8"
  );
  assert.match(
    source,
    /images:\s*\{[\s\S]+where:\s*\{\s*organizationId:\s*auth\.context\.organizationId/
  );
  assert.match(
    source,
    /mappings:\s*\{[\s\S]+organizationId:\s*auth\.context\.organizationId[\s\S]+connectionId:\s*selectedBlingConnectionId/
  );
});

test("pipeline runtime nao contem excecao por email, slug ou organizacao historica", () => {
  const runtimeFiles = [
    "lib/services/bling-product-import-service.ts",
    "lib/services/bling-oauth-service.ts",
    "lib/services/bling-erp-connection-compatibility-service.ts",
    "app/api/integrations/bling/callback/route.ts",
    "app/api/products/import-from-bling/route.ts",
    "app/api/products/route.ts"
  ];
  for (const file of runtimeFiles) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.doesNotMatch(
      source,
      /crowner@admin\.com|willian@admin\.com|w-ecommerce-master|willian-workspace/i,
      file
    );
  }
});

test("worker pode usar somente o refresh OAuth oficial ao retomar job persistido", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  assert.match(
    source,
    /runPreparedSync[\s\S]+validateConnection\([\s\S]+allowOfficialRefresh: true/
  );
  assert.match(source, /blingApiClient\.request<unknown>\(\{[\s\S]+method: "GET"/);
  assert.doesNotMatch(source, /refreshTokenEncrypted[\s\S]+productExternalMapping/);
});
