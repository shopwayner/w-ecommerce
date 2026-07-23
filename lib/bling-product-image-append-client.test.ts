import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BLING_IMAGE_APPEND_DISABLED_MESSAGE,
  BLING_IMAGE_APPEND_PREVIEW_EXPIRED_MESSAGE,
  BLING_IMAGE_APPEND_SENDING_MESSAGE,
  confirmBlingImageAppend,
  getBlingImageAppendButtonState,
  type ImageAppendFetch
} from "./bling-product-image-append-client";

const selectedImage = "https://cdn.example.com/new-photo.jpg";

function enabledButtonState(selectedImageCount = 1) {
  return getBlingImageAppendButtonState({
    appendPlanValid: true,
    busy: false,
    canUpdate: true,
    completed: false,
    confirmationToken: "confirmation-token",
    imagesPatchEnabled: true,
    previewMatchesSelection: true,
    retryBlocked: false,
    safeToExecute: true,
    selectedImageCount
  });
}

function requestInput(fetchImpl: ImageAppendFetch) {
  return {
    busy: false,
    completed: false,
    confirmationToken: "confirmation-token",
    connectionId: "connection-1",
    fetchImpl,
    idempotencyKey: "idempotency-key-1",
    images: [selectedImage],
    imagesPatchEnabled: true,
    productId: "product-1",
    requestState: { current: false },
    onRequestStart: () => undefined
  };
}

test("keeps the final button disabled without selection and enables it after a valid preview", () => {
  assert.equal(enabledButtonState(0).enabled, false);
  assert.equal(enabledButtonState(1).enabled, true);
  assert.equal(
    getBlingImageAppendButtonState({
      ...enabledButtonStateInput(),
      canUpdate: false
    }).enabled,
    false
  );
  assert.equal(
    getBlingImageAppendButtonState({
      ...enabledButtonStateInput(),
      safeToExecute: false
    }).enabled,
    false
  );
});

test("sends exactly one confirmed internal request with the reviewed image payload", async () => {
  const requests: Array<{ input: string; init: RequestInit }> = [];
  const fetchImpl: ImageAppendFetch = async (input, init) => {
    requests.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          item: {
            productId: "product-1",
            status: "UPDATED",
            message: "Foto adicionada.",
            fields: ["images"]
          }
        }
      })
    };
  };
  let sendingMessage = "";
  const outcome = await confirmBlingImageAppend({
    ...requestInput(fetchImpl),
    onRequestStart: () => {
      sendingMessage = BLING_IMAGE_APPEND_SENDING_MESSAGE;
    }
  });

  assert.equal(outcome.kind, "SUCCESS");
  assert.equal(sendingMessage, "Enviando fotos ao Bling...");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/products/bling/update");
  assert.equal(requests[0]?.init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    connectionId: "connection-1",
    productId: "product-1",
    operation: "IMAGES_ONLY_APPEND",
    fields: { images: [selectedImage] },
    confirmed: true,
    idempotencyKey: "idempotency-key-1",
    imageAppendConfirmation: "confirmation-token"
  });
});

test("blocks a double click while the first internal request is in flight", async () => {
  let calls = 0;
  let resolveResponse: ((value: Awaited<ReturnType<ImageAppendFetch>>) => void) | undefined;
  const fetchImpl: ImageAppendFetch = async () => {
    calls += 1;
    return await new Promise((resolve) => {
      resolveResponse = resolve;
    });
  };
  const input = requestInput(fetchImpl);

  const first = confirmBlingImageAppend(input);
  const second = await confirmBlingImageAppend(input);
  assert.equal(second.kind, "BLOCKED");
  if (second.kind === "BLOCKED") assert.equal(second.code, "IN_FLIGHT");
  assert.equal(second.requestStarted, false);
  assert.equal(calls, 1);

  resolveResponse?.({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        item: {
          productId: "product-1",
          status: "UPDATED",
          message: "Foto adicionada.",
          fields: ["images"]
        }
      }
    })
  });
  assert.equal((await first).kind, "SUCCESS");
  assert.equal(calls, 1);
});

