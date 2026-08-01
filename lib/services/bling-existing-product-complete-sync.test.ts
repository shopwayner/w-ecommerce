import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyMappedBlingProductSync,
  buildImportedProductCreateData,
  collectMappedBlingProductChanges,
  hydrateBlingProductForPersistence,
  normalizeBlingCatalogPage,
  readBlingProductConnectionAttributes,
  readCanonicalBlingStatusFromAttributes,
  type NormalizedBlingProduct
} from "./bling-product-import-service";

const organizationId = "organization-j-commerce";
const connectionId = "connection-j-commerce";
const productId = "product-6711";
const productName = "Abra\u00e7adeira Condulete Eletroduto 1/2 Preto Andaluz";

function summary6711() {
  const page = normalizeBlingCatalogPage({
    data: [{
      id: "external-6711",
      codigo: "6711",
      nome: productName,
      gtin: "7898630334359",
      situacao: "A"
    }],
    total: 1
  });
  assert.equal(page.products.length, 1);
  return page.products[0];
}

async function completeRemote6711() {
  return hydrateBlingProductForPersistence(
    {
      organizationId,
      connectionId,
      product: summary6711()
    },
    {
      fetchDetail: async () => ({
        data: {
          id: "external-6711",
          codigo: "6711",
          nome: productName,
          gtin: "7898630334359",
          gtinEmbalagem: "7891234567895",
          descricaoComplementar: "Abracadeira preta para condulete e eletroduto 1/2.",
          preco: 9.9,
          precoCusto: 4.2,
          unidade: "PC",
          marca: "Andaluz",
          categoria: { id: 88 },
          tributacao: { ncm: "73269090", origem: 0 },
          pesoLiquido: 0.125,
          pesoBruto: 0.15,
          dimensoes: {
            altura: 1.25,
            largura: 2.5,
            profundidade: 3.75,
            unidadeMedida: 1
          },
          condicao: 1,
          formato: "S",
          tipo: "P",
          situacao: "A",
          tipoProducao: "T",
          dataValidade: "2031-06-30",
          freteGratis: false,
          volumes: 0,
          itensPorCaixa: 6,
          midia: {
            imagens: {
              externas: [
                { link: "https://cdn.example.com/6711-a.jpg" },
                { link: "https://cdn.example.com/6711-b.jpg" }
              ]
            }
          }
        }
      }),
      fetchStock: async () => ({
        data: [{
          produto: { id: "external-6711" },
          saldoFisicoTotal: 15,
          saldoVirtualTotal: 15
        }]
      }),
      fetchCategory: async () => ({
        data: { id: 88, descricao: "Conduletes e acessorios" }
      }),
      fetchStoreLinks: async () => []
    }
  );
}

type FixtureState = ReturnType<typeof createFixtureState>;

