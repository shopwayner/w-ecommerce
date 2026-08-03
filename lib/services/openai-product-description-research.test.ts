import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalProductDescriptionEvidence,
  buildOpenAIProductDescriptionResearchRequest,
  buildOpenAIProductDescriptionResearchTextFormat,
  buildProductDescriptionResearchQueries,
  validateProductDescriptionResearch,
  type ProductDescriptionEvidenceFact,
  type ProductDescriptionResearchProduct
} from "./openai-product-description-research";
import {
  buildOpenAIProductDescriptionHtml,
  buildOpenAIProductDescriptionRequest,
  filterOpenAIProductDescriptionByEvidence,
  generateOpenAIProductDescription,
  OpenAIProductDescriptionError,
  type OpenAIProductDescriptionContent,
  type OpenAIProductDescriptionLogEvent,
  type OpenAIProductDescriptionReferencedContent,
  type ProductDescriptionSource
} from "./openai-product-description-service";
import { readOpenAIProductDescriptionConfig } from "./openai-product-description-service";

const helmet: ProductDescriptionSource & ProductDescriptionResearchProduct = {
  name: "Capacete Play Monocolor Matte Black 54 XS Race Tech",
  sku: "10311",
  gtin: "7908167822585",
  packagingGtin: null,
  brand: "Race Tech",
  category: "Capacetes",
  ncm: null,
  origin: "BLING",
  currentDescription: null,
  unit: "UN",
  model: "Play Monocolor",
  manufacturerSku: null,
  condition: "NEW",
  format: "SIMPLE",
  productType: "PRODUCT",
  commercialStatus: "ACTIVE",
  productionType: null,
  expirationDate: null,
  freeShipping: false,
  volumes: null,
  itemsPerBox: null,
  weight: null,
  grossWeight: null,
  height: "27",
  width: "26",
  depth: "19",
  dimensionUnit: "CM",
  attributes: { line: "Play", color: "Matte Black", size: "54/XS" }
};

const officialFacts = [
  ["Marca: Race Tech", "product.brand"],
  ["Linha: Play", "product.line"],
  ["Modelo: Play Monocolor", "product.model"],
  ["Categoria: capacete aberto", "technical.category"],
  ["Material do casco: ABS", "technical.shellMaterial"],
  ["Estrutura interna: EPS", "technical.innerStructure"],
  ["Viseira de policarbonato com tratamento antirrisco e proteção UV", "technical.visor"],
  ["Sistema de ventilação com entradas e saídas de ar", "technical.ventilation"],
  ["Forração removível e lavável", "technical.lining"],
  ["Sistema para usuários de óculos", "technical.glasses"],
  ["Tamanho: 54/XS", "product.size"],
  ["GTIN/EAN: 7908167822585", "product.gtin"],
  ["Conteúdo da embalagem: 1 capacete Race Tech Play", "package.content"],
  ["Ajuste: posicionar o capacete e regular o fecho conforme o manual", "manual.adjustment"],
  ["Cuidados: limpar a viseira e secar completamente a forração", "manual.care"],
  ["A linha Play foi desenvolvida para uso urbano", "catalog.productLine"]
] as const;

const researchPayload = {
  sources: [{
    domain: "racetech.example",
    sourceType: "OFFICIAL_CATALOG" as const,
    evidenceLevel: "EXACT_PRODUCT" as const,
    matchedIdentifiers: ["7908167822585", "Play Monocolor"],
    facts: officialFacts.map(([fact, sourceField]) => ({
      fact,
      sourceField,
      confidence: "HIGH" as const
    }))
  }]
};

const providerOutput = [{
  type: "web_search_call",
  action: {
    sources: [{ url: "https://racetech.example/catalogos/play.pdf" }]
  }
}];

