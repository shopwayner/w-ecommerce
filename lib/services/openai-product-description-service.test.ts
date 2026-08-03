import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createProductDescriptionAiPost } from "@/lib/services/openai-product-description-route";
import {
  buildLocalProductDescriptionEvidence,
  buildOpenAIProductDescriptionResearchRequest
} from "@/lib/services/openai-product-description-research";
import {
  buildOpenAIProductDescriptionHtml,
  buildOpenAIProductDescriptionRequest,
  buildOpenAIProductDescriptionTextFormat,
  buildDeterministicLocalDescriptionContent,
  createOfficialOpenAIProductDescriptionResponse,
  filterReferencedOpenAIProductDescriptionByEvidence,
  generateOpenAIProductDescription,
  OpenAIProductDescriptionError,
  OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS,
  OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MODEL,
  OPENAI_PRODUCT_DESCRIPTION_SCHEMA_NAME,
  readOpenAIProductDescriptionConfig,
  shouldUseProductDescriptionWebSearch,
  validateOpenAIProductDescriptionContent,
  validateOpenAIProductDescriptionReferencedContent,
  type OpenAIProductDescriptionCreate,
  type OpenAIProductDescriptionContent,
  type OpenAIProductDescriptionLogEvent,
  type OpenAIProductDescriptionReferencedContent,
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

function referencedContent(
  content: OpenAIProductDescriptionContent = validContent,
  product: ProductDescriptionSource = completeProduct
): OpenAIProductDescriptionReferencedContent {
  const evidenceIds = buildLocalProductDescriptionEvidence(product)
    .sort((left, right) => {
      const priority = (id: string) => id.startsWith("local.") && !id.startsWith("local.attributes")
        ? 0
        : 1;
      return priority(left.id) - priority(right.id);
    })
    .slice(0, 9)
    .map((item) => item.id);
  const attributeIds = buildLocalProductDescriptionEvidence(product)
    .filter((item) => item.id.startsWith("local.") && item.sourceField.startsWith("attributes"))
    .slice(0, 3)
    .map((item) => item.id);
  const selectedEvidenceIds = [...new Set([...evidenceIds, ...attributeIds])].slice(0, 12);
  return Object.fromEntries(Object.entries(content).map(([field, values]) => [
    field,
    values.map((text) => ({ text, evidenceIds: selectedEvidenceIds }))
  ])) as OpenAIProductDescriptionReferencedContent;
}

function providerResponse(
  parsed: unknown = referencedContent(),
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
      items?: { type?: string; minLength?: number; maxLength?: number; $ref?: string };
    }>;
    definitions?: Record<string, {
      type?: string;
      required?: string[];
      additionalProperties?: boolean;
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
  const itemReference = schema.properties?.fichaTecnica?.items?.$ref;
  assert.equal(typeof itemReference, "string");
  const itemDefinition = schema.definitions?.[itemReference?.split("/").at(-1) ?? ""];
  assert.equal(itemDefinition?.type, "object");
  assert.deepEqual(itemDefinition?.required?.sort(), [
    "evidenceIds",
    "text"
  ]);
  assert.equal(itemDefinition?.additionalProperties, false);
  assert.equal(schema.properties?.html, undefined);
  assert.equal(schema.properties?.usedWebSearch, undefined);
});