function createFixtureState() {
  const state = {
    product: {
      id: productId,
      organizationId,
      sku: "6711",
      ean: "7898630334359",
      packagingGtin: null as string | null,
      name: productName,
      description: null as string | null,
      category: null as string | null,
      brand: "Andaluz",
      ncm: null as string | null,
      weight: null as number | null,
      grossWeight: null as number | null,
      height: null as number | null,
      width: null as number | null,
      depth: null as number | null,
      dimensionUnit: null as string | null,
      condition: null as string | null,
      format: null as string | null,
      productType: null as string | null,
      commercialStatus: null as string | null,
      productionType: null as string | null,
      expirationDate: null as Date | null,
      freeShipping: null as boolean | null,
      volumes: null as number | null,
      itemsPerBox: null as number | null,
      source: "BLING",
      attributes: null as Record<string, unknown> | null
    },
    price: null as null | { id: string; salePrice: number; costPrice: number; createdAt: Date },
    inventory: null as null | { id: string; physicalQuantity: number },
    images: [] as Array<{ url: string; position: number }>,
    productUpdates: 0,
    priceCreates: 0,
    priceUpdates: 0,
    inventoryCreates: 0,
    inventoryUpdates: 0,
    imageCreateCalls: 0
  };

  const transaction = {
    product: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => (
        where.id === productId && where.organizationId === organizationId
          ? { ...state.product }
          : null
      ),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.productUpdates += 1;
        Object.assign(state.product, data);
        return { id: productId };
      },
      create: async () => assert.fail("SYNC nao pode criar Product")
    },
    productExternalMapping: {
      create: async () => assert.fail("SYNC nao pode criar mapping")
    },
    productPrice: {
      findFirst: async () => state.price,
      create: async ({ data }: {
        data: { salePrice: number; costPrice: number };
      }) => {
        state.priceCreates += 1;
        state.price = {
          id: "price-6711",
          salePrice: Number(data.salePrice),
          costPrice: Number(data.costPrice),
          createdAt: new Date("2026-07-30T12:00:00.000Z")
        };
        return state.price;
      },
      update: async ({ data }: {
        data: { salePrice: number; costPrice: number };
      }) => {
        state.priceUpdates += 1;
        assert.ok(state.price);
        Object.assign(state.price, {
          salePrice: Number(data.salePrice),
          costPrice: Number(data.costPrice)
        });
        return state.price;
      }
    },
    inventoryBalance: {
      findUnique: async () => state.inventory,
      create: async ({ data }: { data: { physicalQuantity: number } }) => {
        state.inventoryCreates += 1;
        state.inventory = {
          id: "inventory-6711",
          physicalQuantity: data.physicalQuantity
        };
        return state.inventory;
      },
      update: async ({ data }: { data: { physicalQuantity: number } }) => {
        state.inventoryUpdates += 1;
        assert.ok(state.inventory);
        state.inventory.physicalQuantity = data.physicalQuantity;
        return state.inventory;
      }
    },
    productImage: {
      findMany: async () => state.images.map((image) => ({ ...image })),
      createMany: async ({ data }: {
        data: Array<{ url: string; position: number }>;
      }) => {
        state.imageCreateCalls += 1;
        state.images.push(...data.map((image) => ({
          url: image.url,
          position: image.position
        })));
        return { count: data.length };
      }
    }
  };

  return { state, transaction };
}

async function syncCompleteFixture(fixture: FixtureState) {
  const product = await completeRemote6711();
  const changed = await applyMappedBlingProductSync(
    fixture.transaction as never,
    { organizationId, connectionId, productId, product }
  );
  return { changed, product };
}

const mappedFieldCases: Array<{
  label: string;
  value: (product: NormalizedBlingProduct) => unknown;
  expected: unknown;
}> = [
  { label: "unidade persistida", value: (product) => product.unit, expected: "PC" },
  { label: "categoria resolvida", value: (product) => product.category, expected: "Conduletes e acessorios" },
  { label: "situacao persistida", value: (product) => product.commercialStatus, expected: "ACTIVE" },
  { label: "formato persistido", value: (product) => product.format, expected: "SIMPLE" },
  { label: "tipo persistido", value: (product) => product.productType, expected: "PRODUCT" },
  { label: "producao persistida", value: (product) => product.productionType, expected: "THIRD_PARTY" },
  {
    label: "validade persistida",
    value: (product) => product.expirationDate?.toISOString().slice(0, 10),
    expected: "2031-06-30"
  },
  { label: "frete gratis false preservado", value: (product) => product.freeShipping, expected: false },
  { label: "volumes zero preservado", value: (product) => product.volumes, expected: 0 },
  { label: "itens por caixa persistido", value: (product) => product.itemsPerBox, expected: 6 },
  { label: "peso liquido persistido", value: (product) => product.weight, expected: 0.125 },
  { label: "peso bruto persistido", value: (product) => product.grossWeight, expected: 0.15 },
  { label: "altura decimal persistida", value: (product) => product.height, expected: 1.25 },
  { label: "largura decimal persistida", value: (product) => product.width, expected: 2.5 },
  { label: "profundidade decimal persistida", value: (product) => product.depth, expected: 3.75 },
  { label: "condicao persistida quando fornecida", value: (product) => product.condition, expected: "NEW" },
  { label: "GTIN de embalagem persistido", value: (product) => product.packagingGtin, expected: "7891234567895" },
  {
    label: "descricao completa persistida",
    value: (product) => product.description,
    expected: "Abracadeira preta para condulete e eletroduto 1/2."
  }
];

