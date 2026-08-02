import { blingProductImportService } from "@/lib/services/bling-product-import-service";
import { blingProductPreviewJobService } from "@/lib/services/bling-product-preview-job-service";

const pollIntervalMs = 2_000;

type WorkerState = {
  timer?: ReturnType<typeof setInterval>;
  running?: boolean;
  previewRunning?: boolean;
};

const workerState = globalThis as typeof globalThis & {
  __blingProductImportWorker?: WorkerState;
};

export function startBlingProductImportWorker() {
  if (workerState.__blingProductImportWorker?.timer) return;
  const state: WorkerState = {};
  workerState.__blingProductImportWorker = state;

  const tick = async () => {
    const realJobTick = async () => {
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
    const previewTick = async () => {
      if (state.previewRunning) return;
      state.previewRunning = true;
      try {
        await blingProductPreviewJobService.runNextPending();
      } catch (error) {
        console.warn("[bling.product-preview.worker]", {
          stage: "PREVIEW_TICK",
          errorClass: error instanceof Error ? error.name : "UnknownError"
        });
      } finally {
        state.previewRunning = false;
      }
    };
    await Promise.all([realJobTick(), previewTick()]);
  };

  state.timer = setInterval(() => void tick(), pollIntervalMs);
  state.timer.unref?.();
  void tick();
}

startBlingProductImportWorker();
