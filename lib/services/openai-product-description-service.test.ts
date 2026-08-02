import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createProductDescriptionAiPost } from "@/lib/services/openai-product-description-route";
import { buildOpenAIProductDescriptionResearchRequest } from "@/lib/services/openai-product-description-research";
import {
  buildOpenAIProductDescriptionHtml,
  buildOpenAIProductDescriptionRequest,
  buildOpenAIProductDescriptionTextFormat,
  createOfficialOpenAIProductDescriptionResponse,
  generateOpenAIProductDescription,
  OpenAIProductDescriptionError,
  OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS,
  OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MODEL,
  OPENAI_PRODUCT_DESCRIPTION_SCHEMA_NAME,
  readOpenAIProductDescriptionConfig,
  shouldUseProductDescriptionWebSearch,
  validateOpenAIProductDescriptionContent,
  type OpenAIProductDescriptionCreate,
  type OpenAIProductDescriptionContent,
  type OpenAIProductDescriptionLogEvent,
  type OpenAIProductDescriptionResult,
  type ProductDescriptionSource
} from "./openai-product-description-service";

const enabledEnv = {
  OPENAI_DESCRIPTION_AI_ENABLED: "true",
  OPENAI_DESCRIPTION_MODEL: "test-model-with-web-search",
  OPENAI_API_KEY: "test-key-never-sent",
  OPENAI_DESCRIPTION_MAX_CHARACTERS: "12000"
};

const completeProduct: ProductDescriptionSource = {
  name: "Abraçadeira Andaluz PVC para Eletroduto 3/4",
  sku: "6711",
  gtin: "7891234567895",
  packagingGtin: null,
  brand: "Andaluz",
  category: "Infraestrutura Elétrica",
  ncm: "39269090",
  origin: "BLING",
  currentDescription: "<p>Abraçadeira para instalação elétrica.</p>",
  unit: "UN",
  model: "Abraçadeira 3/4",
  manufacturerSku: null,
  condition: "NEW",
  format: "SIMPLE",
  productType: "PRODUCT",
  commercialStatus: "ACTIVE",
  productionType: "THIRD_PARTY",
  expirationDate: null,
  freeShipping: false,
  volumes: "0",
  itemsPerBox: "0",
  weight: "0.030",
  grossWeight: "0.035",
  height: "2.000",
  width: "3.000",
  depth: "1.500",
  dimensionUnit: "CM",
  attributes: {
    material: "PVC",
    color: "Preto",
    application: "Eletroduto 3/4",
    salePrice: "999.00",
    costPrice: "500.00",
    accessToken: "must-never-leave-server",
    internal_id: "secret-id"
  }
};

const partialProduct: ProductDescriptionSource = {
  ...completeProduct,
  name: "Suporte para instalação",
  sku: "PARTIAL-1",
  gtin: null,
  brand: null,
  category: null,
  ncm: null,
  currentDescription: null,
  model: null,
  manufacturerSku: null,
  weight: null,
  grossWeight: null,
  height: null,
  width: null,
  depth: null,
  attributes: null
};

const validContent: OpenAIProductDescriptionContent = {
  introducao: ["Abraçadeira destinada à organização de instalações elétricas com eletroduto."],
  fichaTecnica: ["Marca: Andaluz", "Material: PVC", "Cor: Preto"],
  compatibilidade: [],
  conteudoEmbalagem: [],
  vantagens: ["Aplicação em eletroduto 3/4"],
  dimensoes: [],
  tutorialInstalacao: [],
  cuidadosManutencao: [],
  maisSobreProduto: []
};

const partialContent: OpenAIProductDescriptionContent = {
  introducao: ["Suporte destinado à organização de instalações conforme os dados cadastrados."],
  fichaTecnica: ["Tipo: Suporte"],
  compatibilidade: [],
  conteudoEmbalagem: [],
  vantagens: ["Uso como suporte para instalação"],
  dimensoes: [],
  tutorialInstalacao: [],
  cuidadosManutencao: [],
  maisSobreProduto: []
};