for (const fieldCase of mappedFieldCases) {
  test(`SKU 6711: ${fieldCase.label}`, async () => {
    const product = await completeRemote6711();
    assert.equal(fieldCase.value(product), fieldCase.expected);
  });
}

test("SKU 6711: condicao permanece nula quando o Bling nao fornece o campo", () => {
  const product = normalizeBlingCatalogPage({
    data: [{ id: "external-6711", codigo: "6711", nome: productName }]
  }).products[0];
  assert.equal(product.condition, null);
});

test("SKU 6711: status so fica confirmado depois de resposta Bling valida", async () => {
  const product = await completeRemote6711();
  const confirmed = buildImportedProductCreateData({
    organizationId,
    connectionId,
    product,
    statusCheckedAt: "2026-07-30T12:00:00.000Z"
  });
  assert.equal(
    readCanonicalBlingStatusFromAttributes(confirmed.attributes, connectionId),
    "ACTIVE"
  );

  const unknown = buildImportedProductCreateData({
    organizationId,
    connectionId,
    product: { ...product, status: "UNKNOWN" },
    statusCheckedAt: "2026-07-30T12:00:00.000Z"
  });
  assert.equal(
    readCanonicalBlingStatusFromAttributes(unknown.attributes, connectionId),
    "UNKNOWN"
  );
});

test("SKU 6711: strings vazias nao apagam valores locais validos", async () => {
  const fixture = createFixtureState();
  const { product } = await syncCompleteFixture(fixture);
  const changed = await applyMappedBlingProductSync(
    fixture.transaction as never,
    {
      organizationId,
      connectionId,
      productId,
      product: {
        ...product,
        description: "",
        category: "",
        ncm: ""
      }
    }
  );
  assert.equal(changed, false);
  assert.equal(fixture.state.product.description, "Abracadeira preta para condulete e eletroduto 1/2.");
  assert.equal(fixture.state.product.category, "Conduletes e acessorios");
  assert.equal(fixture.state.product.ncm, "73269090");
});

test("SKU 6711: null nao apaga valores locais validos", async () => {
  const fixture = createFixtureState();
  const { product } = await syncCompleteFixture(fixture);
  const changed = await applyMappedBlingProductSync(
    fixture.transaction as never,
    {
      organizationId,
      connectionId,
      productId,
      product: {
        ...product,
        gtin: null,
        packagingGtin: null,
        description: null,
        price: null,
        costPrice: null,
        stock: null,
        unit: null,
        images: [],
        brand: null,
        category: null,
        categoryId: null,
        ncm: null,
        weight: null,
        grossWeight: null,
        height: null,
        width: null,
        depth: null,
        dimensionUnit: null,
        condition: null,
        format: null,
        productType: null,
        commercialStatus: null,
        productionType: null,
        expirationDate: null,
        freeShipping: null,
        volumes: null,
        itemsPerBox: null,
        origin: null,
        status: "UNKNOWN"
      }
    }
  );
  assert.equal(changed, false);
  assert.equal(fixture.state.product.freeShipping, false);
  assert.equal(fixture.state.product.volumes, 0);
  assert.equal(fixture.state.images.length, 2);
});

test("SKU 6711: segunda sincronizacao e idempotente", async () => {
  const fixture = createFixtureState();
  const first = await syncCompleteFixture(fixture);
  const second = await applyMappedBlingProductSync(
    fixture.transaction as never,
    { organizationId, connectionId, productId, product: first.product }
  );
  assert.equal(first.changed, true);
  assert.equal(second, false);
  assert.equal(fixture.state.productUpdates, 1);
  assert.equal(fixture.state.priceCreates, 1);
  assert.equal(fixture.state.priceUpdates, 0);
  assert.equal(fixture.state.inventoryCreates, 1);
  assert.equal(fixture.state.inventoryUpdates, 0);
  assert.equal(fixture.state.imageCreateCalls, 1);
  assert.equal(fixture.state.images.length, 2);
});

