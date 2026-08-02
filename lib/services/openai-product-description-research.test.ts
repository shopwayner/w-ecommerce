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
  filterOpenAIProductDescriptionByEvidence,
  generateOpenAIProductDescription,
  OpenAIProductDescriptionError,
  type OpenAIProductDescriptionContent,
  type ProductDescriptionSource
} from "./openai-product-description-service";

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
              outputParsed: helmetContent,
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
              outputParsed: partialContent,
              output: [],
              refusalPresent: false
            };
      }
    }
  );
  assert.deepEqual(result.warnings, ["OFFICIAL_SOURCES_NOT_FOUND"]);
  assert.doesNotMatch(result.html, /ABS|EPS|policarbonato|certificação/i);
  assert.doesNotMatch(result.html, /OFFICIAL_SOURCES_NOT_FOUND/);
});

test("research telemetry contains counts but no source URLs", () => {
  const result = validatedResearch();
  const serialized = JSON.stringify(result.summary);
  assert.equal(result.summary.queriesAttempted, 1);
  assert.equal(result.summary.officialSourcesFound, 1);
  assert.doesNotMatch(serialized, /https?:|racetech\.example/);
});