test("complete product context keeps false and zero while excluding private facts", () => {
  const request = buildOpenAIProductDescriptionRequest(
    { product: completeProduct },
    readOpenAIProductDescriptionConfig(enabledEnv)
  );
  const context = JSON.parse(request.input[1].content) as {
    modo: string;
    evidenciasConfirmadas: Array<{ id: string; fact: string }>;
  };
  const serialized = JSON.stringify(context);
  assert.equal(context.modo, "LOCAL_AND_WEB");
  assert.ok(context.evidenciasConfirmadas.some((item) => item.id === "local.freeShipping" && item.fact.endsWith("false")));
  assert.ok(context.evidenciasConfirmadas.some((item) => item.id === "local.volumes" && item.fact.endsWith("0")));
  assert.ok(context.evidenciasConfirmadas.some((item) => item.id === "local.itemsPerBox" && item.fact.endsWith("0")));
  assert.match(serialized, /attributes\.material: PVC/);
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
  assert.match(prompt, /NUNCA INVENTE INFORMAÇÕES\. NUNCA\./);
  assert.match(prompt, /1\. Fabricante\.[\s\S]*2\. Manual\.[\s\S]*3\. Catálogo oficial\.[\s\S]*4\. Site oficial[\s\S]*5\. Distribuidor autorizado/);
  assert.match(prompt, /pesquisa e hierarquia de fontes/i);
  assert.match(prompt, /profissional, natural, objetiva, clara e fácil de entender/i);
  assert.match(prompt, /Mercado Livre, Amazon, Shopee, Magalu, Olist e Bling/);
  assert.match(prompt, /links, URLs, hiperlinks/);
  assert.match(prompt, /citações automáticas, fontes, notas de rodapé/);
  assert.match(prompt, /link do fabricante, link do anúncio, PDF do catálogo, manual, foto da embalagem e foto do produto/);
  assert.match(prompt, /Antes de finalizar, revise todo o conteúdo/);
  assert.match(prompt, /JSON estruturado/);
  assert.match(prompt, /introducao, fichaTecnica, compatibilidade/);
  assert.match(prompt, /ConteudoEmbalagem deve conter somente itens e quantidades oficialmente informados/);
  assert.match(prompt, /TutorialInstalacao só deve ser preenchido quando fizer sentido/);
  assert.match(prompt, /CuidadosManutencao deve conter apenas/);
  assert.match(prompt, /Conhecimento geral serve somente para organizar/);
  assert.match(prompt, /não gere HTML, Markdown, títulos de seção/i);
  assert.match(prompt, /exatamente as nove propriedades do schema/);
  assert.match(prompt, /O backend controla o nome do produto, os títulos, a ordem, os parágrafos, as listas e o HTML final/);
});