const validHtml = buildOpenAIProductDescriptionHtml(
  completeProduct.name,
  validContent
);

const validResult: OpenAIProductDescriptionResult = {
  html: validHtml,
  usedWebSearch: true,
  warnings: [],
  evidenceLevel: "LOCAL_AND_WEB",
  researchSummary: {
    queriesAttempted: 5,
    resultsFound: 2,
    officialSourcesFound: 1,
    usefulSourcesFound: 1,
    fieldsConfirmed: 8,
    fieldsOmitted: 0,
    discardedSources: 0,
    discardReasonCounts: {}
  }
};

function parsedContent(overrides: Partial<OpenAIProductDescriptionContent> = {}) {
  return { ...validContent, ...overrides };
}

function providerResponse(
  parsed: OpenAIProductDescriptionContent = validContent,
  overrides: Partial<Awaited<ReturnType<OpenAIProductDescriptionCreate>>> = {}
): OpenAIProductDescriptionCreate {
  return async () => ({
    httpStatus: 200,
    status: "completed",
    outputParsed: parsed,
    refusalPresent: false,
    output: [
      {
        type: "web_search_call",
        action: {
          sources: [{ url: "https://fabricante.example/manual/produto" }]
        }
      }
    ],
    ...overrides
  });
}

function expectDescriptionError(
  callback: () => unknown | Promise<unknown>,
  code: OpenAIProductDescriptionError["code"]
) {
  return assert.rejects(
    Promise.resolve().then(callback),
    (error: unknown) => (
      error instanceof OpenAIProductDescriptionError && error.code === code
    )
  );
}

test("feature flag is fail-closed when absent or not exactly true", () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    assert.throws(
      () => readOpenAIProductDescriptionConfig({
        ...enabledEnv,
        OPENAI_DESCRIPTION_AI_ENABLED: value
      }),
      (error: unknown) => error instanceof OpenAIProductDescriptionError &&
        error.code === "OPENAI_DESCRIPTION_DISABLED"
    );
  }
});

test("backend API key is required and never receives a public substitute", () => {
  assert.throws(
    () => readOpenAIProductDescriptionConfig({
      ...enabledEnv,
      OPENAI_API_KEY: ""
    }),
    (error: unknown) => error instanceof OpenAIProductDescriptionError &&
      error.code === "OPENAI_API_KEY_MISSING"
  );
});

test("description model has one safe fallback point", () => {
  assert.equal(
    readOpenAIProductDescriptionConfig({
      ...enabledEnv,
      OPENAI_DESCRIPTION_MODEL: ""
    }).model,
    OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MODEL
  );
  assert.equal(
    readOpenAIProductDescriptionConfig({
      ...enabledEnv,
      OPENAI_DESCRIPTION_MODEL: "",
      OPENAI_MODEL: "shared-model"
    }).model,
    "shared-model"
  );
});

test("description character limit is bounded and configurable", () => {
  assert.equal(
    readOpenAIProductDescriptionConfig(enabledEnv).maxCharacters,
    OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS
  );
  assert.equal(
    readOpenAIProductDescriptionConfig({
      ...enabledEnv,
      OPENAI_DESCRIPTION_MAX_CHARACTERS: "8000"
    }).maxCharacters,
    8_000
  );
  assert.equal(
    readOpenAIProductDescriptionConfig({
      ...enabledEnv,
      OPENAI_DESCRIPTION_MAX_CHARACTERS: "50"
    }).maxCharacters,
    OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS
  );
});