const helmetContent: OpenAIProductDescriptionContent = {
  introducao: [
    "O Capacete Race Tech Play Monocolor é um capacete aberto da linha Play para uso urbano.",
    "O casco em ABS e a estrutura interna em EPS acompanham viseira de policarbonato."
  ],
  fichaTecnica: [
    "Marca: Race Tech",
    "Linha: Play",
    "Modelo: Play Monocolor",
    "Categoria: capacete aberto",
    "Material do casco: ABS",
    "Estrutura interna: EPS",
    "Viseira: policarbonato com tratamento antirrisco e proteção UV",
    "Ventilação: entradas e saídas de ar",
    "Forração: removível e lavável",
    "Sistema para óculos: disponível",
    "Tamanho: 54/XS",
    "GTIN/EAN: 7908167822585"
  ],
  compatibilidade: [],
  vantagens: [
    "Forração removível e lavável para facilitar os cuidados",
    "Viseira com tratamento antirrisco e proteção UV",
    "Ventilação com entradas e saídas de ar"
  ],
  conteudoEmbalagem: ["1 capacete Race Tech Play"],
  dimensoes: ["Altura: 27 cm", "Largura: 26 cm", "Profundidade: 19 cm"],
  tutorialInstalacao: [
    "Posicione o capacete corretamente.",
    "Regule o fecho conforme o manual."
  ],
  cuidadosManutencao: [
    "Limpe a viseira.",
    "Seque completamente a forração."
  ],
  maisSobreProduto: ["A linha Play foi desenvolvida para uso urbano."]
};

function validatedResearch() {
  return validateProductDescriptionResearch(
    researchPayload,
    providerOutput,
    helmet,
    buildProductDescriptionResearchQueries(helmet).length
  );
}

