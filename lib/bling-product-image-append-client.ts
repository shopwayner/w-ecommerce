export const BLING_IMAGE_APPEND_DISABLED_MESSAGE =
  "Adicionar fotos ao Bling está temporariamente desativado.";
export const BLING_IMAGE_APPEND_PREVIEW_EXPIRED_MESSAGE =
  "A prévia expirou. Revise as fotos novamente antes de enviar.";
export const BLING_IMAGE_APPEND_NOT_STARTED_MESSAGE =
  "Não foi possível iniciar o envio das fotos.";
export const BLING_IMAGE_APPEND_SENDING_MESSAGE =
  "Enviando fotos ao Bling...";
export const BLING_IMAGE_APPEND_VERIFICATION_MESSAGE =
  "O envio pode ter sido concluído. Verifique novamente antes de tentar.";

type ImageAppendButtonStateInput = {
  appendPlanValid: boolean;
  busy: boolean;
  completed: boolean;
  confirmationToken: string | null | undefined;
  imagesPatchEnabled: boolean;
  previewMatchesSelection: boolean;
  retryBlocked: boolean;
  safeToExecute: boolean;
  selectedImageCount: number;
  canUpdate: boolean;
};

export function getBlingImageAppendButtonState(input: ImageAppendButtonStateInput) {
  if (!input.imagesPatchEnabled) {
    return { enabled: false, message: BLING_IMAGE_APPEND_DISABLED_MESSAGE };
  }
  if (input.busy) {
    return { enabled: false, message: BLING_IMAGE_APPEND_SENDING_MESSAGE };
  }
  if (input.completed || input.retryBlocked) {
    return { enabled: false, message: BLING_IMAGE_APPEND_NOT_STARTED_MESSAGE };
  }
  if (!input.selectedImageCount) {
    return { enabled: false, message: "Selecione pelo menos uma foto nova." };
  }
  if (
    !input.previewMatchesSelection
    || !input.confirmationToken
    || !input.appendPlanValid
    || !input.canUpdate
    || !input.safeToExecute
  ) {
    return { enabled: false, message: BLING_IMAGE_APPEND_PREVIEW_EXPIRED_MESSAGE };
  }
  return { enabled: true, message: "" };
}

type ImageAppendResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type ImageAppendFetch = (
  input: string,
  init: RequestInit
) => Promise<ImageAppendResponse>;

type ImageAppendRequestState = {
  current: boolean;
};

type ConfirmBlingImageAppendInput = {
  busy: boolean;
  connectionId: string | null;
  productId: string | null;
  images: string[];
  confirmationToken: string | null | undefined;
  idempotencyKey: string | null | undefined;
  imagesPatchEnabled: boolean;
  completed: boolean;
  requestState: ImageAppendRequestState;
  fetchImpl?: ImageAppendFetch;
  onRequestStart?: () => void;
};

type ConfirmBlingImageAppendOutcome<TResult> =
  | {
      kind: "BLOCKED";
      code: "CAPABILITY_DISABLED" | "IN_FLIGHT" | "PRECONDITION_FAILED" | "PREVIEW_EXPIRED";
      message: string;
      requestStarted: false;
    }
  | {
      kind: "REJECTED";
      message: string;
      requestStarted: true;
      status: number;
      code: string | null;
    }
  | {
      kind: "VERIFICATION_REQUIRED";
      message: string;
      requestStarted: true;
    }
  | {
      kind: "SUCCESS";
      result: TResult;
      requestStarted: true;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readResponseError(payload: unknown) {
  if (!isRecord(payload)) return { code: null, message: null };
  const code = typeof payload.code === "string" ? payload.code : null;
  const message = typeof payload.error === "string" ? payload.error : null;
  return { code, message };
}

function isExpiredPreviewError(status: number, code: string | null, message: string | null) {
  if (code === "IMAGES_DRY_RUN_BLOCKED") return true;
  const normalizedMessage = message?.toLocaleLowerCase("pt-BR") ?? "";
  return (
    status === 409
    && (
      normalizedMessage.includes("prévia")
      || normalizedMessage.includes("previa")
      || normalizedMessage.includes("confirma")
      || normalizedMessage.includes("galeria")
    )
  );
}

export async function confirmBlingImageAppend<TResult = Record<string, unknown>>(
  input: ConfirmBlingImageAppendInput
): Promise<ConfirmBlingImageAppendOutcome<TResult>> {
  if (!input.imagesPatchEnabled) {
    return {
      kind: "BLOCKED",
      code: "CAPABILITY_DISABLED",
      message: BLING_IMAGE_APPEND_DISABLED_MESSAGE,
      requestStarted: false
    };
  }
  if (input.busy || input.requestState.current) {
    return {
      kind: "BLOCKED",
      code: "IN_FLIGHT",
      message: BLING_IMAGE_APPEND_SENDING_MESSAGE,
      requestStarted: false
    };
  }
  if (
    !input.connectionId
    || !input.productId
    || !input.images.length
    || input.completed
  ) {
    return {
      kind: "BLOCKED",
      code: "PRECONDITION_FAILED",
      message: BLING_IMAGE_APPEND_NOT_STARTED_MESSAGE,
      requestStarted: false
    };
  }
  if (!input.idempotencyKey || !input.confirmationToken) {
    return {
      kind: "BLOCKED",
      code: "PREVIEW_EXPIRED",
      message: BLING_IMAGE_APPEND_PREVIEW_EXPIRED_MESSAGE,
      requestStarted: false
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  input.requestState.current = true;
  input.onRequestStart?.();
  try {
    const response = await fetchImpl("/api/products/bling/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: input.connectionId,
        productId: input.productId,
        operation: "IMAGES_ONLY_APPEND",
        fields: { images: input.images },
        confirmed: true,
        idempotencyKey: input.idempotencyKey,
        imageAppendConfirmation: input.confirmationToken
      })
    });
    const payload = await response.json().catch(() => ({}));
    const responseError = readResponseError(payload);
    const result = isRecord(payload)
      && isRecord(payload.data)
      && isRecord(payload.data.item)
      ? payload.data.item as TResult
      : null;

    if (!response.ok || !result) {
      const message = isExpiredPreviewError(
        response.status,
        responseError.code,
        responseError.message
      )
        ? BLING_IMAGE_APPEND_PREVIEW_EXPIRED_MESSAGE
        : responseError.message ?? "Não foi possível adicionar as fotos no Bling agora.";
      return {
        kind: "REJECTED",
        message,
        requestStarted: true,
        status: response.status,
        code: responseError.code
      };
    }
    return {
      kind: "SUCCESS",
      result,
      requestStarted: true
    };
  } catch {
    return {
      kind: "VERIFICATION_REQUIRED",
      message: BLING_IMAGE_APPEND_VERIFICATION_MESSAGE,
      requestStarted: true
    };
  } finally {
    input.requestState.current = false;
  }
}