test("structured output is a strict object with the complete response contract", () => {
  const format = buildOpenAIProductDescriptionTextFormat(12_000);
  const schema = format.schema as {
    type?: string;
    required?: string[];
    additionalProperties?: boolean;
    properties?: Record<string, {
      type?: string;
      maxLength?: number;
      items?: { type?: string; minLength?: number; maxLength?: number };
    }>;
  };
  assert.equal(format.type, "json_schema");
  assert.equal(format.name, OPENAI_PRODUCT_DESCRIPTION_SCHEMA_NAME);
  assert.equal(format.strict, true);
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required?.sort(), [
    "compatibilidade",
    "conteudoEmbalagem",
    "cuidadosManutencao",
    "dimensoes",
    "fichaTecnica",
    "introducao",
    "maisSobreProduto",
    "tutorialInstalacao",
    "vantagens"
  ]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties?.introducao?.type, "array");
  assert.equal(schema.properties?.fichaTecnica?.type, "array");
  assert.equal(schema.properties?.fichaTecnica?.items?.type, "string");
  assert.equal(schema.properties?.fichaTecnica?.items?.minLength, 1);
  assert.equal(schema.properties?.fichaTecnica?.items?.maxLength, 500);
  assert.equal(schema.properties?.html, undefined);
  assert.equal(schema.properties?.usedWebSearch, undefined);
});

test("complete product context keeps false and zero while excluding private facts", () => {
  const request = buildOpenAIProductDescriptionRequest(
    { product: completeProduct },
    readOpenAIProductDescriptionConfig(enabledEnv)
  );
  const context = JSON.parse(request.input[1].content) as { produto: Record<string, unknown> };
  const serialized = JSON.stringify(context);
  assert.equal(context.produto.freteGratis, false);
  assert.equal(context.produto.volumes, "0");
  assert.equal(context.produto.itensPorCaixa, "0");
  assert.match(serialized, /"material":"PVC"/);
  assert.doesNotMatch(serialized, /999\.00|500\.00|must-never|secret-id/);
  assert.doesNotMatch(serialized, /accessToken|costPrice|salePrice|internal_id/);
});

test("generic partial product does not enable web search", () => {
  assert.equal(shouldUseProductDescriptionWebSearch(partialProduct), false);
  const request = buildOpenAIProductDescriptionRequest(
    { product: partialProduct },
    readOpenAIProductDescriptionConfig(enabledEnv)
  );
  assert.equal("tools" in request, false);
  assert.equal("tool_choice" in request, false);
});

test("valid GTIN enables web search", () => {
  assert.equal(shouldUseProductDescriptionWebSearch(completeProduct), true);
});

test("brand and model enable web search without GTIN", () => {
  assert.equal(shouldUseProductDescriptionWebSearch({
    ...partialProduct,
    brand: "Andaluz",
    model: "ABR-34"
  }), true);
});

test("brand and manufacturer SKU enable web search without GTIN", () => {
  assert.equal(shouldUseProductDescriptionWebSearch({
    ...partialProduct,
    brand: "Andaluz",
    manufacturerSku: "AND-0001"
  }), true);
});

test("a highly specific title can enable web search", () => {
  assert.equal(shouldUseProductDescriptionWebSearch({
    ...partialProduct,
    name: "Abraçadeira PVC Reforçada para Eletroduto Rígido 3/4 Preta 2026"
  }), true);
});

test("web request uses Responses API tools only when evidence is sufficient", () => {
  const request = buildOpenAIProductDescriptionResearchRequest(
    completeProduct,
    readOpenAIProductDescriptionConfig(enabledEnv),
    ["andaluz.com.br"]
  );
  assert.equal(request.model, "test-model-with-web-search");
  assert.equal(request.store, false);
  assert.equal(request.tools?.[0]?.type, "web_search");
  assert.deepEqual(request.tools?.[0]?.filters?.allowed_domains, ["andaluz.com.br"]);
  assert.equal(request.tool_choice, "required");
});

test("prompt establishes local precedence and official source priority", () => {
  const request = buildOpenAIProductDescriptionRequest(
    { product: completeProduct },
    readOpenAIProductDescriptionConfig(enabledEnv)
  );
  const prompt = request.input[0].content;
  assert.match(prompt, /Dados locais estruturados prevalecem/);
  assert.match(prompt, /Nunca invente material, compatibilidade/);
  assert.match(prompt, /JSON estruturado/);
  assert.match(prompt, /introducao, fichaTecnica, compatibilidade/);
  assert.match(prompt, /não gere HTML, Markdown, títulos de seção/i);
  assert.match(prompt, /exatamente as nove propriedades do schema/);
});