function referencedContent(
  content: OpenAIProductDescriptionContent,
  evidence: readonly ProductDescriptionEvidenceFact[]
): OpenAIProductDescriptionReferencedContent {
  const words = (value: string) => new Set(value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3));
  return Object.fromEntries(Object.entries(content).map(([field, values]) => [
    field,
    values.map((text) => {
      const textWords = words(text);
      const preferredTypes = field === "dimensoes"
        ? new Set(["DIMENSION", "WEIGHT"])
        : field === "conteudoEmbalagem"
          ? new Set(["PACKAGE_CONTENT"])
          : field === "compatibilidade"
            ? new Set(["COMPATIBILITY"])
            : new Set<string>();
      const evidenceIds = evidence
        .map((item) => ({
          id: item.id,
          score: [...words(item.fact)].filter((word) => textWords.has(word)).length +
            (preferredTypes.has(item.semanticType) ? 20 : 0)
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 12)
        .map((item) => item.id);
      return { text, evidenceIds };
    })
  ])) as OpenAIProductDescriptionReferencedContent;
}

function assertEvidenceRejected(
  content: OpenAIProductDescriptionContent,
  evidence: readonly ProductDescriptionEvidenceFact[]
) {
  assert.throws(
    () => filterOpenAIProductDescriptionByEvidence(content, evidence),
    (error: unknown) => error instanceof OpenAIProductDescriptionError &&
      error.code === "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE"
  );
}

test("research query plan starts with an exact valid GTIN", () => {
  assert.equal(buildProductDescriptionResearchQueries(helmet)[0], helmet.gtin);
});

test("research falls back to brand and model", () => {
  const queries = buildProductDescriptionResearchQueries({ ...helmet, gtin: null });
  assert.equal(queries[0], "Race Tech Play Monocolor");
});

test("research plan includes the full specific product name", () => {
  assert.ok(buildProductDescriptionResearchQueries(helmet).includes(helmet.name));
});

test("research plan includes an official technical-sheet query", () => {
  assert.match(buildProductDescriptionResearchQueries(helmet).join("\n"), /site oficial ficha técnica/);
});

test("research plan includes a manual or catalog PDF query", () => {
  assert.match(buildProductDescriptionResearchQueries(helmet).join("\n"), /manual catálogo PDF/);
});

test("research plan is unique and limited to five queries", () => {
  const queries = buildProductDescriptionResearchQueries(helmet);
  assert.ok(queries.length <= 5);
  assert.equal(new Set(queries.map((query) => query.toLocaleLowerCase())).size, queries.length);
});

test("generic products without sufficient identifiers do not search", () => {
  assert.deepEqual(buildProductDescriptionResearchQueries({
    ...helmet,
    name: "Suporte para instalação",
    gtin: null,
    brand: null,
    model: null
  }), []);
});

test("research schema is strict and rooted in one object", () => {
  const format = buildOpenAIProductDescriptionResearchTextFormat();
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
  assert.equal(format.schema.type, "object");
  assert.equal(format.schema.additionalProperties, false);
});

test("research request uses the Responses web search tool with a hard tool limit", () => {
  const request = buildOpenAIProductDescriptionResearchRequest(
    helmet,
    { model: "mock-model", maxOutputTokens: 12_000 }
  );
  assert.equal(request.tools[0].type, "web_search");
  assert.equal(request.max_tool_calls, 5);
  assert.equal(request.store, false);
});

test("official-domain filtering is applied when the backend supplies a domain", () => {
  const request = buildOpenAIProductDescriptionResearchRequest(
    helmet,
    { model: "mock-model", maxOutputTokens: 12_000 },
    ["racetech.example"]
  );
  assert.deepEqual(request.tools[0].filters?.allowed_domains, ["racetech.example"]);
});

test("actual provider execution controls usedWebSearch", () => {
  assert.equal(validatedResearch().usedWebSearch, true);
  const withoutCall = validateProductDescriptionResearch(researchPayload, [], helmet, 5);
  assert.equal(withoutCall.usedWebSearch, false);
});

test("provider source metadata controls the result count", () => {
  assert.equal(validatedResearch().summary.resultsFound, 1);
});

test("an official catalog with exact matching identifiers is accepted", () => {
  const result = validatedResearch();
  assert.equal(result.officialSourceCount, 1);
  assert.equal(result.summary.fieldsConfirmed, officialFacts.length);
  assert.deepEqual(result.acceptedSources, [{
    domainHash: result.sourceDomainHashes[0],
    sourceType: "OFFICIAL_CATALOG",
    evidenceLevel: "EXACT_PRODUCT",
    matchedIdentifierTypes: ["GTIN", "MODEL"],
    factCount: officialFacts.length
  }]);
  assert.equal(result.externalFacts.length, officialFacts.length);
  assert.ok(result.externalFacts.every((fact) => !(
    "fact" in fact || "domain" in fact || "url" in fact
  )));
});

test("a seller listing is never accepted as the main evidence source", () => {
  const payload = {
    sources: [{
      ...researchPayload.sources[0],
      sourceType: "SELLER_LISTING" as const
    }]
  };
  const result = validateProductDescriptionResearch(payload, providerOutput, helmet, 5);
  assert.equal(result.sourceCount, 0);
  assert.equal(result.summary.discardReasonCounts.UNTRUSTED_SOURCE_TYPE, 1);
  assert.deepEqual(result.acceptedSources, []);
  assert.deepEqual(result.externalFacts, []);
});

test("a source domain absent from provider metadata is discarded", () => {
  const result = validateProductDescriptionResearch(
    researchPayload,
    [{ type: "web_search_call", action: { sources: [{ url: "https://other.example/item" }] } }],
    helmet,
    5
  );
  assert.equal(result.sourceCount, 0);
  assert.equal(result.summary.discardReasonCounts.DOMAIN_NOT_IN_PROVIDER_SOURCES, 1);
});

test("another model without an exact identifier is not used", () => {
  const payload = {
    sources: [{ ...researchPayload.sources[0], matchedIdentifiers: ["Outro Modelo"] }]
  };
  const result = validateProductDescriptionResearch(payload, providerOutput, helmet, 5);
  assert.equal(result.sourceCount, 0);
  assert.equal(result.summary.discardReasonCounts.IDENTIFIER_MISMATCH, 1);
});

test("official product-line evidence can be applied to a variant", () => {
  const payload = {
    sources: [{
      ...researchPayload.sources[0],
      evidenceLevel: "OFFICIAL_PRODUCT_LINE" as const,
      facts: [{
        fact: "Todos os capacetes Play usam casco ABS",
        sourceField: "catalog.play.shellMaterial",
        confidence: "HIGH" as const
      }]
    }]
  };
  const result = validateProductDescriptionResearch(payload, providerOutput, helmet, 5);
  assert.equal(result.evidence[0]?.evidenceLevel, "OFFICIAL_PRODUCT_LINE");
});

test("distributor claims cannot become official product-line evidence", () => {
  const payload = {
    sources: [{
      ...researchPayload.sources[0],
      sourceType: "AUTHORIZED_DISTRIBUTOR" as const,
      evidenceLevel: "OFFICIAL_PRODUCT_LINE" as const
    }]
  };
  const result = validateProductDescriptionResearch(payload, providerOutput, helmet, 5);
  assert.equal(result.sourceCount, 0);
  assert.equal(result.summary.discardReasonCounts.LINE_EVIDENCE_NOT_OFFICIAL, 1);
});

test("conflicting lower-priority facts are omitted", () => {
  const payload = {
    sources: [
      researchPayload.sources[0],
      {
        ...researchPayload.sources[0],
        domain: "distribuidor.example",
        sourceType: "AUTHORIZED_DISTRIBUTOR" as const,
        evidenceLevel: "AUTHORIZED_DISTRIBUTOR" as const,
        facts: [{
          fact: "Material do casco: policarbonato",
          sourceField: "technical.shellMaterial",
          confidence: "HIGH" as const
        }]
      }
    ]
  };
  const output = [{
    type: "web_search_call",
    action: { sources: [
      { url: "https://racetech.example/catalogos/play.pdf" },
      { url: "https://distribuidor.example/play" }
    ] }
  }];
  const result = validateProductDescriptionResearch(payload, output, helmet, 5);
  assert.ok(result.evidence.some((item) => item.fact === "Material do casco: ABS"));
  assert.ok(!result.evidence.some((item) => item.fact === "Material do casco: policarbonato"));
  assert.ok(result.summary.fieldsOmitted >= 1);
});

test("zero useful sources returns a local-only research result", () => {
  const result = validateProductDescriptionResearch({ sources: [] }, providerOutput, helmet, 5);
  assert.equal(result.sourceCount, 0);
  assert.equal(result.officialSourceCount, 0);
});

test("local evidence preserves false and zero values", () => {
  const facts = buildLocalProductDescriptionEvidence({ ...helmet, volumes: "0", freeShipping: false });
  assert.ok(facts.some((item) => item.fact === "freeShipping: false"));
  assert.ok(facts.some((item) => item.fact === "volumes: 0"));
});

test("local evidence excludes private attributes", () => {
  const serialized = JSON.stringify(buildLocalProductDescriptionEvidence({
    ...helmet,
    attributes: { material: "ABS", accessToken: "secret", salePrice: "100" }
  }));
  assert.match(serialized, /ABS/);
  assert.doesNotMatch(serialized, /secret|salePrice|100/);
});

test("complete helmet facts satisfy the evidence guard", () => {
  const evidence = [...buildLocalProductDescriptionEvidence(helmet), ...validatedResearch().evidence];
  assert.deepEqual(
    filterOpenAIProductDescriptionByEvidence(helmetContent, evidence).content,
    helmetContent
  );
});

test("ABS is rejected without ABS evidence", () => {
  const evidence = buildLocalProductDescriptionEvidence(helmet);
  assertEvidenceRejected(helmetContent, evidence);
});

test("certification is rejected without certification evidence", () => {
  const content = {
    ...helmetContent,
    fichaTecnica: [...helmetContent.fichaTecnica, "Certificação: ECE 22.06"]
  };
  assertEvidenceRejected(content, [...buildLocalProductDescriptionEvidence(helmet), ...validatedResearch().evidence]);
});

test("visor thickness is rejected without exact numeric evidence", () => {
  const content = {
    ...helmetContent,
    fichaTecnica: [...helmetContent.fichaTecnica, "Espessura da viseira: 2 mm"]
  };
  assertEvidenceRejected(content, [...buildLocalProductDescriptionEvidence(helmet), ...validatedResearch().evidence]);
});

test("package content is rejected when quantity evidence is absent", () => {
  const evidence = validatedResearch().evidence.filter((item) => item.sourceField !== "package.content");
  assertEvidenceRejected(helmetContent, [...buildLocalProductDescriptionEvidence(helmet), ...evidence]);
});

test("compatibility is rejected without compatibility evidence", () => {
  const content = { ...helmetContent, compatibilidade: ["Compatível com motocicleta X"] };
  assertEvidenceRejected(content, [...buildLocalProductDescriptionEvidence(helmet), ...validatedResearch().evidence]);
});

test("backend renders the complete approved helmet structure", () => {
  const html = buildOpenAIProductDescriptionHtml(helmet.name, helmetContent, { category: helmet.category });
  for (const heading of [
    "Ficha Técnica:",
    "Vantagens:",
    "Conteúdo da Embalagem:",
    "Dimensões:",
    "Orientações de Uso e Ajuste:",
    "Cuidados e Manutenção:",
    "Mais sobre o Produto:"
  ]) assert.match(html, new RegExp(heading));
  assert.doesNotMatch(html, /https?:|www\.|\[fonte|Especificações:/i);
});

test("introduction supports one to three backend paragraphs", () => {
  const html = buildOpenAIProductDescriptionHtml(helmet.name, helmetContent, { category: helmet.category });
  assert.match(html, /uso urbano\.<\/p><p>O casco em ABS/);
});

test("tutorial is an ordered compact list", () => {
  const html = buildOpenAIProductDescriptionHtml(helmet.name, helmetContent, { category: helmet.category });
  assert.match(html, /<ol><li>Posicione o capacete corretamente\.<\/li><li>Regule o fecho/);
  assert.doesNotMatch(html, /<ol>\s|<\/li>\s+<li>/);
});

test("conditional compatibility is omitted for helmet sizing", () => {
  const html = buildOpenAIProductDescriptionHtml(helmet.name, helmetContent, { category: helmet.category });
  assert.doesNotMatch(html, /Compatibilidade:/);
});

test("a complete mocked operation uses research evidence and returns summary counts", async () => {
  let calls = 0;
  const result = await generateOpenAIProductDescription(
    { product: helmet },
    {
      env: {
        OPENAI_DESCRIPTION_AI_ENABLED: "true",
        OPENAI_DESCRIPTION_MODEL: "mock-model",
        OPENAI_API_KEY: "mock-key"
      },
      createResponse: async () => {
        calls += 1;
        return calls === 1
          ? {
              httpStatus: 200,
              status: "completed",
              outputParsed: researchPayload,
              output: providerOutput,
              refusalPresent: false
            }
          : {
              httpStatus: 200,
              status: "completed",
              outputParsed: referencedContent(
                helmetContent,
                [...buildLocalProductDescriptionEvidence(helmet), ...validatedResearch().evidence]
              ),
              output: [],
              refusalPresent: false
            };
      }
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.usedWebSearch, true);
  assert.equal(result.evidenceLevel, "LOCAL_AND_WEB");
  assert.equal(result.researchSummary.officialSourcesFound, 1);
  assert.equal(result.warnings.length, 0);
});

test("semantic mismatch telemetry identifies the rejected item without logging its text", async () => {
  const research = validatedResearch();
  const identifierEvidence = research.evidence.find((fact) => (
    fact.sourceType === "OFFICIAL_CATALOG" && fact.semanticType === "IDENTIFIER"
  ));
  assert.ok(identifierEvidence);
  const failedContent: OpenAIProductDescriptionReferencedContent = {
    introducao: [{
      text: "Capacete com casco em ABS.",
      evidenceIds: [identifierEvidence.id]
    }],
    fichaTecnica: [],
    compatibilidade: [],
    vantagens: [],
    conteudoEmbalagem: [],
    dimensoes: [],
    tutorialInstalacao: [],
    cuidadosManutencao: [],
    maisSobreProduto: []
  };
  const logs: OpenAIProductDescriptionLogEvent[] = [];
  let calls = 0;
  await assert.rejects(() => generateOpenAIProductDescription(
    { product: helmet },
    {
      env: {
        OPENAI_DESCRIPTION_AI_ENABLED: "true",
        OPENAI_DESCRIPTION_MODEL: "mock-model",
        OPENAI_API_KEY: "mock-key"
      },
      logger: (event) => logs.push(event),
      createResponse: async () => {
        calls += 1;
        return calls === 1
          ? {
              httpStatus: 200,
              status: "completed",
              outputParsed: researchPayload,
              output: providerOutput,
              refusalPresent: false
            }
          : {
              httpStatus: 200,
              status: "completed",
              outputParsed: failedContent,
              output: [],
              refusalPresent: false
            };
      }
    }
  ), (error: unknown) => error instanceof OpenAIProductDescriptionError &&
    error.code === "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE");

  const terminal = logs.at(-1);
  assert.equal(terminal?.validationRule, "referenced_fact_evidence");
  assert.equal(terminal?.rejectedField, "introducao[0]");
  assert.equal(terminal?.rejectionReason, "semantic_mismatch");
  assert.deepEqual(terminal?.evidenceRejection, {
    section: "introducao",
    index: 0,
    semanticType: "MATERIAL",
    claimCount: 1,
    evidenceIdCount: 1,
    evidenceIds: [identifierEvidence.id],
    claimedSemanticTypes: ["MATERIAL"],
    evidenceSemanticTypes: ["IDENTIFIER"],
    sourceLevels: ["EXACT_PRODUCT"],
    invalidEvidenceReason: "SEMANTIC_MISMATCH",
    whetherOptional: false,
    filteringDecision: "REJECTED_SEMANTIC_MISMATCH"
  });
  assert.equal(terminal?.externalFactsAvailable, officialFacts.length);
  assert.equal(terminal?.externalFactsReferenced, 1);
  assert.equal(terminal?.externalFactsValidated, 0);
  assert.equal(terminal?.externalFactsOmitted, 1);
  assert.equal(terminal?.sectionItemCounts.introducao, 1);
  assert.equal(terminal?.acceptedSources[0]?.sourceType, "OFFICIAL_CATALOG");
  assert.doesNotMatch(JSON.stringify(logs), /Capacete com casco|Marca: Race Tech|racetech\.example/);
});

test("zero official sources produces a safe internal warning", async () => {
  const partialContent: OpenAIProductDescriptionContent = {
    introducao: ["Capacete Race Tech Play cadastrado no tamanho 54/XS."],
    fichaTecnica: ["Marca: Race Tech", "Tamanho: 54/XS", "GTIN/EAN: 7908167822585"],
    compatibilidade: [],
    vantagens: [],
    conteudoEmbalagem: [],
    dimensoes: [],
    tutorialInstalacao: [],
    cuidadosManutencao: [],
    maisSobreProduto: []
  };
  let calls = 0;
  const result = await generateOpenAIProductDescription(
    { product: helmet },
    {
      env: {
        OPENAI_DESCRIPTION_AI_ENABLED: "true",
        OPENAI_DESCRIPTION_MODEL: "mock-model",
        OPENAI_API_KEY: "mock-key"
      },
      createResponse: async () => {
        calls += 1;
        return calls === 1
          ? {
              httpStatus: 200,
              status: "completed",
              outputParsed: { sources: [] },
              output: [{ type: "web_search_call", action: { sources: [] } }],
              refusalPresent: false
            }
          : {
              httpStatus: 200,
              status: "completed",
              outputParsed: referencedContent(
                partialContent,
                buildLocalProductDescriptionEvidence(helmet)
              ),
              output: [],
              refusalPresent: false
            };
      }
    }
  );
  assert.deepEqual(result.warnings, ["OFFICIAL_SOURCES_NOT_FOUND"]);
  assert.equal(result.evidenceLevel, "LOCAL_ONLY");
  assert.equal(result.usedWebSearch, true);
  assert.match(result.html, /Marca: Race Tech/);
  assert.match(result.html, /Linha: Play/);
  assert.match(result.html, /Cor: Matte Black/);
  assert.match(result.html, /Tamanho: 54\/XS/);
  assert.match(result.html, /Altura: 27 CM/);
  assert.doesNotMatch(result.html, /ABS|EPS|policarbonato|certificação/i);
  assert.doesNotMatch(result.html, /OFFICIAL_SOURCES_NOT_FOUND/);
});

test("an accepted source without usable facts does not promote the final evidence level", async () => {
  const sourceWithoutFacts = {
    sources: [{
      ...researchPayload.sources[0],
      facts: researchPayload.sources[0].facts.map((fact) => ({
        ...fact,
        confidence: "LOW" as const
      }))
    }]
  };
  const localContent: OpenAIProductDescriptionContent = {
    introducao: ["Capacete Race Tech Play Monocolor cadastrado no tamanho 54/XS."],
    fichaTecnica: ["Marca: Race Tech", "Modelo: Play Monocolor"],
    compatibilidade: [],
    vantagens: [],
    conteudoEmbalagem: [],
    dimensoes: [],
    tutorialInstalacao: [],
    cuidadosManutencao: [],
    maisSobreProduto: []
  };
  let calls = 0;
  const result = await generateOpenAIProductDescription(
    { product: helmet },
    {
      env: {
        OPENAI_DESCRIPTION_AI_ENABLED: "true",
        OPENAI_DESCRIPTION_MODEL: "mock-model",
        OPENAI_API_KEY: "mock-key"
      },
      createResponse: async () => {
        calls += 1;
        return calls === 1
          ? {
              httpStatus: 200,
              status: "completed",
              outputParsed: sourceWithoutFacts,
              output: providerOutput,
              refusalPresent: false
            }
          : {
              httpStatus: 200,
              status: "completed",
              outputParsed: referencedContent(
                localContent,
                buildLocalProductDescriptionEvidence(helmet)
              ),
              output: [],
              refusalPresent: false
            };
      }
    }
  );
  assert.equal(result.researchSummary.officialSourcesFound, 1);
  assert.equal(result.evidenceLevel, "LOCAL_ONLY");
});

test("research telemetry contains counts but no source URLs", () => {
  const result = validatedResearch();
  const serialized = JSON.stringify(result.summary);
  assert.equal(result.summary.queriesAttempted, 1);
  assert.equal(result.summary.officialSourcesFound, 1);
  assert.doesNotMatch(serialized, /https?:|racetech\.example/);
});

test("discarded external facts never enter the local-only generation context", () => {
  const rejected = validateProductDescriptionResearch(
    researchPayload,
    [{ type: "web_search_call", action: { sources: [{ url: "https://other.example/item" }] } }],
    helmet,
    1
  );
  assert.equal(rejected.officialSourceCount, 0);
  assert.equal(rejected.evidence.length, 0);
  const request = buildOpenAIProductDescriptionRequest(
    { product: helmet },
    readOpenAIProductDescriptionConfig({
      OPENAI_DESCRIPTION_AI_ENABLED: "true",
      OPENAI_DESCRIPTION_MODEL: "mock-model",
      OPENAI_API_KEY: "mock-key"
    }),
    buildLocalProductDescriptionEvidence(helmet),
    "LOCAL_ONLY_STRICT"
  );
  const serialized = request.input[1].content;
  assert.match(serialized, /LOCAL_ONLY_STRICT/);
  assert.doesNotMatch(serialized, /ABS|EPS|policarbonato|ventila[cç][aã]o/i);
});
