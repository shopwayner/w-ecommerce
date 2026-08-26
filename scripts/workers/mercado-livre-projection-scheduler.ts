import {
  runMercadoLivreProjectionSchedulerRuntime,
  sanitizeMercadoLivreProjectionSchedulerRuntimeError
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-scheduler-runtime";

void runMercadoLivreProjectionSchedulerRuntime().catch((error) => {
  console.error(JSON.stringify(
    sanitizeMercadoLivreProjectionSchedulerRuntimeError(error)
  ));
  process.exitCode = 1;
});
