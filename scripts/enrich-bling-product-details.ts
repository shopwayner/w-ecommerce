import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  applyBlingProductDetailLocalUpdate,
  createPrismaBlingProductDetailUpdateStore,
  decodeBlingProductDetailsCheckpoint,
  runBlingProductDetailsEnrichment,
  SafeBlingProductDetailsEnrichmentError,
  type BlingProductDetailChanges,
  type BlingProductDetailSchemaCapabilities,
  type BlingProductDetailUpdateResult,
  type LinkedBlingProductDetailRow
} from "../lib/services/bling-product-details-enrichment";

loadEnvConfig(process.env.W_ECOMMERCE_ENV_DIR?.trim() || process.cwd());

type Arguments = {
  organizationSlug: string;
  connectionId: string;
  confirm: boolean;
  force: boolean;
  limit?: number;
  afterMappingId?: string;
  identityManifest?: IdentityManifest;
};

type IdentityManifest = {
  version: 1;
  organizationSlug: string;
  organizationId: string;
  connectionId: string;
  totalLinked: number;
  missingExternalProductIds: string[];
  processedExternalProductIds: string[];
  missingIdentityDigest: string;
  processedIdentityDigest: string;
  unionIdentityDigest: string;
};

type LinkedProductDatabaseRow = {
  mappingId: string;
  organizationId: string;
  connectionId: string;
  externalProductId: string;
  productId: string;
  productUpdatedAt: Date;
  mappingUpdatedAt: Date;
  lastDetailSyncAt: Date | null;
  gtin: string | null;
  netWeight: unknown;
  grossWeight: unknown;
  height: unknown;
  width: unknown;
  depth: unknown;
  dimensionUnit: LinkedBlingProductDetailRow["local"]["dimensionUnit"];
  condition: LinkedBlingProductDetailRow["local"]["condition"];
};

class SafeCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeCliError";
  }
}

function requiredValue(argument: string | undefined, prefix: string) {
  const value = argument?.slice(prefix.length).trim();
  if (!value) throw new SafeCliError(`Informe ${prefix}<valor>.`);
  return value;
}

function identityDigest(organizationId: string, connectionId: string, externalProductIds: string[]) {
  const identities = externalProductIds
    .map((externalProductId) => `${organizationId}|${connectionId}|${externalProductId}`)
    .sort();
  return createHash("sha256").update(identities.join("\n")).digest("hex");
}

