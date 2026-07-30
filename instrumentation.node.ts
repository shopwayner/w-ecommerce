import { blingProductImportService } from "@/lib/services/bling-product-import-service";

const pollIntervalMs = 2_000;

type WorkerState = {
  timer?: ReturnType<typeof setInterval>;
  running?: boolean;
};

const workerState = globalThis as typeof globalThis & {
  __blingProductImportWorker?: WorkerState;
};

export function startBlingProductImportWorker() {
  if (workerState.__blingProductImportWorker?.timer) return;
  const state: WorkerState = {};
  workerState.__blingProductImportWorker = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await blingProductImportService.runNextPendingJob();
    } catch (error) {
      console.warn("[bling.product-import.worker]", {
        stage: "JOB_TICK",
        errorClass: error instanceof Error ? error.name : "UnknownError"
      });
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(() => void tick(), pollIntervalMs);
  state.timer.unref?.();
  void tick();
}

startBlingProductImportWorker();