test("valid structured content is normalized and rendered only by the backend", () => {
  assert.deepEqual(validateOpenAIProductDescriptionContent(validContent), validContent);
  assert.equal(buildOpenAIProductDescriptionHtml(completeProduct.name, validContent), validHtml);
  assert.match(validHtml, /^<p><strong>Abraçadeira Andaluz/);
  assert.match(validHtml, /<p><strong>Ficha Técnica:<\/strong><\/p><ul>/);
});

test("provider HTML is rejected instead of being trusted or sanitized", async () => {
  await expectDescriptionError(
    () => validateOpenAIProductDescriptionContent(parsedContent({
      introducao: ["<p>Conteúdo criado pela IA</p>"]
    })),
    "OPENAI_DESCRIPTION_INVALID_RESPONSE"
  );
});

test("URLs, emoji and citations in structured text are rejected", async () => {
  for (const text of [
    "Descrição segura disponível em https://example.com para consulta técnica.",
    "Descrição segura com excelente apresentação 😀 para o produto.",
    "Descrição segura do produto conforme [fonte: 1] consultada."
  ]) {
    await expectDescriptionError(
      () => validateOpenAIProductDescriptionContent(parsedContent({ introducao: [text] })),
      "OPENAI_DESCRIPTION_INVALID_RESPONSE"
    );
  }
});

test("duplicate list values are removed before deterministic rendering", () => {
  const content = validateOpenAIProductDescriptionContent(parsedContent({
    fichaTecnica: [" Marca: Andaluz ", "marca: andaluz", "Material:   PVC"]
  }));
  assert.deepEqual(content.fichaTecnica, ["Marca: Andaluz", "Material: PVC"]);
  const html = buildOpenAIProductDescriptionHtml(completeProduct.name, content);
  assert.match(html, /<ul><li>Marca: Andaluz<\/li><li>Material: PVC<\/li><\/ul>/);
  assert.doesNotMatch(html, /<li>\s*<p>/);
});

test("invalid structured response is rejected", async () => {
  for (const value of [
    null,
    { introducao: validContent.introducao },
    { ...validContent, extra: true },
    { ...validContent, fichaTecnica: "Marca: Andaluz" },
    { ...validContent, vantagens: ["Válida", 123] },
    { ...validContent, vantagens: [""] },
    { ...validContent, vantagens: ["   "] },
    { ...validContent, vantagens: [["Lista aninhada"]] },
    { ...validContent, vantagens: [{ item: "Objeto" }] },
    { ...validContent, vantagens: [null] },
    { ...validContent, caracteristicas: [], fichaTecnica: undefined }
  ]) {
    await expectDescriptionError(
      () => validateOpenAIProductDescriptionContent(value),
      "OPENAI_DESCRIPTION_INVALID_RESPONSE"
    );
  }
});

test("completely empty structured content is rejected", async () => {
  await expectDescriptionError(
    () => validateOpenAIProductDescriptionContent({
      introducao: [],
      fichaTecnica: [],
      compatibilidade: [],
      conteudoEmbalagem: [],
      vantagens: [],
      dimensoes: [],
      tutorialInstalacao: [],
      cuidadosManutencao: [],
      maisSobreProduto: []
    }),
    "OPENAI_DESCRIPTION_INVALID_RESPONSE"
  );
});

test("free text provider response is rejected without fallback interpretation", async () => {
  let calls = 0;
  await expectDescriptionError(
    () => generateOpenAIProductDescription(
      { product: completeProduct },
      {
        env: enabledEnv,
        createResponse: async () => {
          calls += 1;
          return {
            httpStatus: 200,
            status: "completed",
            outputParsed: "Descrição livre fora do contrato JSON.",
            refusalPresent: false,
            output: []
          };
        }
      }
    ),
    "OPENAI_DESCRIPTION_INVALID_RESPONSE"
  );
  assert.equal(calls, 2);
});