test("blocks the request when the image capability is disabled", async () => {
  let calls = 0;
  const fetchImpl: ImageAppendFetch = async () => {
    calls += 1;
    throw new Error("must not run");
  };
  const outcome = await confirmBlingImageAppend({
    ...requestInput(fetchImpl),
    imagesPatchEnabled: false
  });

  assert.equal(outcome.kind, "BLOCKED");
  if (outcome.kind === "BLOCKED") assert.equal(outcome.code, "CAPABILITY_DISABLED");
  assert.equal(outcome.message, BLING_IMAGE_APPEND_DISABLED_MESSAGE);
  assert.equal(calls, 0);
});

test("maps an expired confirmation to a new-preview message without retrying", async () => {
  let calls = 0;
  const fetchImpl: ImageAppendFetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 409,
      json: async () => ({
        error: "A confirmacao da galeria expirou.",
        code: "IMAGES_DRY_RUN_BLOCKED"
      })
    };
  };
  const outcome = await confirmBlingImageAppend(requestInput(fetchImpl));

  assert.equal(outcome.kind, "REJECTED");
  assert.equal(outcome.message, BLING_IMAGE_APPEND_PREVIEW_EXPIRED_MESSAGE);
  assert.equal(calls, 1);
});

test("shows a sanitized backend failure and never treats a response without a result as success", async () => {
  const selectedImages = [selectedImage];
  const backendInput = {
    ...requestInput(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Revise a galeria e tente novamente.", code: "IMAGES_REJECTED" })
    })),
    images: selectedImages
  };
  const backendFailure = await confirmBlingImageAppend(backendInput);
  assert.deepEqual(backendInput.images, selectedImages);
  assert.equal(backendFailure.kind, "REJECTED");
  assert.equal(backendFailure.message, "Revise a galeria e tente novamente.");

  const missingResult = await confirmBlingImageAppend(requestInput(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: {} })
  })));
  assert.equal(missingResult.kind, "REJECTED");
});

test("keeps preview and final actions visually distinct and retains backend authorization guards", () => {
  const modalSource = readFileSync(
    path.join(process.cwd(), "components/bling-product-update-modal.tsx"),
    "utf8"
  );
  const routeSource = readFileSync(
    path.join(process.cwd(), "app/api/products/bling/update/route.ts"),
    "utf8"
  );

  assert.equal((modalSource.match(/>\s*Gerar prévia das fotos\s*</g) ?? []).length, 1);
  assert.equal(
    (modalSource.match(/\{busy \? "Enviando fotos ao Bling\.\.\." : "Adicionar fotos ao Bling"\}/g) ?? []).length,
    1
  );
  assert.match(modalSource, /aria-label="Gerar prévia das fotos sem enviar ao Bling"/);
  assert.match(modalSource, /aria-label="Confirmar e enviar as fotos selecionadas ao Bling"/);
  assert.match(
    modalSource,
    /A próxima ação, Adicionar fotos ao Bling, realizará uma atualização real quando estiver habilitada\./
  );
  assert.doesNotMatch(modalSource, /Confirmar e adicionar fotos/);
  assert.match(routeSource, /requireApiAuth\("products:write"\)/);
  assert.match(routeSource, /can\(auth\.context\.role, "integrations:write"\)/);
  assert.match(routeSource, /auth\.context\.role !== "OWNER"/);
  assert.match(routeSource, /auth\.context\.role !== "ADMIN"/);
});

function enabledButtonStateInput() {
  return {
    appendPlanValid: true,
    busy: false,
    canUpdate: true,
    completed: false,
    confirmationToken: "confirmation-token",
    imagesPatchEnabled: true,
    previewMatchesSelection: true,
    retryBlocked: false,
    safeToExecute: true,
    selectedImageCount: 1
  };
}
