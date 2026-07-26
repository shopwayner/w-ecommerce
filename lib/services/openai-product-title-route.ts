import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { normalizeProductBrand } from "@/lib/product-brand";
import { prisma } from "@/lib/prisma";
import { consumeSettingsRateLimit, type RateLimitResult } from "@/lib/security/settings-rate-limit";
import {
  generateOpenAIProductTitleSuggestions,
  OpenAIProductTitleError,
  type ProductTitleSuggestion
} from "@/lib/services/openai-product-title-service";

type RouteAuthResult =
  | {
      ok: true;
      context: {
        organizationId: string;
        user: { id: string };
      };
    }
  | { ok: false; response: NextResponse };

type ProductTitleSource = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
};

type ProductTitleRouteDependencies = {
  authenticate: () => Promise<RouteAuthResult>;
  findProduct: (productId: string, organizationId: string) => Promise<ProductTitleSource | null>;
  consumeRateLimit: (
    key: string,
    options: { limit: number; windowMs: number }
  ) => RateLimitResult;
  generateSuggestions: (input: {
    currentTitle: string;
    brand: string | null;
    category: string | null;
  }) => Promise<ProductTitleSuggestion[]>;
};

const defaultDependencies: ProductTitleRouteDependencies = {
  authenticate: async () => requireApiAuth("products:write") as Promise<RouteAuthResult>,
  findProduct: (productId, organizationId) => prisma.product.findFirst({
    where: { id: productId, organizationId },
    select: { id: true, name: true, brand: true, category: true }
  }),
  consumeRateLimit: consumeSettingsRateLimit,
  generateSuggestions: generateOpenAIProductTitleSuggestions
};

const emptyRequestSchema = z.object({}).strict();
const MAX_REQUEST_BODY_BYTES = 1_024;

async function validateRequestBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json({ error: "Requisicao invalida." }, { status: 413 });
  }

  const rawBody = request.body ? await request.text() : "";
  if (!rawBody.trim()) return null;
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json({ error: "Requisicao invalida." }, { status: 413 });
  }

  try {
    const parsed = emptyRequestSchema.safeParse(JSON.parse(rawBody));
    return parsed.success
      ? null
      : NextResponse.json({ error: "Esta operacao nao aceita campos adicionais." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Requisicao invalida." }, { status: 400 });
  }
}

function productTitleErrorResponse(error: OpenAIProductTitleError) {
  if (["FEATURE_DISABLED", "MISSING_API_KEY", "MISSING_MODEL"].includes(error.code)) {
    return NextResponse.json(
      { error: "Melhoria de título com IA está temporariamente desativada." },
      { status: 503 }
    );
  }
  if (error.code === "INVALID_INPUT") {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  if (error.code === "TIMEOUT") {
    return NextResponse.json(
      { error: "A geracao demorou mais que o esperado. Tente novamente." },
      { status: 504 }
    );
  }
  return NextResponse.json(
    { error: "Nao foi possivel gerar sugestoes validas. Tente novamente." },
    { status: 502 }
  );
}

export function createProductTitleAiPost(
  overrides: Partial<ProductTitleRouteDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function postProductTitleAi(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const auth = await dependencies.authenticate();
    if (!auth.ok) return auth.response;

    const invalidBodyResponse = await validateRequestBody(request);
    if (invalidBodyResponse) return invalidBodyResponse;

    const { id } = await params;
    const rateLimit = dependencies.consumeRateLimit(
      `openai:title:${auth.context.organizationId}:${auth.context.user.id}:${id}`,
      { limit: 5, windowMs: 10 * 60 * 1_000 }
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Muitas geracoes em pouco tempo. Aguarde antes de tentar novamente." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) }
        }
      );
    }

    const product = await dependencies.findProduct(id, auth.context.organizationId);
    if (!product) {
      return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
    }

    try {
      const suggestions = await dependencies.generateSuggestions({
        currentTitle: product.name,
        brand: normalizeProductBrand(product.brand),
        category: product.category
      });
      return NextResponse.json({ suggestions });
    } catch (error) {
      if (error instanceof OpenAIProductTitleError) {
        return productTitleErrorResponse(error);
      }
      return NextResponse.json(
        { error: "Nao foi possivel gerar sugestoes validas. Tente novamente." },
        { status: 502 }
      );
    }
  };
}