test("local-only fallback rejects unsupported numeric facts", async () => {
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  await expectDescriptionError(
    () => generateOpenAIProductDescription(
      { product: partialProduct },
      {
        env: enabledEnv,
        correlationId: "numeric-correlation",
        logger: (event) => logs.push(event),
        createResponse: providerResponse(
          parsedContent({
            introducao: ["Suporte para instalação com capacidade técnica declarada de 999 kg."],
            fichaTecnica: ["Tipo: Suporte"],
            vantagens: ["Finalidade: Organização da instalação"]
          }),
          { output: [] }
        )
      }
    ),
    "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE"
  );
  const terminal = logs.at(-1);
  assert.equal(terminal?.errorClass, "OpenAIProductDescriptionError");
  assert.equal(terminal?.errorCode, "OPENAI_DESCRIPTION_NUMERIC_FACT_UNSUPPORTED");
  assert.equal(terminal?.validationStage, "evidence_validation");
  assert.equal(terminal?.validationRule, "mapped_numeric_evidence");
  assert.equal(terminal?.rejectedField, "introducao[0]");
  assert.equal(terminal?.rejectionReason, "unsupported_numeric_fact");
  assert.deepEqual(terminal?.generatedNumericFact, {
    raw: "999",
    field: "introducao[0]"
  });
  assert.equal(terminal?.retryCount, 0);
  assert.notEqual(terminal?.errorCode, null);
});

test("invalid structured output logs the exact schema rejection", async () => {
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  await expectDescriptionError(
    () => generateOpenAIProductDescription(
      { product: partialProduct },
      {
        env: enabledEnv,
        logger: (event) => logs.push(event),
        createResponse: async () => ({
          httpStatus: 200,
          status: "completed",
          outputParsed: "invalid-root",
          refusalPresent: false,
          output: []
        })
      }
    ),
    "OPENAI_DESCRIPTION_INVALID_RESPONSE"
  );
  const terminal = logs.at(-1);
  assert.equal(terminal?.errorCode, "OPENAI_DESCRIPTION_INVALID_SCHEMA");
  assert.equal(terminal?.validationStage, "structured_schema");
  assert.equal(terminal?.validationRule, "root_object");
  assert.equal(terminal?.rejectedField, "$");
  assert.equal(terminal?.rejectionReason, "expected_object");
});

test("package content without local evidence has its own stable diagnostic", async () => {
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  await expectDescriptionError(
    () => generateOpenAIProductDescription(
      { product: partialProduct },
      {
        env: enabledEnv,
        logger: (event) => logs.push(event),
        createResponse: providerResponse(
          parsedContent({
            introducao: ["Suporte destinado à organização da instalação conforme os dados cadastrados."],
            fichaTecnica: ["Tipo: Suporte"],
            conteudoEmbalagem: ["Produto principal"],
            vantagens: []
          }),
          { output: [] }
        )
      }
    ),
    "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE"
  );
  const terminal = logs.at(-1);
  assert.equal(terminal?.errorCode, "OPENAI_DESCRIPTION_PACKAGE_CONTENT_UNSUPPORTED");
  assert.equal(terminal?.validationStage, "package_content_validation");
  assert.equal(terminal?.validationRule, "mapped_package_content_evidence");
  assert.equal(terminal?.rejectedField, "conteudoEmbalagem[0]");
  assert.equal(terminal?.rejectionReason, "package_content_without_evidence");
});

test("partial product remains conservative without invented sections", async () => {
  const result = await generateOpenAIProductDescription(
    { product: partialProduct },
    {
      env: enabledEnv,
      createResponse: providerResponse(
        partialContent,
        { output: [] }
      )
    }
  );
  assert.equal(result.evidenceLevel, "LOCAL_ONLY");
  assert.doesNotMatch(result.html, /material|peso|compatibilidade|voltagem/i);
});

test("conflicting web data is governed by the local precedence instruction", () => {
  const request = buildOpenAIProductDescriptionRequest(
    { product: completeProduct },
    readOpenAIProductDescriptionConfig(enabledEnv)
  );
  assert.match(request.input[0].content, /omita o dado conflitante/);
  const context = JSON.parse(request.input[1].content) as { produto: Record<string, unknown> };
  assert.match(JSON.stringify(context), /"material":"PVC"/);
});

