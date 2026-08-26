import {
  runMercadoLivreProjectionWorkerRuntime,
  sanitizeMercadoLivreProjectionWorkerRuntimeError
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-worker-runtime";

void runMercadoLivreProjectionWorkerRuntime().catch((error) => {
  console.error(JSON.stringify(
    sanitizeMercadoLivreProjectionWorkerRuntimeError(error)
  ));
  process.exitCode = 1;
});
