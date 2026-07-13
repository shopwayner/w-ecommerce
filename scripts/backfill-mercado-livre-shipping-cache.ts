import { loadEnvConfig } from "@next/env";
import { pathToFileURL } from "node:url";
import {
  buildPersistedSellerShippingCost,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_TTL_MS,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
  readCompatiblePersistedSellerShippingCost,
  type MercadoLivreSellerShippingCostQuery
} from "../lib/services/marketplaces/mercado-livre-shipping-cost";
import type { MercadoLivreShippingCacheBackfillQuote } from "../lib/services/marketplaces/mercado-livre-client-listings-service";

const eligibleStatuses = ["active", "paused", "under_review"];
const defaultBatchSize = 24;
const defaultBatchDelayMs = 300;

export class SafeShippingCacheBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeShippingCacheBackfillError";
  }
}

export type BackfillCacheRow = {
  id: string;
  organizationId: string;
  externalItemId: string | null;
  status: string | null;
  price: number | null;
  currencyId: string | null;
  rawAttributesJson: unknown;
};

type BackfillOrganization = {
  id: string;
  status: string;
};

type BackfillConnection = {
  id: string;
  status: string;
  sellerId: string | null;
  externalAccountId: string | null;
};

type PersistedSellerShippingCost = ReturnType<typeof buildPersistedSellerShippingCost>;

export type ShippingCacheBackfillDependencies = {
  now: () => Date;
  findOrganization: (slug: string) => Promise<BackfillOrganization | null>;
  findMercadoLivreConnection: (organizationId: string) => Promise<BackfillConnection | null>;
  listCacheRows: (organizationId: string) => Promise<BackfillCacheRow[]>;
  fetchQuotes: (input: {
    organizationId: string;
    itemIds: string[];
  }) => Promise<{ connectionId: string; sellerId: string; quotes: MercadoLivreShippingCacheBackfillQuote[] }>;
  updateSellerShippingCost: (input: {
    rowId: string;
    organizationId: string;
    externalItemId: string;
    sellerShippingCost: PersistedSellerShippingCost;
  }) => Promise<boolean>;
  wait: (milliseconds: number) => Promise<void>;
};

export type ShippingCacheBackfillSummary = {
  total: number;
  validV2: number;
  missing: number;
  invalid: number;
  stale: number;
  eligible: number;
  ignored: number;
  predictedQueries: number;
  predictedWrites: number;
  confirmed: boolean;
  processed: number;
  written: number;
  failed: number;
  rateLimitResponses: number;
  confirmedZero: number;
  preserved: number;
  durationMs: number;
  failedItemIds: string[];
};

type CacheClassification = "valid" | "missing" | "invalid" | "stale" | "ignored";

type ClassifiedCacheRow = {
  row: BackfillCacheRow;
  classification: CacheClassification;
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validExternalItemId(value: string | null) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^ML[A-Z]\d+$/.test(normalized) ? normalized : null;
}

function persistedQuery(input: {
  organizationId: string;
  connectionId: string;
  sellerId: string;
  externalItemId: string;
  currencyId: string | null;
  itemPrice: number | null;
  listingTypeId: string | null;
  value: unknown;
}): MercadoLivreSellerShippingCostQuery | null {
  const persisted = record(input.value);
  const context = record(persisted?.context);
  if (!context) return null;

  return {
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    sellerId: input.sellerId,
    itemId: input.externalItemId,
    currencyId: input.currencyId,
    freeShipping: typeof context.freeShipping === "boolean" ? context.freeShipping : false,
    itemPrice: input.itemPrice,
    listingTypeId: input.listingTypeId,
    mode: nullableString(context.mode),
    logisticType: nullableString(context.logisticType)
  };
}

