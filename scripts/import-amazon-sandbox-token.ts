import { loadEnvConfig } from "@next/env";
import { MarketplaceProvider } from "@prisma/client";

loadEnvConfig(process.cwd());

const expectedEnvironment = "sandbox";
const expectedMarketplaceId = "A2Q3Y263D00KWC";
const expectedRegion = "NA";

class SafeImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeImportError";
  }
}

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new SafeImportError(`Configuracao obrigatoria ausente: ${name}.`);
  return value;
}

function assertEnvPresent(name: string) {
  if (!process.env[name]?.trim()) {
    throw new SafeImportError(`Configuracao obrigatoria ausente: ${name}.`);
  }
}

function readArguments() {
  const argumentsList = process.argv.slice(2);
  const confirm = argumentsList.includes("--confirm");
  const slugArgument = argumentsList.find((argument) => argument.startsWith("--organization-slug="));
  const unknownArguments = argumentsList.filter(
    (argument) => argument !== "--confirm" && !argument.startsWith("--organization-slug=")
  );

  if (unknownArguments.length) {
    throw new SafeImportError("Argumento nao reconhecido. Use apenas --organization-slug e --confirm.");
  }

  const organizationSlug = slugArgument?.slice("--organization-slug=".length).trim();
  if (!organizationSlug || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(organizationSlug)) {
    throw new SafeImportError("Informe uma organizacao valida com --organization-slug=<slug>.");
  }
  if (!confirm) {
    throw new SafeImportError("Importacao nao confirmada. Revise o destino e adicione --confirm.");
  }

  return { organizationSlug };
}

async function importSandboxRefreshToken() {
  const { organizationSlug } = readArguments();
  const applicationId = readRequiredEnv("AMAZON_SP_API_APPLICATION_ID");
  const clientId = readRequiredEnv("AMAZON_SP_API_CLIENT_ID");
  assertEnvPresent("AMAZON_SP_API_CLIENT_SECRET");
  const marketplaceId = readRequiredEnv("AMAZON_SP_API_MARKETPLACE_ID");
  const region = readRequiredEnv("AMAZON_SP_API_REGION").toUpperCase();
  const environment = readRequiredEnv("AMAZON_SP_API_APP_ENV").toLowerCase();
  assertEnvPresent("APP_ENCRYPTION_KEY");
  assertEnvPresent("DATABASE_URL");

  if (environment !== expectedEnvironment || region !== expectedRegion || marketplaceId !== expectedMarketplaceId) {
    throw new SafeImportError("A importacao aceita somente o Sandbox Amazon BR configurado para a regiao NA.");
  }

  const refreshToken = readRequiredEnv("AMAZON_SP_API_REFRESH_TOKEN");

  const [{ prisma }, { encryptSecret }, { isMasterOrganization }] = await Promise.all([
    import("../lib/prisma"),
    import("../lib/security/encryption"),
    import("../lib/services/plan-limit-service")
  ]);

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: organizationSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        users: {
          where: { role: "OWNER", user: { status: "ACTIVE" } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { userId: true }
        }
      }
    });

    if (!organization || organization.status !== "ACTIVE") {
      throw new SafeImportError("Organizacao ativa nao encontrada para o slug informado.");
    }
    if (!(await isMasterOrganization(organization.id))) {
      throw new SafeImportError("A organizacao informada nao e reconhecida como MASTER pelo backend.");
    }

    const ownerUserId = organization.users[0]?.userId;
    if (!ownerUserId) {
      throw new SafeImportError("A organizacao MASTER precisa ter um OWNER ativo.");
    }

    const now = new Date();
    const refreshTokenEncrypted = encryptSecret(refreshToken);
    const credentialsEncrypted = encryptSecret(
      JSON.stringify({ applicationId, clientId, marketplaceId, region, environment })
    );

    await prisma.marketplaceConnection.upsert({
      where: {
        organizationId_provider: {
          organizationId: organization.id,
          provider: MarketplaceProvider.AMAZON
        }
      },
      create: {
        organizationId: organization.id,
        userId: ownerUserId,
        provider: MarketplaceProvider.AMAZON,
        accountAlias: "Amazon Sandbox BR",
        status: "ACTIVE",
        configStatus: "CONNECTED",
        credentialsEncrypted,
        accessTokenEncrypted: null,
        refreshTokenEncrypted,
        tokenType: "Bearer",
        expiresAt: null,
        scopes: null,
        marketplaceId,
        region,
        environment,
        connectedAt: now,
        lastConnectionTestAt: null,
        lastError: null
      },
      update: {
        userId: ownerUserId,
        accountAlias: "Amazon Sandbox BR",
        status: "ACTIVE",
        configStatus: "CONNECTED",
        credentialsEncrypted,
        accessTokenEncrypted: null,
        refreshTokenEncrypted,
        tokenType: "Bearer",
        expiresAt: null,
        scopes: null,
        marketplaceId,
        region,
        environment,
        connectedAt: now,
        lastConnectionTestAt: null,
        lastError: null
      }
    });

    console.log(`Conexao Amazon Sandbox importada com seguranca para ${organization.name}.`);
    console.log("Remova AMAZON_SP_API_REFRESH_TOKEN do .env antes de continuar.");
  } finally {
    delete process.env.AMAZON_SP_API_REFRESH_TOKEN;
    await prisma.$disconnect();
  }
}

importSandboxRefreshToken().catch((error: unknown) => {
  delete process.env.AMAZON_SP_API_REFRESH_TOKEN;
  if (error instanceof SafeImportError) {
    console.error(error.message);
  } else {
    console.error("Nao foi possivel importar a conexao Amazon Sandbox com seguranca.");
  }
  process.exitCode = 1;
});
