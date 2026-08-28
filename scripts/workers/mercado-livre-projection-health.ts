import {
  assertMercadoLivreProjectionRuntimeHealthy,
  mercadoLivreProjectionRuntimeHealthFile,
  type MercadoLivreProjectionRuntimeService
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-runtime-health";

function parseService(value: string | undefined): MercadoLivreProjectionRuntimeService {
  if (value === "worker" || value === "scheduler") return value;
  throw new Error("PROJECTION_HEALTH_SERVICE_INVALID");
}

function parseMaxAgeSeconds(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 3_600) {
    throw new Error("PROJECTION_HEALTH_MAX_AGE_INVALID");
  }
  return parsed;
}

async function main() {
  const service = parseService(process.argv[2]);
  const maxAgeMs = parseMaxAgeSeconds(process.argv[3]) * 1_000;
  const health = await assertMercadoLivreProjectionRuntimeHealthy({
    service,
    filePath: mercadoLivreProjectionRuntimeHealthFile(service),
    maxAgeMs
  });
  console.log(JSON.stringify(health));
}

main().catch((error) => {
  const errorCode = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error
      ? error.message.replace(/[^A-Z0-9_:-]+/gi, "_").toUpperCase().slice(0, 120)
      : "PROJECTION_HEALTH_FAILED";
  console.error(JSON.stringify({ status: "unhealthy", errorCode }));
  process.exitCode = 1;
});
