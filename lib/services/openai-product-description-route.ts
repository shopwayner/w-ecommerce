import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import {
  consumeSettingsRateLimit,
  type RateLimitResult
} from "@/lib/security/settings-rate-limit";
import {
  generateOpenAIProductDescription,
  OpenAIProductDescriptionError,
  type OpenAIProductDescriptionResult,
  type OpenAIProductDescriptionLogEvent,
  type OpenAIProductDescriptionLogger,
  type ProductDescriptionSource
} from "@/lib/services/openai-product-description-service";

type RouteAuthResult =
  | {
      ok: true;
      context: {
        organizationId: string;
        user: { id: string };
      };
    }
  | { ok: false; response: NextResponse };

type ProductDescriptionRouteDependencies = {
  authenticate: () => Promise<RouteAuthResult>;
  findProduct: (
    productId: string,
    organizationId: string
  ) => Promise<ProductDescriptionSource | null>;
  consumeRateLimit: (
    key: string,
    options: { limit: number; windowMs: number }
  ) => RateLimitResult;
  generateDescription: (
    input: { product: ProductDescriptionSource },
    context: {
      correlationId: string;
      logger: OpenAIProductDescriptionLogger;
    }
  ) => Promise<OpenAIProductDescriptionResult>;
  acquireRequestLock: (key: string) => (() => void) | null;
  createCorrelationId: () => string;
  logger: OpenAIProductDescriptionLogger;
};

function jsonText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function firstJsonText(value: unknown, keys: readonly string[]) {
  for (const key of keys) {
    const result = jsonText(value, key);
    if (result) return result;
  }
  return null;
}

function decimalText(value: { toString(): string } | null) {
  return value === null ? null : value.toString();
}

function logProductDescriptionAiEvent(event: OpenAIProductDescriptionLogEvent) {
  console.info("[openai.product-description]", event);
}

const activeProductDescriptionRequests = new Set<string>();

function acquireProductDescriptionRequestLock(key: string) {
  if (activeProductDescriptionRequests.has(key)) return null;
  activeProductDescriptionRequests.add(key);
  return () => activeProductDescriptionRequests.delete(key);
}

const defaultDependencies: ProductDescriptionRouteDependencies = {
  authenticate: async () => requireApiAuth("products:write") as Promise<RouteAuthResult>,
  findProduct: async (productId, organizationId) => {
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: {
        name: true,
        sku: true,
        ean: true,
        packagingGtin: true,
        brand: true,
        category: true,
        ncm: true,
        source: true,
        description: true,
        condition: true,
        format: true,
        productType: true,
        commercialStatus: true,
        productionType: true,
        expirationDate: true,
        freeShipping: true,
        volumes: true,
        itemsPerBox: true,
        weight: true,
        grossWeight: true,
        height: true,
        width: true,
        depth: true,
        dimensionUnit: true,
        attributes: true,
        blockedFields: true
      }
    });
    if (!product) return null;
    return {
      name: product.name,
      sku: product.sku,
      gtin: product.ean,
      packagingGtin: product.packagingGtin,
      brand: product.brand,
      category: product.category,
      ncm: product.ncm,
      origin:
        jsonText(product.blockedFields, "origin") ??
        jsonText(product.attributes, "origin") ??
        product.source,
      currentDescription: product.description,
      unit:
        jsonText(product.blockedFields, "unit") ??
        jsonText(product.attributes, "unit"),
      condition: product.condition,
      model: firstJsonText(product.attributes, ["model", "modelo"]),
      manufacturerSku: firstJsonText(product.attributes, [
        "manufacturerSku",
        "manufacturerCode",
        "codigoFabricante",
        "codigo_fabricante",
        "referencia"
      ]),
      format: product.format,
      productType: product.productType,
      commercialStatus: product.commercialStatus,
      productionType: product.productionType,
      expirationDate: product.expirationDate?.toISOString().slice(0, 10) ?? null,
      freeShipping: product.freeShipping,
      volumes: product.volumes === null ? null : String(product.volumes),
      itemsPerBox: decimalText(product.itemsPerBox),
      weight: decimalText(product.weight),
      grossWeight: decimalText(product.grossWeight),
      height: decimalText(product.height),
      width: decimalText(product.width),
      depth: decimalText(product.depth),
      dimensionUnit: product.dimensionUnit,
      attributes: product.attributes
    };
  },
  consumeRateLimit: consumeSettingsRateLimit,
  generateDescription: (input, context) => generateOpenAIProductDescription(
    input,
    {
      correlationId: context.correlationId,
      logger: context.logger
    }
  ),
  createCorrelationId: randomUUID,
  logger: logProductDescriptionAiEvent,
  acquireRequestLock: acquireProductDescriptionRequestLock
};