function readIdentityManifest(path: string): IdentityManifest {
  if (!/^\/tmp\/w-enrich-[A-Za-z0-9._-]+\.json$/.test(path)) {
    throw new SafeCliError("Caminho do manifesto de identidades invalido.");
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SafeCliError("Manifesto de identidades indisponivel ou invalido.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SafeCliError("Manifesto de identidades invalido.");
  }
  const manifest = value as Record<string, unknown>;
  const missing = manifest.missingExternalProductIds;
  const processed = manifest.processedExternalProductIds;
  if (
    manifest.version !== 1
    || typeof manifest.organizationSlug !== "string"
    || typeof manifest.organizationId !== "string"
    || typeof manifest.connectionId !== "string"
    || typeof manifest.totalLinked !== "number"
    || !Array.isArray(missing)
    || !Array.isArray(processed)
    || typeof manifest.missingIdentityDigest !== "string"
    || typeof manifest.processedIdentityDigest !== "string"
    || typeof manifest.unionIdentityDigest !== "string"
  ) {
    throw new SafeCliError("Manifesto de identidades invalido.");
  }
  const validExternalId = (item: unknown): item is string => typeof item === "string" && /^\d{1,30}$/.test(item);
  if (!missing.every(validExternalId) || !processed.every(validExternalId)) {
    throw new SafeCliError("Manifesto contem identificador externo invalido.");
  }
  const missingSet = new Set(missing);
  const processedSet = new Set(processed);
  const overlap = missing.some((externalProductId) => processedSet.has(externalProductId));
  if (
    missingSet.size !== missing.length
    || processedSet.size !== processed.length
    || overlap
    || missing.length + processed.length !== manifest.totalLinked
  ) {
    throw new SafeCliError("Manifesto de identidades possui sobreposicao, duplicidade ou lacuna.");
  }
  const organizationId = manifest.organizationId;
  const connectionId = manifest.connectionId;
  if (
    identityDigest(organizationId, connectionId, missing) !== manifest.missingIdentityDigest
    || identityDigest(organizationId, connectionId, processed) !== manifest.processedIdentityDigest
    || identityDigest(organizationId, connectionId, [...missing, ...processed]) !== manifest.unionIdentityDigest
  ) {
    throw new SafeCliError("Assinatura do manifesto de identidades divergente.");
  }
  return manifest as IdentityManifest;
}

export function readBlingProductDetailsArguments(argumentsList = process.argv.slice(2)): Arguments {
  const allowedPrefixes = [
    "--organization-slug=",
    "--connection-id=",
    "--limit=",
    "--resume-token=",
    "--identity-manifest="
  ];
  const unknown = argumentsList.filter(
    (argument) => argument !== "--confirm" && argument !== "--force"
      && !allowedPrefixes.some((prefix) => argument.startsWith(prefix))
  );
  if (unknown.length) {
    throw new SafeCliError(
      "Argumento nao reconhecido. Use --organization-slug, --connection-id, --limit, --resume-token, --force e --confirm."
    );
  }

  const slugArgument = argumentsList.find((argument) => argument.startsWith("--organization-slug="));
  const connectionArgument = argumentsList.find((argument) => argument.startsWith("--connection-id="));
  const limitArgument = argumentsList.find((argument) => argument.startsWith("--limit="));
  const resumeArgument = argumentsList.find((argument) => argument.startsWith("--resume-token="));
  const manifestArgument = argumentsList.find((argument) => argument.startsWith("--identity-manifest="));
  const organizationSlug = requiredValue(slugArgument, "--organization-slug=");
  const connectionId = requiredValue(connectionArgument, "--connection-id=");

  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(organizationSlug)) {
    throw new SafeCliError("Slug de organizacao invalido.");
  }
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(connectionId)) {
    throw new SafeCliError("Identificador da conexao invalido.");
  }

  let limit: number | undefined;
  if (limitArgument) {
    limit = Number(requiredValue(limitArgument, "--limit="));
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new SafeCliError("O limite deve ser um inteiro entre 1 e 10000.");
    }
  }

  const afterMappingId = resumeArgument
    ? decodeBlingProductDetailsCheckpoint(requiredValue(resumeArgument, "--resume-token="))
    : undefined;
  const identityManifest = manifestArgument
    ? readIdentityManifest(requiredValue(manifestArgument, "--identity-manifest="))
    : undefined;
  if (
    identityManifest
    && (identityManifest.organizationSlug !== organizationSlug || identityManifest.connectionId !== connectionId)
  ) {
    throw new SafeCliError("Manifesto nao pertence a organizacao e conexao informadas.");
  }

  return {
    organizationSlug,
    connectionId,
    confirm: argumentsList.includes("--confirm"),
    force: argumentsList.includes("--force"),
    limit,
    afterMappingId,
    identityManifest
  };
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new SafeCliError("DATABASE_URL nao configurada.");
  }
  const args = readBlingProductDetailsArguments();
  const [{ prisma }, { Prisma }, { blingApiClient, BlingApiError }] = await Promise.all([
    import("../lib/prisma"),
    import("@prisma/client"),
    import("../lib/services/bling-api-client")
  ]);
  const productDetailUpdateStore = createPrismaBlingProductDetailUpdateStore(prisma);

  const readSchemaCapabilities = async (): Promise<BlingProductDetailSchemaCapabilities> => {
    const rows = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'Product' AND column_name IN ('grossWeight', 'dimensionUnit', 'condition'))
          OR (table_name = 'ProductExternalMapping' AND column_name = 'lastDetailSyncAt')
        )
    `;
    const fields = new Set(rows.map((row) => `${row.tableName}.${row.columnName}`));
    return {
      grossWeight: fields.has("Product.grossWeight"),
      dimensionUnit: fields.has("Product.dimensionUnit"),
      condition: fields.has("Product.condition"),
      lastDetailSyncAt: fields.has("ProductExternalMapping.lastDetailSyncAt")
    };
  };

  const listLinkedProducts = async (input: {
    organizationId: string;
    connectionId: string;
    afterMappingId?: string;
    limit?: number;
    capabilities: BlingProductDetailSchemaCapabilities;
  }) => {
    const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "ProductExternalMapping" pem
      INNER JOIN "Product" p
        ON p.id = pem."productId"
       AND p."organizationId" = pem."organizationId"
      WHERE pem."organizationId" = ${input.organizationId}
        AND pem."connectionId" = ${input.connectionId}
        AND NULLIF(BTRIM(pem."externalProductId"), '') IS NOT NULL
    `;

    const afterClause = input.afterMappingId
      ? Prisma.sql`AND pem.id > ${input.afterMappingId}`
      : Prisma.empty;
    const identityClause = args.identityManifest
      ? Prisma.sql`AND pem."externalProductId" IN (${Prisma.join(args.identityManifest.missingExternalProductIds)})`
      : Prisma.empty;
    const limitClause = input.limit ? Prisma.sql`LIMIT ${input.limit}` : Prisma.empty;
    const grossWeight = input.capabilities.grossWeight
      ? Prisma.raw('p."grossWeight"')
      : Prisma.sql`NULL::numeric`;
    const dimensionUnit = input.capabilities.dimensionUnit
      ? Prisma.raw('p."dimensionUnit"')
      : Prisma.sql`NULL::text`;
    const condition = input.capabilities.condition
      ? Prisma.raw('p."condition"')
      : Prisma.sql`NULL::text`;
    const lastDetailSyncAt = input.capabilities.lastDetailSyncAt
      ? Prisma.raw('pem."lastDetailSyncAt"')
      : Prisma.sql`NULL::timestamp`;

    const rows = await prisma.$queryRaw<LinkedProductDatabaseRow[]>(Prisma.sql`
      SELECT
        pem.id AS "mappingId",
        pem."organizationId",
        pem."connectionId",
        pem."externalProductId",
        pem."productId",
        p."updatedAt" AS "productUpdatedAt",
        pem."updatedAt" AS "mappingUpdatedAt",
        ${lastDetailSyncAt} AS "lastDetailSyncAt",
        p.ean AS gtin,
        p.weight AS "netWeight",
        ${grossWeight} AS "grossWeight",
        p.height,
        p.width,
        p.depth,
        ${dimensionUnit} AS "dimensionUnit",
        ${condition} AS condition
      FROM "ProductExternalMapping" pem
      INNER JOIN "Product" p
        ON p.id = pem."productId"
       AND p."organizationId" = pem."organizationId"
      WHERE pem."organizationId" = ${input.organizationId}
        AND pem."connectionId" = ${input.connectionId}
        AND NULLIF(BTRIM(pem."externalProductId"), '') IS NOT NULL
        ${identityClause}
        ${afterClause}
      ORDER BY pem.id ASC
      ${limitClause}
    `);

    const normalizedRows = rows.map((row) => ({
      mappingId: row.mappingId,
      organizationId: row.organizationId,
      connectionId: row.connectionId,
      externalProductId: row.externalProductId,
      productId: row.productId,
      productUpdatedAt: row.productUpdatedAt,
      mappingUpdatedAt: row.mappingUpdatedAt,
      lastDetailSyncAt: row.lastDetailSyncAt,
      local: {
        gtin: row.gtin,
        netWeight: numberOrNull(row.netWeight),
        grossWeight: numberOrNull(row.grossWeight),
        height: numberOrNull(row.height),
        width: numberOrNull(row.width),
        depth: numberOrNull(row.depth),
        dimensionUnit: row.dimensionUnit,
        condition: row.condition
      }
    }));
    if (args.identityManifest) {
      if (args.identityManifest.organizationId !== input.organizationId) {
        throw new SafeBlingProductDetailsEnrichmentError("Manifesto pertence a outra organizacao.");
      }
      const missingSet = new Set(args.identityManifest.missingExternalProductIds);
      const processedSet = new Set(args.identityManifest.processedExternalProductIds);
      if (normalizedRows.some((row) => !missingSet.has(row.externalProductId) || processedSet.has(row.externalProductId))) {
        throw new SafeBlingProductDetailsEnrichmentError("Selecao divergente do manifesto de identidades.");
      }
      if (!input.afterMappingId && !input.limit && normalizedRows.length !== missingSet.size) {
        throw new SafeBlingProductDetailsEnrichmentError("Manifesto nao corresponde aos vinculos locais atuais.");
      }
    }

    return {
      total: Number(totalRows[0]?.total ?? 0),
      rows: normalizedRows
    };
  };

  const applyLocalUpdate = (input: {
    row: LinkedBlingProductDetailRow;
    changes: BlingProductDetailChanges;
    checkedAt: Date;
  }): Promise<BlingProductDetailUpdateResult> => applyBlingProductDetailLocalUpdate(
    productDetailUpdateStore,
    input
  );

  try {
    const report = await runBlingProductDetailsEnrichment(
      {
        organizationSlug: args.organizationSlug,
        connectionId: args.connectionId,
        confirm: args.confirm,
        force: args.force,
        limit: args.limit,
        afterMappingId: args.afterMappingId,
        batchSize: 1,
        batchDelayMs: 200
      },
      {
        now: () => new Date(),
        wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        findOrganization: (slug) => prisma.organization.findUnique({
          where: { slug },
          select: { id: true, status: true }
        }),
        findConnection: (organizationId, connectionId) => prisma.blingConnection.findFirst({
          where: { id: connectionId, organizationId },
          select: { id: true, status: true, name: true }
        }),
        readSchemaCapabilities,
        listLinkedProducts,
        fetchProductDetail: ({ organizationId, connectionId, externalProductId }) => {
          if (!/^\d{1,30}$/.test(externalProductId)) {
            throw new SafeBlingProductDetailsEnrichmentError("Identificador externo invalido.");
          }
          if (args.identityManifest) {
            const missing = new Set(args.identityManifest.missingExternalProductIds);
            const processed = new Set(args.identityManifest.processedExternalProductIds);
            if (!missing.has(externalProductId) || processed.has(externalProductId)) {
              throw new SafeBlingProductDetailsEnrichmentError(
                "Consulta bloqueada porque a identidade nao pertence ao conjunto ausente."
              );
            }
          }
          return blingApiClient.requestReadOnly<unknown>({
            organizationId,
            connectionId,
            path: `/produtos/${externalProductId}`
          });
        },
        applyLocalUpdate,
        classifyFailure: (error) => {
          if (error instanceof SafeBlingProductDetailsEnrichmentError) {
            return { code: "IDENTITY_INVALID", retryable: false, fatal: true };
          }
          if (error instanceof BlingApiError) {
            const fatalCodes = new Set([
              "CONNECTION_NOT_FOUND",
              "CONFIGURATION_MISSING",
              "CONNECTION_DISCONNECTED",
              "TOKEN_MISSING",
              "TOKEN_EXPIRED",
              "TOKEN_INVALID",
              "PERMISSION_DENIED"
            ]);
            return {
              code: error.code,
              retryable: error.code === "RATE_LIMITED" || error.code === "TEMPORARY_FAILURE",
              retryAfterMs: error.retryAfter ? error.retryAfter * 1_000 : undefined,
              fatal: fatalCodes.has(error.code)
            };
          }
          return { code: "UNEXPECTED", retryable: false };
        },
        onCheckpoint: ({ token, processed, selectedProducts, report }) => {
          if (processed % 250 === 0 || processed === selectedProducts) {
            process.stdout.write(`${JSON.stringify({
              type: "checkpoint",
              processed,
              selectedProducts,
              resumeToken: token,
              partial: report
            })}\n`);
          }
        }
      }
    );
    process.stdout.write(`${JSON.stringify({ type: "result", ...report })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof SafeCliError || error instanceof SafeBlingProductDetailsEnrichmentError
    ? error.message
    : "A rotina nao pode ser concluida com seguranca.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