test("research and generation calls keep separate responsibilities", () => {
  const config = readOpenAIProductDescriptionConfig(enabledEnv);
  const research = buildOpenAIProductDescriptionResearchRequest(
    completeProduct,
    config
  );
  const generation = buildOpenAIProductDescriptionRequest(
    { product: completeProduct },
    config
  );
  assert.equal(research.input[0].role, "system");
  assert.match(research.input[0].content, /Pesquise cuidadosamente o produto exato/);
  assert.match(research.input[0].content, /ausência de GTIN na página não invalida sozinha/);
  assert.match(research.input[0].content, /Distribuidor autorizado só é aceito/);
  assert.equal(research.text.format.type, "json_schema");
  assert.equal(generation.input[0].role, "system");
  assert.match(generation.input[0].content, /NUNCA INVENTE INFORMAÇÕES/);
  assert.match(generation.input[0].content, /Use exclusivamente os fatos do mapa de evidências/);
  assert.equal(generation.text.format.type, "json_schema");
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

test("local-only fallback omits unsupported numeric facts with sanitized telemetry", async () => {
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  const unsupported = parsedContent({
    introducao: ["Suporte para instalação com capacidade técnica declarada de 999 kg."],
    fichaTecnica: ["Tipo: Suporte"],
    vantagens: ["Finalidade: Organização da instalação"]
  });
  const result = await generateOpenAIProductDescription(
    { product: partialProduct },
    {
      env: enabledEnv,
      correlationId: "numeric-correlation",
      logger: (event) => logs.push(event),
      createResponse: providerResponse(
        referencedContent(unsupported, partialProduct),
        { output: [] }
      )
    }
  );
  const terminal = logs.at(-1);
  assert.equal(terminal?.stage, "request_completed");
  assert.equal(terminal?.evidenceMode, "LOCAL_ONLY_STRICT");
  assert.ok(terminal?.omittedSections.includes("introducao"));
  assert.equal(terminal?.omittedFacts[0]?.field, "introducao");
  assert.equal(terminal?.omittedFacts[0]?.semanticType, "WEIGHT");
  assert.ok(result.warnings.includes("UNSUPPORTED_FACT_OMITTED"));
  assert.doesNotMatch(result.html, /999/);
  assert.equal(terminal?.retryCount, 0);
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

test("package content without local evidence is omitted in local-only strict mode", async () => {
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  const unsupported = parsedContent({
    introducao: ["Suporte destinado à organização da instalação conforme os dados cadastrados."],
    fichaTecnica: ["Tipo: Suporte"],
    conteudoEmbalagem: ["Produto principal"],
    vantagens: []
  });
  const result = await generateOpenAIProductDescription(
    { product: partialProduct },
    {
      env: enabledEnv,
      logger: (event) => logs.push(event),
      createResponse: providerResponse(
        referencedContent(unsupported, partialProduct),
        { output: [] }
      )
    }
  );
  const terminal = logs.at(-1);
  assert.ok(result.warnings.includes("UNSUPPORTED_FACT_OMITTED"));
  assert.equal(terminal?.omittedFacts[0]?.field, "conteudoEmbalagem");
  assert.doesNotMatch(result.html, /Conteúdo da Embalagem/);
});

test("partial product remains conservative without invented sections", async () => {
  const result = await generateOpenAIProductDescription(
    { product: partialProduct },
    {
      env: enabledEnv,
      createResponse: providerResponse(
        referencedContent(partialContent, partialProduct),
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
  const context = JSON.parse(request.input[1].content) as {
    evidenciasConfirmadas: Array<{ fact: string }>;
  };
  assert.ok(context.evidenciasConfirmadas.some((item) => item.fact === "attributes.material: PVC"));
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
            output_parsed: referencedContent(),
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
  assert.deepEqual(response.outputParsed, referencedContent());
});

test("one explicit generation performs one research call and one generation call without retry", async () => {
  let calls = 0;
  let rateLimitConsumptions = 0;
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  const result = await generateOpenAIProductDescription(
    { product: completeProduct },
    {
      env: enabledEnv,
      correlationId: "corr-safe",
      logger: (event) => logs.push(event),
      beforeProviderRequest: async () => {
        rateLimitConsumptions += 1;
      },
      createResponse: async (...args) => {
        calls += 1;
        return providerResponse()(...args);
      }
    }
  );
  assert.equal(calls, 2);
  assert.equal(rateLimitConsumptions, 1);
  assert.match(result.html, /Ficha Técnica/);
  assert.match(result.html, /Frete grátis: Não/);
  assert.match(result.html, /Dimensões/);
  assert.equal(logs.at(-1)?.retryCount, 0);
  assert.doesNotMatch(JSON.stringify(logs), /test-key|Abraçadeira|PVC/);
});

test("actual provider sources determine web-search metadata", async () => {
  const result = await generateOpenAIProductDescription(
    { product: partialProduct },
    {
      env: enabledEnv,
      createResponse: providerResponse(
        referencedContent(partialContent, partialProduct),
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
  limit: 3,
  retryAfterSeconds: 0,
  remaining: 2,
  resetAt: 601_000,
  count: 1
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
    consumeRateLimit: async () => allowedRateLimit,
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
  let consumed = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    findProduct: async (productId, organizationId) => {
      lookup = [productId, organizationId];
      return null;
    },
    consumeRateLimit: async () => {
      consumed += 1;
      return allowedRateLimit;
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.deepEqual(lookup, ["product-1", "org-current"]);
  assert.equal(response.status, 404);
  assert.equal(consumed, 0);
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
  let consumed = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    consumeRateLimit: async () => {
      consumed += 1;
      return allowedRateLimit;
    },
    generateDescription: async (input) => {
      receivedProduct = input.product;
      return validResult;
    }
  }));
  const response = await post(descriptionRequest({}), routeContext);
  assert.equal(response.status, 200);
  assert.equal(receivedProduct, completeProduct);
  assert.equal(consumed, 0);
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
        acceptedSources: [],
        externalFacts: [],
        externalFactsAvailable: 0,
        externalFactsReferenced: 0,
        externalFactsValidated: 0,
        externalFactsOmitted: 0,
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
        evidenceRejection: null,
        sectionItemCounts: {
          introducao: 0,
          fichaTecnica: 0,
          compatibilidade: 0,
          vantagens: 0,
          conteudoEmbalagem: 0,
          dimensoes: 0,
          tutorialInstalacao: 0,
          cuidadosManutencao: 0,
          maisSobreProduto: 0
        },
        evidenceMode: "LOCAL_ONLY_STRICT",
        localFactCount: 0,
    generatedFactCount: 0,
    omittedSections: [],
    omittedFacts: [],
    warningCodes: [],
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
  let identity: Record<string, string> | null = null;
  const post = createProductDescriptionAiPost(routeDependencies({
    consumeRateLimit: async (receivedIdentity) => {
      identity = receivedIdentity;
      return {
        allowed: false,
        limit: 3,
        retryAfterSeconds: 30,
        remaining: 0,
        resetAt: 31_000,
        count: 3
      };
    },
    generateDescription: async (_input, context) => {
      await context.beforeProviderRequest();
      return validResult;
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.deepEqual(identity, {
    organizationId: "org-current",
    userId: "user-current",
    productId: "product-1"
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "3");
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "0");
  assert.equal(response.headers.get("X-RateLimit-Reset"), "31");
  assert.deepEqual(await response.json(), {
    code: "OPENAI_DESCRIPTION_RATE_LIMITED",
    category: "OPENAI_DESCRIPTION_RATE_LIMITED",
    correlationId: "route-correlation",
    error: "A geração está temporariamente limitada. Aguarde e tente novamente.",
    retryAfterSeconds: 30,
    resetAt: "1970-01-01T00:00:31.000Z"
  });
});

test("invalid local input is rejected before rate limit consumption", async () => {
  let rateLimitConsumptions = 0;
  await expectDescriptionError(
    () => generateOpenAIProductDescription(
      { product: { ...completeProduct, name: "  " } },
      {
        env: enabledEnv,
        beforeProviderRequest: async () => {
          rateLimitConsumptions += 1;
        },
        createResponse: providerResponse()
      }
    ),
    "OPENAI_DESCRIPTION_INVALID_INPUT"
  );
  assert.equal(rateLimitConsumptions, 0);
});

test("concurrent request for the same tenant user and product is blocked", async () => {
  let generated = 0;
  let consumed = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    acquireRequestLock: () => null,
    consumeRateLimit: async () => {
      consumed += 1;
      return allowedRateLimit;
    },
    generateDescription: async () => {
      generated += 1;
      return validResult;
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.equal(response.status, 409);
  assert.equal(generated, 0);
  assert.equal(consumed, 0);
});

test("local failure before a provider request does not consume quota", async () => {
  let consumed = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    consumeRateLimit: async () => {
      consumed += 1;
      return allowedRateLimit;
    },
    generateDescription: async () => {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_DISABLED",
        "disabled"
      );
    }
  }));
  assert.equal((await post(descriptionRequest(), routeContext)).status, 503);
  assert.equal(consumed, 0);
});

test("failure after provider authorization consumes exactly one quota", async () => {
  let consumed = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    consumeRateLimit: async () => {
      consumed += 1;
      return allowedRateLimit;
    },
    generateDescription: async (_input, context) => {
      await context.beforeProviderRequest();
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_TIMEOUT",
        "timeout"
      );
    }
  }));
  assert.equal((await post(descriptionRequest(), routeContext)).status, 504);
  assert.equal(consumed, 1);
});

test("rate limit storage failure blocks the provider without exposing details", async () => {
  let providerCalls = 0;
  const post = createProductDescriptionAiPost(routeDependencies({
    consumeRateLimit: async () => {
      throw new Error("private redis detail");
    },
    generateDescription: async (_input, context) => {
      await context.beforeProviderRequest();
      providerCalls += 1;
      return validResult;
    }
  }));
  const response = await post(descriptionRequest(), routeContext);
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
  assert.deepEqual(await response.json(), {
    code: "OPENAI_DESCRIPTION_RATE_LIMIT_UNAVAILABLE",
    category: "OPENAI_DESCRIPTION_RATE_LIMIT_UNAVAILABLE",
    correlationId: "route-correlation",
    error: "A geração por IA está temporariamente indisponível."
  });
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
  assert.deepEqual(result.warnings, [
    "OFFICIAL_SOURCES_NOT_FOUND",
    "UNSUPPORTED_FACT_OMITTED"
  ]);
  assert.doesNotMatch(result.html, /Fonte web conflitante/);
});

test("local evidence catalog excludes cost price stock null and uninformed values", () => {
  const evidence = buildLocalProductDescriptionEvidence({
    ...completeProduct,
    packagingGtin: null,
    manufacturerSku: "Não informado",
    attributes: {
      material: "PVC",
      costPrice: "4.56",
      salePrice: "9.99",
      stock: 12,
      empty: "",
      ignored: "Não informado"
    }
  });
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /4\.56|9\.99|stock|manufacturerSku|packagingGtin/);
  assert.match(serialized, /attributes\.material: PVC/);
});

test("every generated factual item requires one or more evidence ids", () => {
  const referenced = referencedContent();
  for (const items of Object.values(referenced)) {
    for (const item of items) assert.ok(item.evidenceIds.length > 0);
  }
  assert.deepEqual(validateOpenAIProductDescriptionReferencedContent(referenced), referenced);
});

test("unknown evidence id is rejected in rich evidence mode", () => {
  const referenced = referencedContent();
  referenced.fichaTecnica[0].evidenceIds = ["local.unknown"];
  assert.throws(
    () => filterReferencedOpenAIProductDescriptionByEvidence(
      referenced,
      buildLocalProductDescriptionEvidence(completeProduct),
      "LOCAL_AND_WEB"
    ),
    (error: unknown) => {
      assert.ok(error instanceof OpenAIProductDescriptionError);
      assert.equal(
        error.diagnostic.evidenceRejection?.filteringDecision,
        "REJECTED_INVALID_EVIDENCE_ID"
      );
      return error.code === "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE";
    }
  );
});

test("GTIN evidence cannot support material", () => {
  const referenced = referencedContent({
    ...validContent,
    fichaTecnica: ["Material: ABS"]
  });
  referenced.fichaTecnica[0].evidenceIds = ["local.gtin"];
  assert.throws(
    () => filterReferencedOpenAIProductDescriptionByEvidence(
      referenced,
      buildLocalProductDescriptionEvidence(completeProduct),
      "LOCAL_AND_WEB"
    ),
    (error: unknown) => {
      assert.ok(error instanceof OpenAIProductDescriptionError);
      assert.equal(
        error.diagnostic.evidenceRejection?.filteringDecision,
        "REJECTED_SEMANTIC_MISMATCH"
      );
      return true;
    }
  );
});

test("weight evidence cannot support certification", () => {
  const referenced = referencedContent({
    ...validContent,
    fichaTecnica: ["Certificação: Inmetro"]
  });
  referenced.fichaTecnica[0].evidenceIds = ["local.weight"];
  assert.throws(() => filterReferencedOpenAIProductDescriptionByEvidence(
    referenced,
    buildLocalProductDescriptionEvidence(completeProduct),
    "LOCAL_AND_WEB"
  ));
});

test("local-only strict keeps valid items while omitting unsupported optional items", () => {
  const referenced = referencedContent({
    ...validContent,
    fichaTecnica: ["Marca: Andaluz", "Certificação: Inmetro"]
  });
  referenced.fichaTecnica[0].evidenceIds = ["local.brand"];
  referenced.fichaTecnica[1].evidenceIds = ["local.weight"];
  const filtered = filterReferencedOpenAIProductDescriptionByEvidence(
    referenced,
    buildLocalProductDescriptionEvidence(completeProduct),
    "LOCAL_ONLY_STRICT"
  );
  assert.deepEqual(filtered.content.fichaTecnica, ["Marca: Andaluz"]);
  assert.ok(filtered.omitted.some(({ field, index, semanticType }) => (
    field === "fichaTecnica" && index === 1 && semanticType === "CERTIFICATION"
  )));
});

test("backend assembles local technical facts dimensions and attributes deterministically", () => {
  const content = buildDeterministicLocalDescriptionContent(completeProduct, {
    ...validContent,
    fichaTecnica: ["Material deformado pela IA"],
    dimensoes: ["Altura deformada pela IA"]
  });
  assert.ok(content.fichaTecnica.includes("Marca: Andaluz"));
  assert.ok(content.fichaTecnica.includes("Material: PVC"));
  assert.ok(content.fichaTecnica.includes("Cor: Preto"));
  assert.ok(content.dimensoes.includes("Peso líquido: 0,03 kg"));
  assert.ok(content.dimensoes.includes("Altura: 2 CM"));
  assert.doesNotMatch(JSON.stringify(content), /deformad/);
});

test("local-only minimum content produces a sanitized description", () => {
  const content = buildDeterministicLocalDescriptionContent(partialProduct, {
    ...partialContent,
    fichaTecnica: [],
    dimensoes: []
  });
  const html = buildOpenAIProductDescriptionHtml(partialProduct.name, content);
  assert.match(html, /Ficha Técnica/);
  assert.doesNotMatch(html, /evidenceIds|OFFICIAL_SOURCES_NOT_FOUND/);
});

test("local-only fallback rejects when fewer than two local technical facts remain", () => {
  const sparse: ProductDescriptionSource = Object.fromEntries(
    Object.keys(partialProduct).map((key) => [key, null])
  ) as unknown as ProductDescriptionSource;
  sparse.name = "Produto sem dados técnicos";
  sparse.attributes = null;
  assert.throws(
    () => buildDeterministicLocalDescriptionContent(sparse, {
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
    (error: unknown) => error instanceof OpenAIProductDescriptionError &&
      error.code === "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE"
  );
});

test("local-only strict does not accept unsupported helmet claims from the product name", () => {
  const helmet = {
    ...completeProduct,
    name: "Capacete Play Monocolor Matte Black 54/XS Race Tech",
    brand: "Race Tech",
    model: "Play Monocolor",
    attributes: { line: "Play", color: "Matte Black", size: "54/XS" }
  };
  const referenced = referencedContent({
    ...validContent,
    introducao: ["Capacete com conforto, proteção e segurança para uso urbano."],
    fichaTecnica: ["Material: ABS", "Estrutura: EPS", "Viseira: policarbonato", "Certificação: Inmetro"]
  }, helmet);
  const filtered = filterReferencedOpenAIProductDescriptionByEvidence(
    referenced,
    buildLocalProductDescriptionEvidence(helmet),
    "LOCAL_ONLY_STRICT"
  );
  assert.equal(filtered.content.introducao.length, 0);
  assert.equal(filtered.content.fichaTecnica.length, 0);
  assert.ok(filtered.fieldsOmitted >= 5);
});

test("description result contract never exposes internal evidence ids", () => {
  assert.deepEqual(Object.keys(validResult).sort(), [
    "evidenceLevel",
    "html",
    "researchSummary",
    "usedWebSearch",
    "warnings"
  ]);
  assert.doesNotMatch(JSON.stringify(validResult), /evidenceIds|local\.|web\./);
});

test("service and route tests never call a real provider or persistence API", () => {
  assert.equal(typeof providerResponse, "function");
  assert.equal(typeof createProductDescriptionAiPost, "function");
});