const requestSchema = z.object({}).strict();
const MAX_REQUEST_BODY_BYTES = 100_000;

async function validateRequestBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Requisição inválida." },
        { status: 413 }
      )
    };
  }

  const rawBody = request.body ? await request.text() : "";
  if (!rawBody.trim()) return { ok: true as const, value: {} };
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BODY_BYTES) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Requisição inválida." },
        { status: 413 }
      )
    };
  }

  try {
    const parsed = requestSchema.safeParse(JSON.parse(rawBody));
    return parsed.success
      ? { ok: true as const, value: parsed.data }
      : {
          ok: false as const,
          response: NextResponse.json(
            { error: "Requisição inválida." },
            { status: 400 }
          )
        };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Requisição inválida." },
        { status: 400 }
      )
    };
  }
}

function productDescriptionErrorResponse(
  error: OpenAIProductDescriptionError,
  correlationId: string
) {
  const publicCode = error.code === "OPENAI_API_KEY_MISSING"
    ? "OPENAI_DESCRIPTION_CONFIGURATION_UNAVAILABLE"
    : error.diagnostic.code;
  const errorBody = (message: string) => ({
    code: publicCode,
    category: error.code,
    correlationId,
    error: message
  });
  if (error.code === "OPENAI_DESCRIPTION_DISABLED") {
    return NextResponse.json(
      errorBody("Geração de descrição com IA está temporariamente desativada."),
      { status: 503 }
    );
  }
  if (error.code === "OPENAI_API_KEY_MISSING") {
    return NextResponse.json(
      errorBody("Geração de descrição com IA está temporariamente desativada."),
      { status: 503 }
    );
  }
  if (error.code === "OPENAI_DESCRIPTION_INVALID_INPUT") {
    return NextResponse.json(
      errorBody(error.message),
      { status: 422 }
    );
  }
  if (error.code === "OPENAI_DESCRIPTION_TIMEOUT") {
    return NextResponse.json(
      errorBody("A geração demorou mais que o esperado. Tente novamente."),
      { status: 504 }
    );
  }
  if (error.code === "OPENAI_DESCRIPTION_RATE_LIMITED") {
    return NextResponse.json(
      errorBody("A geração está temporariamente limitada. Aguarde e tente novamente."),
      { status: 429 }
    );
  }
  return NextResponse.json(
    errorBody("Não foi possível gerar uma descrição válida. Tente novamente."),
    { status: 502 }
  );
}

export function createProductDescriptionAiPost(
  overrides: Partial<ProductDescriptionRouteDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function postProductDescriptionAi(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const auth = await dependencies.authenticate();
    if (!auth.ok) return auth.response;

    const requestBody = await validateRequestBody(request);
    if (!requestBody.ok) return requestBody.response;

    const { id } = await params;
    const rateLimit = dependencies.consumeRateLimit(
      `openai:description:${auth.context.organizationId}:${auth.context.user.id}:${id}`,
      { limit: 3, windowMs: 10 * 60 * 1_000 }
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          code: "OPENAI_DESCRIPTION_RATE_LIMITED",
          error: "Muitas gerações em pouco tempo. Aguarde antes de tentar novamente."
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) }
        }
      );
    }

    const product = await dependencies.findProduct(
      id,
      auth.context.organizationId
    );
    if (!product) {
      return NextResponse.json(
        { code: "PRODUCT_NOT_FOUND", error: "Produto não encontrado." },
        { status: 404 }
      );
    }

    const requestKey = [
      auth.context.organizationId,
      auth.context.user.id,
      id
    ].join(":");
    const releaseRequestLock = dependencies.acquireRequestLock(requestKey);
    if (!releaseRequestLock) {
      return NextResponse.json(
        {
          code: "OPENAI_DESCRIPTION_GENERATION_FAILED",
          error: "Já existe uma geração de descrição em andamento para este produto."
        },
        { status: 409 }
      );
    }

    const correlationId = dependencies.createCorrelationId();
    try {
      const result = await dependencies.generateDescription(
        { product },
        {
          correlationId,
          logger: (event) => dependencies.logger({
            ...event,
            productId: id,
            organizationId: auth.context.organizationId,
            userId: auth.context.user.id
          })
        }
      );
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof OpenAIProductDescriptionError) {
        return productDescriptionErrorResponse(error, correlationId);
      }
      return NextResponse.json(
        {
          code: "OPENAI_DESCRIPTION_GENERATION_FAILED",
          correlationId,
          error: "Não foi possível gerar uma descrição válida. Tente novamente."
        },
        { status: 502 }
      );
    } finally {
      releaseRequestLock();
    }
  };
}
