import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { chmod, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { normalizeProductBrand } from "../lib/product-brand";
import { prisma } from "../lib/prisma";
import {
  createPrismaBlingProductBrandBackfillDependencies,
  extractBrandAnalysisFromBlingProductDetail,
  runBlingProductBrandBackfill,
  type BlingProductBrandBackfillPlanEntry,
  type BlingProductBrandBackfillRow
} from "../lib/services/bling-product-brand-backfill";
import {
  blingOAuthService,
  getBlingConnectionCredentialSummary
} from "../lib/services/bling-oauth-service";

const expectedConnectionName = "Bling - 262 Moto";
const technicalSampleSku = "6592";
const inspectedCandidateSku = "7680";
const requestIntervalMs = 500;
const executionBufferMs = 16 * 60 * 1_000;
const minimumConfirmedTokenValidityMs = 90 * 60 * 1_000;
const allowedPlanPathPattern = /^\/opt\/w-ecommerce\/backups\/w-ecommerce-brand-backfill-plan-\d{8}T\d{6}Z\.json$/;

export class SafeBlingProductBrandBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeBlingProductBrandBackfillError";
  }
}

export function parseBlingProductBrandBackfillArguments(argumentsList: string[]) {
  const confirm = argumentsList.includes("--confirm");
  const slugArgument = argumentsList.find((argument) => argument.startsWith("--organization-slug="));
  const connectionArgument = argumentsList.find((argument) => argument.startsWith("--connection-id="));
  const unknownArguments = argumentsList.filter(
    (argument) =>
      argument !== "--confirm" &&
      !argument.startsWith("--organization-slug=") &&
      !argument.startsWith("--connection-id=")
  );
  if (unknownArguments.length) {
    throw new SafeBlingProductBrandBackfillError(
      "Argumento nao reconhecido. Use apenas --organization-slug, --connection-id e --confirm."
    );
  }

  const organizationSlug = slugArgument?.slice("--organization-slug=".length).trim();
  if (!organizationSlug || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(organizationSlug)) {
    throw new SafeBlingProductBrandBackfillError(
      "Informe uma organizacao valida com --organization-slug=<slug>."
    );
  }

  const connectionId = connectionArgument?.slice("--connection-id=".length).trim();
  if (!connectionId || !/^[a-zA-Z0-9_-]{10,80}$/.test(connectionId)) {
    throw new SafeBlingProductBrandBackfillError(
      "Informe uma conexao valida com --connection-id=<id>."
    );
  }

  return { organizationSlug, connectionId, confirm };
}

async function captureIntegritySnapshot(organizationId: string, connectionId: string) {
  const [
    productCount,
    mappingCount,
    draftCount,
    imageCount,
    productUpdatedAt,
    mappingUpdatedAt,
    brands,
    samples
  ] = await Promise.all([
    prisma.product.count({ where: { organizationId } }),
    prisma.productExternalMapping.count({ where: { organizationId, connectionId } }),
    prisma.blingProductImportDraft.count({ where: { organizationId, blingConnectionId: connectionId } }),
    prisma.productImage.count({ where: { organizationId } }),
    prisma.product.aggregate({ where: { organizationId }, _max: { updatedAt: true } }),
    prisma.productExternalMapping.aggregate({
      where: { organizationId, connectionId },
      _max: { updatedAt: true }
    }),
    prisma.product.findMany({ where: { organizationId }, select: { brand: true } }),
    prisma.product.findMany({
      where: { organizationId, sku: { in: [technicalSampleSku, inspectedCandidateSku] } },
      select: { sku: true, brand: true },
      orderBy: { sku: "asc" }
    })
  ]);

  return {
    products: productCount,
    productExternalMappings: mappingCount,
    drafts: draftCount,
    productImages: imageCount,
    productUpdatedAtMax: productUpdatedAt._max.updatedAt?.toISOString() ?? null,
    productExternalMappingUpdatedAtMax: mappingUpdatedAt._max.updatedAt?.toISOString() ?? null,
    validLocalBrands: brands.filter((product) => normalizeProductBrand(product.brand)).length,
    sampleBrands: samples.map((product) => ({
      sku: product.sku,
      brand: normalizeProductBrand(product.brand)
    }))
  };
}