export function classifyShippingCacheRow(input: {
  row: BackfillCacheRow;
  organizationId: string;
  connectionId: string;
  sellerId: string;
  now: Date;
}): CacheClassification {
  const externalItemId = validExternalItemId(input.row.externalItemId);
  if (!externalItemId || input.row.organizationId !== input.organizationId) return "ignored";

  const rawAttributes = record(input.row.rawAttributesJson);
  const sellerShippingCost = rawAttributes?.sellerShippingCost;
  if (sellerShippingCost === undefined) return "missing";
  const sellerShippingContext = record(record(sellerShippingCost)?.context);

  const query = persistedQuery({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    sellerId: input.sellerId,
    externalItemId,
    currencyId: input.row.currencyId ?? nullableString(sellerShippingContext?.currencyId),
    itemPrice: input.row.price ?? nullableNumber(sellerShippingContext?.itemPrice),
    listingTypeId:
      nullableString(rawAttributes?.listingTypeId) ?? nullableString(sellerShippingContext?.listingTypeId),
    value: sellerShippingCost
  });
  if (!query) return "invalid";

  const persisted = readCompatiblePersistedSellerShippingCost(sellerShippingCost, query);
  if (!persisted) return "invalid";

  const ageMs = input.now.getTime() - Date.parse(persisted.lastUpdatedAt);
  if (ageMs < 0) return "invalid";
  if (persisted.stale || ageMs > MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_TTL_MS) return "stale";
  return "valid";
}

export function mergeSellerShippingCost(rawAttributesJson: unknown, sellerShippingCost: PersistedSellerShippingCost) {
  if (rawAttributesJson === null || rawAttributesJson === undefined) return { sellerShippingCost };
  const current = record(rawAttributesJson);
  if (!current) throw new SafeShippingCacheBackfillError("Cache local com formato invalido; linha preservada sem alteracao.");
  return { ...current, sellerShippingCost };
}

export function parseShippingCacheBackfillArguments(argumentsList: string[]) {
  const confirm = argumentsList.includes("--confirm");
  const slugArgument = argumentsList.find((argument) => argument.startsWith("--organization-slug="));
  const unknownArguments = argumentsList.filter(
    (argument) => argument !== "--confirm" && !argument.startsWith("--organization-slug=")
  );
  if (unknownArguments.length) {
    throw new SafeShippingCacheBackfillError("Argumento nao reconhecido. Use apenas --organization-slug e --confirm.");
  }

  const organizationSlug = slugArgument?.slice("--organization-slug=".length).trim();
  if (!organizationSlug || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(organizationSlug)) {
    throw new SafeShippingCacheBackfillError("Informe uma organizacao valida com --organization-slug=<slug>.");
  }
  return { organizationSlug, confirm };
}