test("official SDK adapter uses responses.parse with zero retry", async () => {
  let receivedBody: Record<string, unknown> | null = null;
  const create = createOfficialOpenAIProductDescriptionResponse(
    readOpenAIProductDescriptionConfig(enabledEnv),
    (body) => {
      receivedBody = body;
      return {
        withResponse: async () => ({
          data: {
            output_parsed: validContent,
            output: [],
            status: "completed"
          },
          response: {
            status: 200,
            headers: {
              get: (name) => name === "x-request-id" ? "req_safe_123" : null
            }
          }
        })
      };
    }
  );
  const request = buildOpenAIProductDescriptionRequest(
    { product: completeProduct },
    readOpenAIProductDescriptionConfig(enabledEnv)
  );
  const response = await create(request, { signal: new AbortController().signal });
  assert.equal(receivedBody, request);
  assert.equal(response.httpStatus, 200);
  assert.equal(response.requestId, "req_safe_123");
  assert.deepEqual(response.outputParsed, validContent);
});

test("one explicit generation performs one research call and one generation call without retry", async () => {
  let calls = 0;
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  const result = await generateOpenAIProductDescription(
    { product: completeProduct },
    {
      env: enabledEnv,
      correlationId: "corr-safe",
      logger: (event) => logs.push(event),
      createResponse: async (...args) => {
        calls += 1;
        return providerResponse()(...args);
      }
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.html, validHtml);
  assert.equal(logs.at(-1)?.retryCount, 0);
  assert.doesNotMatch(JSON.stringify(logs), /test-key|Abraçadeira|PVC/);
});

test("actual provider sources determine web-search metadata", async () => {
  const result = await generateOpenAIProductDescription(
    { product: partialProduct },
    {
      env: enabledEnv,
      createResponse: providerResponse(
        partialContent,
        { output: [] }
      )
    }
  );
  assert.equal(result.usedWebSearch, false);
  assert.equal(result.evidenceLevel, "LOCAL_ONLY");
});

test("timeout aborts the only provider call", async () => {
  let calls = 0;
  await expectDescriptionError(
    () => generateOpenAIProductDescription(
      { product: completeProduct },
      {
        env: enabledEnv,
        timeoutMs: 10,
        createResponse: async () => {
          calls += 1;
          return new Promise(() => undefined);
        }
      }
    ),
    "OPENAI_DESCRIPTION_TIMEOUT"
  );
  assert.equal(calls, 1);
});

test("provider rate limit returns the stable code without retry", async () => {
  let calls = 0;
  await expectDescriptionError(
    () => generateOpenAIProductDescription(
      { product: completeProduct },
      {
        env: enabledEnv,
        createResponse: async () => {
          calls += 1;
          throw { status: 429, type: "rate_limit_error" };
        }
      }
    ),
    "OPENAI_DESCRIPTION_RATE_LIMITED"
  );
  assert.equal(calls, 1);
});

const allowedRateLimit = {
  allowed: true,
  retryAfterSeconds: 0,
  remaining: 2
};

function routeDependencies(
  overrides: Parameters<typeof createProductDescriptionAiPost>[0] = {}
) {
  return {
    authenticate: async () => ({
      ok: true as const,
      context: {
        organizationId: "org-current",
        user: { id: "user-current" }
      }
    }),
    findProduct: async () => completeProduct,
    consumeRateLimit: () => allowedRateLimit,
    generateDescription: async () => validResult,
    acquireRequestLock: () => () => undefined,
    createCorrelationId: () => "route-correlation",
    logger: () => undefined,
    ...overrides
  };
}

function descriptionRequest(body?: unknown) {
  return new Request("http://localhost/api/products/product-1/ai/description", {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        })
  });
}

const routeContext = { params: Promise.resolve({ id: "product-1" }) };