test("SKU 6711: previa classifica somente diferencas reais por categoria", async () => {
  const fixture = createFixtureState();
  const product = await completeRemote6711();
  const preview = await collectMappedBlingProductChanges(
    fixture.transaction as never,
    { organizationId, connectionId, productId, product }
  );
  const categories = new Set(preview.changes.map((change) => change.category));
  for (const category of [
    "STOCK", "PRICE", "IMAGES", "DESCRIPTION", "CATEGORY", "GTIN",
    "WEIGHT", "DIMENSIONS", "STATUS", "ATTRIBUTES"
  ]) {
    assert.equal(categories.has(category as never), true, category);
  }
  assert.equal(fixture.state.productUpdates, 0);
  assert.equal(fixture.state.priceCreates, 0);
  assert.equal(fixture.state.inventoryCreates, 0);
  assert.equal(fixture.state.imageCreateCalls, 0);
});

test("SKU 6711: SYNC completa o mesmo Product sem criar Product ou mapping", async () => {
  const fixture = createFixtureState();
  const result = await syncCompleteFixture(fixture);
  assert.equal(result.changed, true);
  assert.equal(fixture.state.product.id, productId);
  assert.equal(fixture.state.product.packagingGtin, "7891234567895");
  assert.equal(fixture.state.product.freeShipping, false);
  assert.equal(fixture.state.product.volumes, 0);
  assert.equal(fixture.state.price?.salePrice, 9.9);
  assert.equal(fixture.state.price?.costPrice, 4.2);
  assert.equal(fixture.state.inventory?.physicalQuantity, 15);
  assert.deepEqual(fixture.state.images.map((image) => image.url), [
    "https://cdn.example.com/6711-a.jpg",
    "https://cdn.example.com/6711-b.jpg"
  ]);
  const scoped = readBlingProductConnectionAttributes(
    fixture.state.product.attributes,
    connectionId
  );
  assert.equal(scoped.unit, "PC");
  assert.equal(scoped.categoryId, "88");
  assert.equal(
    readCanonicalBlingStatusFromAttributes(
      fixture.state.product.attributes,
      connectionId
    ),
    "ACTIVE"
  );
});

test("SKU 6711: API de detalhes retorna todos os campos sincronizados", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/[id]/route.ts"),
    "utf8"
  );
  for (const field of [
    "unit", "category", "blingStatus", "format", "productType",
    "commercialStatus", "weight", "grossWeight", "height", "width",
    "depth", "condition", "productionType", "expirationDate",
    "freeShipping", "volumes", "itemsPerBox", "dimensionUnit",
    "packagingGtin"
  ]) {
    assert.match(source, new RegExp(`\\b${field}:`), field);
  }
  assert.match(source, /readBlingProductConnectionAttributes\(/);
  assert.match(source, /readCanonicalBlingStatusFromAttributes\(/);
});

test("SKU 6711: frontend mostra valores existentes em vez de Nao informado", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/product-details-view.tsx"),
    "utf8"
  );
  assert.match(
    source,
    /if \(value === null \|\| value === undefined\) return emptyLabel;[\s\S]+String\(value\)\.trim\(\)/
  );
  assert.match(source, /unit: currentProduct\.unit/);
  assert.match(source, /category: currentProduct\.category/);
  assert.match(source, /blingStatus: getBlingStatusLabel\(currentProduct\.blingStatus\)/);
});

test("SKU 6711: frontend diferencia false, zero e null", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/product-details-view.tsx"),
    "utf8"
  );
  assert.match(
    source,
    /currentProduct\.freeShipping === null \|\| currentProduct\.freeShipping === undefined[\s\S]+\\? "Sim"[\s\S]+: "Nao"/
  );
  assert.match(source, /volumes: currentProduct\.volumes/);
  assert.match(source, /if \(value === null \|\| value === undefined\) return emptyLabel/);
});