function quoteIsPersistable(input: {
  quote: MercadoLivreShippingCacheBackfillQuote | undefined;
  organizationId: string;
  connectionId: string;
  sellerId: string;
  externalItemId: string;
}) {
  const quote = input.quote;
  const shippingCost = quote?.shippingCost;
  const query = quote?.query;
  if (!quote || !shippingCost || !query) return false;
  if (quote.externalItemId !== input.externalItemId || query.itemId !== input.externalItemId) return false;
  if (
    query.organizationId !== input.organizationId ||
    query.connectionId !== input.connectionId ||
    query.sellerId !== input.sellerId
  ) {
    return false;
  }
  return (
    typeof shippingCost.costAmount === "number" &&
    Number.isFinite(shippingCost.costAmount) &&
    shippingCost.costAmount >= 0 &&
    shippingCost.source === MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE &&
    typeof shippingCost.fetchedAt === "string" &&
    !Number.isNaN(Date.parse(shippingCost.fetchedAt)) &&
    shippingCost.stale === false
  );
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function runShippingCacheBackfill(
  input: { organizationSlug: string; confirm: boolean; batchSize?: number; batchDelayMs?: number },
  dependencies: ShippingCacheBackfillDependencies
): Promise<ShippingCacheBackfillSummary> {
  const startedAt = Date.now();
  const organization = await dependencies.findOrganization(input.organizationSlug);
  if (!organization || organization.status !== "ACTIVE") {
    throw new SafeShippingCacheBackfillError("Organizacao ativa nao encontrada para o slug informado.");
  }

  const connection = await dependencies.findMercadoLivreConnection(organization.id);
  if (!connection || connection.status !== "ACTIVE") {
    throw new SafeShippingCacheBackfillError("A organizacao nao possui conexao Mercado Livre ativa.");
  }
  const sellerId = connection.sellerId?.trim() || connection.externalAccountId?.trim() || null;
  if (!sellerId) throw new SafeShippingCacheBackfillError("A conexao Mercado Livre ativa nao possui seller identificado.");

  const now = dependencies.now();
  const rows = await dependencies.listCacheRows(organization.id);
  const classified: ClassifiedCacheRow[] = rows.map((row) => ({
    row,
    classification: classifyShippingCacheRow({
      row,
      organizationId: organization.id,
      connectionId: connection.id,
      sellerId,
      now
    })
  }));
  const count = (classification: CacheClassification) =>
    classified.filter((entry) => entry.classification === classification).length;
  const eligibleRows = classified
    .filter((entry) => ["missing", "invalid", "stale"].includes(entry.classification))
    .map((entry) => entry.row);

  const summary: ShippingCacheBackfillSummary = {
    total: rows.length,
    validV2: count("valid"),
    missing: count("missing"),
    invalid: count("invalid"),
    stale: count("stale"),
    eligible: eligibleRows.length,
    ignored: count("ignored"),
    predictedQueries: eligibleRows.length,
    predictedWrites: eligibleRows.length,
    confirmed: input.confirm,
    processed: 0,
    written: 0,
    failed: 0,
    rateLimitResponses: 0,
    confirmedZero: 0,
    preserved: 0,
    durationMs: 0,
    failedItemIds: []
  };
  if (!input.confirm || !eligibleRows.length) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const batchSize = Math.max(1, Math.min(input.batchSize ?? defaultBatchSize, 60));
  const batchDelayMs = Math.max(0, input.batchDelayMs ?? defaultBatchDelayMs);
  const batches = chunks(eligibleRows, batchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const itemIds = batch.map((row) => validExternalItemId(row.externalItemId)).filter((itemId): itemId is string => Boolean(itemId));
    let quoteResult: Awaited<ReturnType<ShippingCacheBackfillDependencies["fetchQuotes"]>>;
    try {
      quoteResult = await dependencies.fetchQuotes({ organizationId: organization.id, itemIds });
    } catch {
      summary.processed += itemIds.length;
      summary.failed += itemIds.length;
      summary.preserved += itemIds.length;
      summary.failedItemIds.push(...itemIds);
      if (batchIndex < batches.length - 1 && batchDelayMs) await dependencies.wait(batchDelayMs);
      continue;
    }
    summary.processed += itemIds.length;
    summary.rateLimitResponses += quoteResult.quotes.reduce(
      (total, quote) => total + (quote.shippingCost?.rateLimitResponses ?? 0),
      0
    );

    if (quoteResult.connectionId !== connection.id || quoteResult.sellerId !== sellerId) {
      throw new SafeShippingCacheBackfillError("A identidade da conexao mudou durante a execucao; operacao interrompida.");
    }
    const quotesByItemId = new Map(quoteResult.quotes.map((quote) => [quote.externalItemId, quote]));

    for (const row of batch) {
      const externalItemId = validExternalItemId(row.externalItemId);
      if (!externalItemId) continue;
      const quote = quotesByItemId.get(externalItemId);
      if (!quoteIsPersistable({ quote, organizationId: organization.id, connectionId: connection.id, sellerId, externalItemId })) {
        summary.failed += 1;
        summary.preserved += 1;
        summary.failedItemIds.push(externalItemId);
        continue;
      }

      const shippingCost = quote!.shippingCost!;
      const persisted = buildPersistedSellerShippingCost({
        query: quote!.query!,
        costAmount: shippingCost.costAmount,
        currencyId: shippingCost.currencyId ?? quote!.query!.currencyId,
        lastUpdatedAt: shippingCost.fetchedAt,
        stale: false,
        unavailableReason: null
      });

      try {
        const updated = await dependencies.updateSellerShippingCost({
          rowId: row.id,
          organizationId: organization.id,
          externalItemId,
          sellerShippingCost: persisted
        });
        if (!updated) throw new SafeShippingCacheBackfillError("Linha de cache nao encontrada para a identidade validada.");
        summary.written += 1;
        if (shippingCost.costAmount === 0) summary.confirmedZero += 1;
      } catch {
        summary.failed += 1;
        summary.preserved += 1;
        summary.failedItemIds.push(externalItemId);
      }
    }

    if (batchIndex < batches.length - 1 && batchDelayMs) await dependencies.wait(batchDelayMs);
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

async function createRuntimeDependencies(): Promise<ShippingCacheBackfillDependencies> {
  const [{ prisma }, prismaClient, listingsModule] = await Promise.all([
    import("../lib/prisma"),
    import("@prisma/client"),
    import("../lib/services/marketplaces/mercado-livre-client-listings-service")
  ]);
  const { MarketplaceProvider, Prisma } = prismaClient;

  return {
    now: () => new Date(),
    findOrganization: (slug) =>
      prisma.organization.findUnique({ where: { slug }, select: { id: true, status: true } }),
    findMercadoLivreConnection: (organizationId) =>
      prisma.marketplaceConnection.findUnique({
        where: { organizationId_provider: { organizationId, provider: MarketplaceProvider.MERCADOLIVRE } },
        select: { id: true, status: true, sellerId: true, externalAccountId: true }
      }),
    listCacheRows: async (organizationId) => {
      const rows = await prisma.mercadoLivreListingCache.findMany({
        where: { organizationId, status: { in: eligibleStatuses } },
        orderBy: { externalItemId: "asc" },
        select: {
          id: true,
          organizationId: true,
          externalItemId: true,
          status: true,
          price: true,
          currencyId: true,
          rawAttributesJson: true
        }
      });
      return rows.map((row) => ({ ...row, price: row.price === null ? null : Number(row.price) }));
    },
    fetchQuotes: ({ organizationId, itemIds }) =>
      listingsModule.mercadoLivreClientListingsService.getShippingCostsForCacheBackfill({ organizationId, itemIds }),
    updateSellerShippingCost: async ({ rowId, organizationId, externalItemId, sellerShippingCost }) => {
      const serialized = JSON.stringify(sellerShippingCost);
      const updated = await prisma.$executeRaw(
        Prisma.sql`
          UPDATE "MercadoLivreListingCache"
          SET "rawAttributesJson" = jsonb_set(
            COALESCE("rawAttributesJson", '{}'::jsonb),
            '{sellerShippingCost}',
            ${serialized}::jsonb,
            true
          )
          WHERE "id" = ${rowId}
            AND "organizationId" = ${organizationId}
            AND "externalItemId" = ${externalItemId}
            AND ("rawAttributesJson" IS NULL OR jsonb_typeof("rawAttributesJson") = 'object')
        `
      );
      return updated === 1;
    },
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  };
}

function printSummary(summary: ShippingCacheBackfillSummary) {
  console.log(`Total de anuncios encontrados: ${summary.total}`);
  console.log(`Cache v2 valido: ${summary.validV2}`);
  console.log(`Cache ausente: ${summary.missing}`);
  console.log(`Cache invalido: ${summary.invalid}`);
  console.log(`Cache desatualizado: ${summary.stale}`);
  console.log(`Anuncios elegiveis: ${summary.eligible}`);
  console.log(`Anuncios ignorados: ${summary.ignored}`);
  console.log(`Consultas previstas: ${summary.predictedQueries}`);
  console.log(`Gravacoes previstas: ${summary.predictedWrites}`);
  if (summary.confirmed) {
    console.log(`Anuncios processados: ${summary.processed}`);
    console.log(`Gravacoes concluidas: ${summary.written}`);
    console.log(`Falhas preservadas sem alteracao: ${summary.failed}`);
    console.log(`Respostas de rate limit: ${summary.rateLimitResponses}`);
    console.log(`Valores zero confirmados: ${summary.confirmedZero}`);
    console.log(`Caches preservados: ${summary.preserved}`);
    console.log(`Duracao total: ${summary.durationMs} ms`);
    if (summary.failedItemIds.length) console.log(`IDs com falha: ${summary.failedItemIds.join(", ")}`);
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const options = parseShippingCacheBackfillArguments(process.argv.slice(2));
  const dependencies = await createRuntimeDependencies();
  try {
    printSummary(await runShippingCacheBackfill(options, dependencies));
  } finally {
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  }
}

const directExecution = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (directExecution) {
  main().catch((error: unknown) => {
    if (error instanceof SafeShippingCacheBackfillError) console.error(error.message);
    else console.error("Nao foi possivel analisar o cache de frete com seguranca.");
    process.exitCode = 1;
  });
}
