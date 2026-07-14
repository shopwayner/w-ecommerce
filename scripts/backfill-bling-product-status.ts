import { loadEnvConfig } from "@next/env";
import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma";
import { blingProductImportService } from "../lib/services/bling-product-import-service";

export class SafeBlingProductStatusBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeBlingProductStatusBackfillError";
  }
}

export function parseBlingProductStatusBackfillArguments(argumentsList: string[]) {
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
    throw new SafeBlingProductStatusBackfillError(
      "Argumento nao reconhecido. Use apenas --organization-slug, --connection-id e --confirm."
    );
  }

  const organizationSlug = slugArgument?.slice("--organization-slug=".length).trim();
  if (!organizationSlug || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(organizationSlug)) {
    throw new SafeBlingProductStatusBackfillError(
      "Informe uma organizacao valida com --organization-slug=<slug>."
    );
  }

  const connectionId = connectionArgument?.slice("--connection-id=".length).trim();
  if (!connectionId || !/^[a-zA-Z0-9_-]{10,80}$/.test(connectionId)) {
    throw new SafeBlingProductStatusBackfillError(
      "Informe uma conexao valida com --connection-id=<id>."
    );
  }

  return { organizationSlug, connectionId, confirm };
}

async function main() {
  loadEnvConfig(process.cwd());
  const options = parseBlingProductStatusBackfillArguments(process.argv.slice(2));
  const organization = await prisma.organization.findUnique({
    where: { slug: options.organizationSlug },
    select: { id: true, status: true }
  });
  if (!organization || organization.status !== "ACTIVE") {
    throw new SafeBlingProductStatusBackfillError("Organizacao ativa nao encontrada.");
  }

  const connection = await prisma.blingConnection.findFirst({
    where: {
      id: options.connectionId,
      organizationId: organization.id,
      status: "ACTIVE"
    },
    select: { id: true }
  });
  if (!connection) {
    throw new SafeBlingProductStatusBackfillError("Conexao Bling ativa nao encontrada para esta organizacao.");
  }

  const report = await blingProductImportService.reconcileProductStatuses({
    organizationId: organization.id,
    connectionId: connection.id,
    confirm: options.confirm
  });
  console.log(JSON.stringify(report, null, 2));
}

const directExecution = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (directExecution) {
  main()
    .catch((error: unknown) => {
      if (error instanceof SafeBlingProductStatusBackfillError) console.error(error.message);
      else console.error("Nao foi possivel analisar os status dos produtos Bling com seguranca.");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