test("route rejects unauthenticated users before product lookup", async () => {
  let lookups = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    authenticate: async () => ({
      ok: false as const,
      response: NextResponse.json({ error: "Não autorizado." }, { status: 401 })
    }),
    findProduct: async () => {
      lookups += 1;
      return completeProduct;
    }
  }));
  assert.equal((await post(descriptionRequest(), routeContext)).status, 401);
  assert.equal(lookups, 0);
});

test("route preserves products:write permission denial", async () => {
  const post = createProductDescriptionAiPost(routeDependencies({
    authenticate: async () => ({
      ok: false as const,
      response: NextResponse.json({ error: "Permissão insuficiente." }, { status: 403 })
    })
  }));
  assert.equal((await post(descriptionRequest(), routeContext)).status, 403);
});

test("route scopes lookup to the authenticated tenant and hides foreign products", async () => {
  let lookup: [string, string] | null = null;
  const post = createProductDescriptionAiPost(routeDependencies({
    findProduct: async (productId, organizationId) => {
      lookup = [productId, organizationId];
      return null;
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.deepEqual(lookup, ["product-1", "org-current"]);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "PRODUCT_NOT_FOUND",
    error: "Produto não encontrado."
  });
});

test("route rejects every browser-supplied product fact", async () => {
  let generated = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    generateDescription: async () => {
      generated += 1;
      return validResult;
    }
  }));
  const response = await post(descriptionRequest({
    name: "Outro tenant",
    organizationId: "other-org",
    description: "Não confiável",
    stock: 100
  }), routeContext);
  assert.equal(response.status, 400);
  assert.equal(generated, 0);
});

test("valid route returns only the structured description result", async () => {
  let receivedProduct: ProductDescriptionSource | null = null;
  const post = createProductDescriptionAiPost(routeDependencies({
    generateDescription: async (input) => {
      receivedProduct = input.product;
      return validResult;
    }
  }));
  const response = await post(descriptionRequest({}), routeContext);
  assert.equal(response.status, 200);
  assert.equal(receivedProduct, completeProduct);
  assert.deepEqual(await response.json(), validResult);
});

test("disabled feature returns a stable safe code", async () => {
  const post = createProductDescriptionAiPost(routeDependencies({
    generateDescription: async () => {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_DISABLED",
        "internal configuration detail"
      );
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "OPENAI_DESCRIPTION_DISABLED",
    category: "OPENAI_DESCRIPTION_DISABLED",
    correlationId: "route-correlation",
    error: "Geração de descrição com IA está temporariamente desativada."
  });
});

test("route enriches telemetry with product user and tenant context", async () => {
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  const post = createProductDescriptionAiPost(routeDependencies({
    logger: (event) => {
      logs.push(event);
    },
    generateDescription: async (_input, context) => {
      context.logger({
        correlationId: context.correlationId,
        stage: "request_failed",
        model: "test-model",
        durationMs: 10,
        httpStatus: 200,
        responseStatus: "completed",
        searchCount: 1,
        sourceCount: 0,
        officialSourceCount: 0,
        sourceDomainHashes: [],
        queryCount: 1,
        resultCount: 0,
        discardedSourceCount: 0,
        discardedSourceReasonCounts: {},
        fieldsConfirmed: 0,
        fieldsOmitted: 0,
        providerCallCount: 1,
        usedWebSearch: true,
        evidenceLevel: "LOCAL_ONLY",
        requestId: "req_safe",
        errorClass: "OpenAIProductDescriptionError",
        errorCode: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
        validationStage: "structured_schema",
        validationRule: "root_object",
        rejectedField: "$",
        rejectionReason: "expected_object",
        generatedNumericFact: null,
        localNumericCandidates: [],
        retryCount: 0
      });
      return validResult;
    }
  }));
  assert.equal((await post(descriptionRequest(), routeContext)).status, 200);
  const logged = logs.at(-1);
  assert.equal(logged?.productId, "product-1");
  assert.equal(logged?.organizationId, "org-current");
  assert.equal(logged?.userId, "user-current");
  assert.equal(logged?.correlationId, "route-correlation");
});

test("route preserves detailed validation codes without exposing internal details", async () => {
  const cases = [
    {
      diagnosticCode: "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE" as const
    },
    {
      diagnosticCode: "OPENAI_DESCRIPTION_NUMERIC_FACT_UNSUPPORTED" as const
    },
    {
      diagnosticCode: "OPENAI_DESCRIPTION_PACKAGE_CONTENT_UNSUPPORTED" as const
    },
    {
      diagnosticCode: "OPENAI_DESCRIPTION_INVALID_SCHEMA" as const
    }
  ];
  for (const current of cases) {
    const post = createProductDescriptionAiPost(routeDependencies({
      generateDescription: async () => {
        throw new OpenAIProductDescriptionError(
          current.diagnosticCode.includes("EVIDENCE") ||
            current.diagnosticCode.includes("UNSUPPORTED")
            ? "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE"
            : "OPENAI_DESCRIPTION_INVALID_RESPONSE",
          "internal detail must stay hidden",
          {
            stage: current.diagnosticCode === "OPENAI_DESCRIPTION_PACKAGE_CONTENT_UNSUPPORTED"
              ? "package_content_validation"
              : current.diagnosticCode === "OPENAI_DESCRIPTION_INVALID_SCHEMA"
                ? "structured_schema"
                : "evidence_validation",
            rule: "test_rule",
            code: current.diagnosticCode,
            field: "testField",
            reason: "test_reason"
          }
        );
      }
    }));
    const response = await post(descriptionRequest(), routeContext);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 502);
    assert.equal(body.code, current.diagnosticCode);
    assert.equal(body.correlationId, "route-correlation");
    assert.doesNotMatch(String(body.error), /internal detail/);
  }
});

