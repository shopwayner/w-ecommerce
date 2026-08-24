import { randomUUID } from "node:crypto";

export const MERCADO_LIVRE_LISTINGS_OPERATION_BUDGET_MS = 25_000;

export type MercadoLivreOperationStage =
  | "oauth"
  | "search"
  | "ids"
  | "details"
  | "fallback"
  | "fees"
  | "shipping"
  | "local"
  | "serialize";

export type MercadoLivreOperationAbortReason = "client_abort" | "operation_deadline";

export class MercadoLivreOperationError extends Error {
  readonly kind: MercadoLivreOperationAbortReason;
  readonly operationId: string;
  readonly stage: MercadoLivreOperationStage;
  readonly durationMs: number;

  constructor(input: {
    kind: MercadoLivreOperationAbortReason;
    operationId: string;
    stage: MercadoLivreOperationStage;
    durationMs: number;
  }) {
    super(`Mercado Livre listing operation stopped: ${input.kind}`);
    this.name = "MercadoLivreOperationError";
    this.kind = input.kind;
    this.operationId = input.operationId;
    this.stage = input.stage;
    this.durationMs = input.durationMs;
  }
}

export function isMercadoLivreOperationError(error: unknown): error is MercadoLivreOperationError {
  return error instanceof MercadoLivreOperationError;
}

type TimerHandle = ReturnType<typeof setTimeout>;

type OperationClock = {
  now: () => number;
  setTimer: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimer: (timer: TimerHandle) => void;
};

type OperationOutcome = "completed" | "partial" | MercadoLivreOperationAbortReason | "failed";

const operationBySignal = new WeakMap<AbortSignal, MercadoLivreReadOperation>();

export class MercadoLivreReadOperation {
  readonly operationId: string;
  readonly budgetMs: number;
  readonly signal: AbortSignal;

  private readonly controller = new AbortController();
  private readonly clientSignal?: AbortSignal;
  private readonly clock: OperationClock;
  private readonly startedAt: number;
  private readonly deadlineAt: number;
  private readonly stageDurations = new Map<MercadoLivreOperationStage, number>();
  private readonly timer: TimerHandle;
  private currentStage: MercadoLivreOperationStage = "search";
  private retryCount = 0;
  private timeoutCount = 0;
  private finished = false;

  constructor(input: {
    clientSignal?: AbortSignal;
    budgetMs?: number;
    operationId?: string;
    clock?: Partial<OperationClock>;
  } = {}) {
    this.operationId = input.operationId ?? randomUUID();
    this.budgetMs = Math.max(1, input.budgetMs ?? MERCADO_LIVRE_LISTINGS_OPERATION_BUDGET_MS);
    this.clientSignal = input.clientSignal;
    this.clock = {
      now: input.clock?.now ?? Date.now,
      setTimer: input.clock?.setTimer ?? setTimeout,
      clearTimer: input.clock?.clearTimer ?? clearTimeout
    };
    this.startedAt = this.clock.now();
    this.deadlineAt = this.startedAt + this.budgetMs;
    this.signal = this.controller.signal;
    operationBySignal.set(this.signal, this);

    this.timer = this.clock.setTimer(() => {
      this.abort("operation_deadline", this.currentStage);
    }, this.budgetMs);

    this.clientSignal?.addEventListener("abort", this.abortFromClient, { once: true });
    if (this.clientSignal?.aborted) this.abortFromClient();
  }

  private readonly abortFromClient = () => {
    this.abort("client_abort", this.currentStage);
  };

  private abort(kind: MercadoLivreOperationAbortReason, stage: MercadoLivreOperationStage) {
    if (this.controller.signal.aborted) return;
    this.controller.abort(
      new MercadoLivreOperationError({
        kind,
        operationId: this.operationId,
        stage,
        durationMs: this.elapsedMs()
      })
    );
  }

  elapsedMs() {
    return Math.max(0, this.clock.now() - this.startedAt);
  }

  remainingMs() {
    return Math.max(0, this.deadlineAt - this.clock.now());
  }

  assertCanStart(stage: MercadoLivreOperationStage, minimumBudgetMs = 1) {
    this.currentStage = stage;
    if (this.signal.aborted) throw this.abortError(stage);
    if (this.remainingMs() < Math.max(1, minimumBudgetMs)) {
      this.abort("operation_deadline", stage);
      throw this.abortError(stage);
    }
  }

  assertCanContinue(stage: MercadoLivreOperationStage) {
    this.currentStage = stage;
    if (this.signal.aborted) throw this.abortError(stage);
    if (this.remainingMs() < 1) {
      this.abort("operation_deadline", stage);
      throw this.abortError(stage);
    }
  }

  abortError(stage: MercadoLivreOperationStage) {
    const reason = this.signal.reason;
    if (isMercadoLivreOperationError(reason)) return reason;
    return new MercadoLivreOperationError({
      kind: this.clientSignal?.aborted ? "client_abort" : "operation_deadline",
      operationId: this.operationId,
      stage,
      durationMs: this.elapsedMs()
    });
  }

  abortReason() {
    const reason = this.signal.reason;
    return isMercadoLivreOperationError(reason) ? reason.kind : null;
  }

  async measure<T>(stage: MercadoLivreOperationStage, task: () => Promise<T>) {
    this.assertCanStart(stage);
    const startedAt = this.clock.now();
    try {
      const value = await task();
      this.assertCanContinue(stage);
      return value;
    } finally {
      const durationMs = Math.max(0, this.clock.now() - startedAt);
      this.stageDurations.set(stage, (this.stageDurations.get(stage) ?? 0) + durationMs);
    }
  }

  measureSync<T>(stage: MercadoLivreOperationStage, task: () => T) {
    this.assertCanStart(stage);
    const startedAt = this.clock.now();
    try {
      const value = task();
      this.assertCanContinue(stage);
      return value;
    } finally {
      const durationMs = Math.max(0, this.clock.now() - startedAt);
      this.stageDurations.set(stage, (this.stageDurations.get(stage) ?? 0) + durationMs);
    }
  }

  measureFinalSync<T>(task: () => T) {
    const startedAt = this.clock.now();
    try {
      return task();
    } finally {
      const durationMs = Math.max(0, this.clock.now() - startedAt);
      this.stageDurations.set("serialize", (this.stageDurations.get("serialize") ?? 0) + durationMs);
    }
  }

  recordRetry() {
    this.retryCount += 1;
  }

  recordTimeout() {
    this.timeoutCount += 1;
  }

  finish(outcome: OperationOutcome, partial: boolean) {
    if (this.finished) return;
    this.finished = true;
    const summary = {
      event: "mercado_livre_listing_operation",
      operationId: this.operationId,
      outcome,
      abortReason: outcome === "client_abort" || outcome === "operation_deadline" ? outcome : null,
      budgetMs: this.budgetMs,
      durationMs: this.elapsedMs(),
      deadlineRemainingMs: this.remainingMs(),
      retryCount: this.retryCount,
      timeoutCount: this.timeoutCount,
      partial,
      stages: Object.fromEntries(this.stageDurations)
    };
    if (outcome === "operation_deadline" || outcome === "failed") console.warn(summary);
    else console.info(summary);
  }

  dispose() {
    this.clock.clearTimer(this.timer);
    this.clientSignal?.removeEventListener("abort", this.abortFromClient);
  }
}

export function createMercadoLivreReadOperation(input: ConstructorParameters<typeof MercadoLivreReadOperation>[0] = {}) {
  return new MercadoLivreReadOperation(input);
}

export function getMercadoLivreOperationForSignal(signal?: AbortSignal) {
  return signal ? operationBySignal.get(signal) : undefined;
}