function protectedIntegrityMatches(
  before: Awaited<ReturnType<typeof captureIntegritySnapshot>>,
  after: Awaited<ReturnType<typeof captureIntegritySnapshot>>
) {
  return before.products === after.products
    && before.productExternalMappings === after.productExternalMappings
    && before.drafts === after.drafts
    && before.productImages === after.productImages
    && before.productUpdatedAtMax === after.productUpdatedAtMax
    && before.productExternalMappingUpdatedAtMax === after.productExternalMappingUpdatedAtMax;
}

function getConfirmedPlanOutputPath(confirm: boolean) {
  if (!confirm) return null;
  const outputPath = process.env.BLING_PRODUCT_BRAND_PLAN_OUTPUT?.trim() ?? "";
  if (!allowedPlanPathPattern.test(outputPath)) {
    throw new SafeBlingProductBrandBackfillError(
      "O caminho protegido do plano de marcas nao foi configurado corretamente."
    );
  }
  return outputPath;
}

async function technicalReadOnlyTest(input: { organizationId: string; connectionId: string }) {
  const mapping = await prisma.productExternalMapping.findFirst({
    where: {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      product: { sku: technicalSampleSku }
    },
    select: {
      id: true,
      organizationId: true,
      connectionId: true,
      externalProductId: true,
      productId: true,
      product: { select: { sku: true, brand: true, updatedAt: true } }
    }
  });
  if (!mapping) {
    throw new SafeBlingProductBrandBackfillError("A amostra tecnica vinculada nao foi encontrada.");
  }
  const row: BlingProductBrandBackfillRow = {
    mappingId: mapping.id,
    organizationId: mapping.organizationId,
    connectionId: mapping.connectionId,
    externalProductId: mapping.externalProductId,
    productId: mapping.productId,
    productSku: mapping.product.sku,
    productBrand: mapping.product.brand,
    productUpdatedAt: mapping.product.updatedAt
  };
  const dependencies = createPrismaBlingProductBrandBackfillDependencies();
  const analysis = extractBrandAnalysisFromBlingProductDetail(await dependencies.fetchProductDetail(row));
  return {
    sku: technicalSampleSku,
    localBrand: normalizeProductBrand(mapping.product.brand),
    remoteBrand: analysis.brand,
    normalizedBrand: analysis.brand,
    action: "NO_CHANGE_LOCAL_BRAND_ALREADY_VALID",
    getRequests: 1
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const options = parseBlingProductBrandBackfillArguments(process.argv.slice(2));
  const planOutputPath = getConfirmedPlanOutputPath(options.confirm);
  let plannedEntries: readonly BlingProductBrandBackfillPlanEntry[] = [];
  let plannedProductTimestamps = new Map<string, string>();
  let planArtifact: null | {
    path: string;
    entries: number;
    sizeBytes: number;
    sha256: string;
    mode: "0600";
  } = null;
  const organization = await prisma.organization.findUnique({
    where: { slug: options.organizationSlug },
    select: { id: true, status: true }
  });
  if (!organization || organization.status !== "ACTIVE") {
    throw new SafeBlingProductBrandBackfillError("Organizacao ativa nao encontrada.");
  }

  const connection = await prisma.blingConnection.findFirst({
    where: { id: options.connectionId, organizationId: organization.id },
    select: {
      id: true,
      name: true,
      status: true,
      externalCompanyId: true,
      lastTestAt: true,
      lastError: true,
      clientIdEncrypted: true,
      clientSecretEncrypted: true
    }
  });
  if (!connection || connection.name !== expectedConnectionName || connection.status !== "ACTIVE") {
    throw new SafeBlingProductBrandBackfillError("Conexao Bling - 262 Moto ativa nao encontrada para esta organizacao.");
  }

  const credentialsConfiguredUi = getBlingConnectionCredentialSummary(connection).credentialsConfigured;
  const [
    token,
    runtimeCredentialsUsable,
    integrityBefore,
    candidateBrands,
    connectionCount,
    sameCompanyCount,
    latestConnectionTestAudit,
    latestReconnectAudit
  ] = await Promise.all([
    prisma.blingToken.findFirst({
      where: { organizationId: organization.id, blingConnectionId: connection.id },
      orderBy: { updatedAt: "desc" },
      select: {
        accessTokenEncrypted: true,
        refreshTokenEncrypted: true,
        expiresAt: true,
        updatedAt: true
      }
    }),
    blingOAuthService.hasUsableCredentials(connection.id, organization.id),
    captureIntegritySnapshot(organization.id, connection.id),
    prisma.product.findMany({
      where: {
        organizationId: organization.id,
        mappings: { some: { connectionId: connection.id } }
      },
      select: { brand: true }
    }),
    prisma.blingConnection.count({
      where: { organizationId: organization.id, status: { not: "DISCONNECTED" } }
    }),
    prisma.blingConnection.count({
      where: {
        organizationId: organization.id,
        externalCompanyId: connection.externalCompanyId,
        status: { not: "DISCONNECTED" }
      }
    }),
    prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "BLING_CONNECTION_TEST" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true }
    }),
    prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "BLING_OAUTH_RECONNECT_SUCCESS" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true }
    })
  ]);
  const candidateProducts = candidateBrands.filter((product) => !normalizeProductBrand(product.brand)).length;
  const estimatedExecutionValidityMs = candidateProducts * requestIntervalMs + executionBufferMs;
  const requiredValidityMs = options.confirm
    ? Math.max(estimatedExecutionValidityMs, minimumConfirmedTokenValidityMs)
    : estimatedExecutionValidityMs;
  const expiresAtFuture = Boolean(token && token.expiresAt.getTime() > Date.now());
  const tokenValiditySufficient = Boolean(token && token.expiresAt.getTime() > Date.now() + requiredValidityMs);
  const encryptedTokensPresent = Boolean(token?.accessTokenEncrypted && token.refreshTokenEncrypted);
  const connectionTestApproved = Boolean(token && connection.lastTestAt && connection.lastTestAt >= token.updatedAt);
  const noDuplicateConnection = connectionCount === 1 && sameCompanyCount === 1;
  const ready = Boolean(
    credentialsConfiguredUi &&
    runtimeCredentialsUsable &&
    connection.externalCompanyId &&
    !connection.lastError &&
    connectionTestApproved &&
    noDuplicateConnection &&
    encryptedTokensPresent &&
    tokenValiditySufficient
  );
  if (!ready) {
    console.error(JSON.stringify({
      preflight: {
        connectionNameMatches: connection.name === expectedConnectionName,
        statusActive: connection.status === "ACTIVE",
        organizationMatches: true,
        externalCompanyIdPresent: Boolean(connection.externalCompanyId),
        credentialsConfiguredUi,
        runtimeCredentialsUsable,
        connectionTestApproved,
        noDuplicateConnection,
        connectionCount,
        sameCompanyCount,
        oauthErrorPending: Boolean(connection.lastError),
        encryptedTokensPresent,
        expiresAtFuture,
        tokenValiditySufficient,
        tokenValidityMinutes: token ? Math.floor((token.expiresAt.getTime() - Date.now()) / 60_000) : 0,
        requiredValidityMinutes: Math.ceil(requiredValidityMs / 60_000),
        lastTestAt: connection.lastTestAt?.toISOString() ?? null,
        latestTokenUpdatedAt: token?.updatedAt.toISOString() ?? null,
        tokenExpiresAt: token?.expiresAt.toISOString() ?? null,
        secondsBetweenTestAndToken: token && connection.lastTestAt
          ? Math.round((connection.lastTestAt.getTime() - token.updatedAt.getTime()) / 1_000)
          : null,
        latestConnectionTestAuditAt: latestConnectionTestAudit?.createdAt.toISOString() ?? null,
        latestConnectionTestAuditStatus: latestConnectionTestAudit?.status ?? null,
        latestReconnectAuditAt: latestReconnectAudit?.createdAt.toISOString() ?? null,
        candidateProducts
      },
      integrity: integrityBefore,
      productGetsExecuted: 0
    }));
    throw new SafeBlingProductBrandBackfillError(
      "A conexao Bling nao esta pronta ou o token nao tem validade suficiente. Nenhum produto foi consultado."
    );
  }

  const technicalSample = await technicalReadOnlyTest({
    organizationId: organization.id,
    connectionId: connection.id
  });
  const report = await runBlingProductBrandBackfill({
    organizationId: organization.id,
    connectionId: connection.id,
    confirm: options.confirm,
    dependencies: createPrismaBlingProductBrandBackfillDependencies(),
    inspectSkus: [inspectedCandidateSku],
    async onPlanReady(plan) {
      if (!options.confirm || !planOutputPath) return;
      const productIds = plan.map((entry) => entry.productId);
      if (new Set(productIds).size !== productIds.length) {
        throw new SafeBlingProductBrandBackfillError("O plano de marcas contem produtos duplicados.");
      }
      const products = await prisma.product.findMany({
        where: { organizationId: organization.id, id: { in: productIds } },
        select: { id: true, brand: true, updatedAt: true }
      });
      if (products.length !== plan.length) {
        throw new SafeBlingProductBrandBackfillError("O plano de marcas nao corresponde aos produtos da organizacao.");
      }
      const productsById = new Map(products.map((product) => [product.id, product]));
      for (const entry of plan) {
        const product = productsById.get(entry.productId);
        if (!product || normalizeProductBrand(product.brand) !== entry.previousBrand) {
          throw new SafeBlingProductBrandBackfillError("Uma marca local mudou antes da confirmacao do plano.");
        }
      }

      const serializedPlan = `${JSON.stringify(plan, null, 2)}\n`;
      await writeFile(planOutputPath, serializedPlan, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(planOutputPath, 0o600);
      const fileStats = await stat(planOutputPath);
      plannedEntries = plan;
      plannedProductTimestamps = new Map(
        products.map((product) => [product.id, product.updatedAt.toISOString()])
      );
      planArtifact = {
        path: planOutputPath,
        entries: plan.length,
        sizeBytes: fileStats.size,
        sha256: createHash("sha256").update(serializedPlan).digest("hex"),
        mode: "0600"
      };
    },
    onProgress(progress) {
      const mode = options.confirm ? "CONFIRMED" : "DRY_RUN";
      console.error(`${mode}_PROGRESS consulted=${progress.consulted}/${progress.candidates} retries=${progress.retries}`);
    }
  });
  const integrityAfter = await captureIntegritySnapshot(organization.id, connection.id);
  const integrityUnchanged = JSON.stringify(integrityBefore) === JSON.stringify(integrityAfter);
  const protectedFieldsUnchanged = protectedIntegrityMatches(integrityBefore, integrityAfter);
  const expectedValidBrandCount = integrityBefore.validLocalBrands
    + report.writesPerformed
    + report.concurrentUpdates;
  const validBrandCountMatches = options.confirm
    ? integrityAfter.validLocalBrands === expectedValidBrandCount
    : integrityAfter.validLocalBrands === integrityBefore.validLocalBrands;

  let confirmedChangesVerified = !options.confirm;
  if (options.confirm) {
    if (!planArtifact || plannedEntries.length !== report.validBrandsFound) {
      throw new SafeBlingProductBrandBackfillError("O plano protegido nao foi criado antes do backfill.");
    }
    const productsAfter = await prisma.product.findMany({
      where: { organizationId: organization.id, id: { in: plannedEntries.map((entry) => entry.productId) } },
      select: { id: true, brand: true, updatedAt: true }
    });
    const productsAfterById = new Map(productsAfter.map((product) => [product.id, product]));
    let updatesWithPreservedTimestamp = 0;
    let concurrentBrandsPreserved = 0;
    for (const entry of plannedEntries) {
      const product = productsAfterById.get(entry.productId);
      if (!product) throw new SafeBlingProductBrandBackfillError("Um produto do plano deixou de existir.");
      const timestampPreserved = product.updatedAt.toISOString() === plannedProductTimestamps.get(entry.productId);
      if (product.brand === entry.newBrand && timestampPreserved) {
        updatesWithPreservedTimestamp += 1;
        continue;
      }
      if (normalizeProductBrand(product.brand)) {
        concurrentBrandsPreserved += 1;
        continue;
      }
      throw new SafeBlingProductBrandBackfillError("Uma marca planejada nao foi aplicada nem preservada por concorrencia.");
    }
    confirmedChangesVerified = updatesWithPreservedTimestamp === report.writesPerformed
      && concurrentBrandsPreserved === report.concurrentUpdates + report.identityMismatches;
  }

  const integrityVerified = protectedFieldsUnchanged
    && validBrandCountMatches
    && confirmedChangesVerified
    && report.externalWritesPerformed === 0
    && (options.confirm || report.writesPerformed === 0);
  if (!integrityVerified) {
    throw new SafeBlingProductBrandBackfillError("A verificacao de integridade do backfill falhou.");
  }

  console.log(JSON.stringify({
    preflight: {
      connectionName: connection.name,
      status: connection.status,
      ready,
      organizationActive: true,
      organizationMatches: true,
      externalCompanyIdPresent: Boolean(connection.externalCompanyId),
      credentialsConfiguredUi,
      runtimeCredentialsUsable,
      connectionTestApproved,
      noDuplicateConnection,
      connectionCount,
      sameCompanyCount,
      oauthErrorPending: Boolean(connection.lastError),
      encryptedTokensPresent,
      expiresAtFuture,
      tokenValiditySufficient,
      tokenValidityMinutes: token ? Math.floor((token.expiresAt.getTime() - Date.now()) / 60_000) : 0,
      lastTestAt: connection.lastTestAt?.toISOString() ?? null,
      latestTokenUpdatedAt: token?.updatedAt.toISOString() ?? null,
      tokenExpiresAt: token?.expiresAt.toISOString() ?? null,
      secondsBetweenTestAndToken: token && connection.lastTestAt
        ? Math.round((connection.lastTestAt.getTime() - token.updatedAt.getTime()) / 1_000)
        : null,
      latestConnectionTestAuditAt: latestConnectionTestAudit?.createdAt.toISOString() ?? null,
      latestConnectionTestAuditStatus: latestConnectionTestAudit?.status ?? null,
      latestReconnectAuditAt: latestReconnectAudit?.createdAt.toISOString() ?? null,
      candidateProducts,
      technicalSample
    },
    report,
    planArtifact,
    integrity: {
      before: integrityBefore,
      after: integrityAfter,
      unchanged: integrityUnchanged,
      protectedFieldsUnchanged,
      validBrandCountMatches,
      confirmedChangesVerified,
      verified: integrityVerified
    },
    totalBlingGetRequests: technicalSample.getRequests + report.remoteRequests
  }, null, 2));
}

const directExecution = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (directExecution) {
  main()
    .catch((error: unknown) => {
      if (error instanceof SafeBlingProductBrandBackfillError) console.error(error.message);
      else console.error("Nao foi possivel analisar as marcas dos produtos Bling com seguranca.");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