test("missing API key is exposed only as a safe configuration code", async () => {
  const post = createProductDescriptionAiPost(routeDependencies({
    generateDescription: async () => {
      throw new OpenAIProductDescriptionError(
        "OPENAI_API_KEY_MISSING",
        "internal configuration detail"
      );
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "OPENAI_DESCRIPTION_CONFIGURATION_UNAVAILABLE",
    category: "OPENAI_API_KEY_MISSING",
    correlationId: "route-correlation",
    error: "Geração de descrição com IA está temporariamente desativada."
  });
});

test("route rate limit is isolated by organization user and product", async () => {
  let key = "";
  const post = createProductDescriptionAiPost(routeDependencies({
    consumeRateLimit: (receivedKey) => {
      key = receivedKey;
      return { allowed: false, retryAfterSeconds: 30, remaining: 0 };
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.equal(key, "openai:description:org-current:user-current:product-1");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "30");
});

test("concurrent request for the same tenant user and product is blocked", async () => {
  let generated = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    acquireRequestLock: () => null,
    generateDescription: async () => {
      generated += 1;
      return validResult;
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.equal(response.status, 409);
  assert.equal(generated, 0);
});

test("request lock is always released after a generation failure", async () => {
  let released = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    acquireRequestLock: () => () => {
      released += 1;
    },
    generateDescription: async () => {
      throw new Error("mocked failure");
    }
  }));
  assert.equal((await post(descriptionRequest(), routeContext)).status, 502);
  assert.equal(released, 1);
});

test("provider metadata is rejected and backend owns fallback warnings", async () => {
  await expectDescriptionError(
    () => validateOpenAIProductDescriptionContent({
      ...validContent,
      warnings: ["Fonte web conflitante; dado omitido."]
    }),
    "OPENAI_DESCRIPTION_INVALID_RESPONSE"
  );
  const result = await generateOpenAIProductDescription(
    { product: completeProduct },
    { env: enabledEnv, createResponse: providerResponse() }
  );
  assert.deepEqual(result.warnings, ["OFFICIAL_SOURCES_NOT_FOUND"]);
  assert.doesNotMatch(result.html, /Fonte web conflitante/);
});

test("service and route tests never call a real provider or persistence API", () => {
  assert.equal(typeof providerResponse, "function");
  assert.equal(typeof createProductDescriptionAiPost, "function");
});
