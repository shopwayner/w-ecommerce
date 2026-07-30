import {
  BlingProductImageBackfillInputError,
  runBlingProductImageBackfill
} from "../lib/services/bling-product-image-backfill";

type CliOptions = {
  organizationId: string;
  connectionId: string;
  cursor: string | null;
  limit?: number;
  confirm: boolean;
};

function argumentValue(argumentsList: string[], prefix: string) {
  return argumentsList.find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() ?? "";
}

export function parseBlingProductImageBackfillArguments(argumentsList: string[]): CliOptions {
  const allowed = argumentsList.every((argument) =>
    argument === "--confirm"
    || argument.startsWith("--organization-id=")
    || argument.startsWith("--connection-id=")
    || argument.startsWith("--cursor=")
    || argument.startsWith("--limit=")
  );
  if (!allowed) {
    throw new BlingProductImageBackfillInputError(
      "Argumento nao reconhecido. Use --organization-id, --connection-id, --cursor, --limit e --confirm."
    );
  }

  const organizationId = argumentValue(argumentsList, "--organization-id=");
  const connectionId = argumentValue(argumentsList, "--connection-id=");
  if (!organizationId) {
    throw new BlingProductImageBackfillInputError(
      "Informe --organization-id=<id> explicitamente."
    );
  }
  if (!connectionId) {
    throw new BlingProductImageBackfillInputError(
      "Informe --connection-id=<id> explicitamente."
    );
  }

  const rawLimit = argumentValue(argumentsList, "--limit=");
  const limit = rawLimit ? Number(rawLimit) : undefined;
  if (rawLimit && (!Number.isInteger(limit) || Number(limit) < 1)) {
    throw new BlingProductImageBackfillInputError("--limit deve ser um inteiro positivo.");
  }

  return {
    organizationId,
    connectionId,
    cursor: argumentValue(argumentsList, "--cursor=") || null,
    ...(limit === undefined ? {} : { limit }),
    confirm: argumentsList.includes("--confirm")
  };
}

async function main() {
  const options = parseBlingProductImageBackfillArguments(process.argv.slice(2));
  const result = await runBlingProductImageBackfill(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith("backfill-bling-product-images.ts")) {
  main().catch((error) => {
    const message = error instanceof BlingProductImageBackfillInputError
      ? error.message
      : "Nao foi possivel concluir o backfill de imagens.";
    console.error(message);
    process.exitCode = 1;
  });
}
