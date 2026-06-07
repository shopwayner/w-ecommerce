export const AI_NOT_CONFIGURED_MESSAGE = "IA não configurada. Configure OPENAI_API_KEY no ambiente para usar geração real.";

export type AIModule =
  | "title-generation"
  | "description-generation"
  | "classification"
  | "price-suggestion"
  | "ad-diagnosis";

export type AIProductContext = {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  description: string | null;
  category: string | null;
  origin: string | null;
  unit: string | null;
  status: string;
  displayValue: string | null;
  salePriceDisplay: string | null;
  costPrice: number;
  salePrice: number;
  stock: number;
  imageUrl: string | null;
  hasEnrichmentDraft: boolean;
  enrichmentDraft?: {
    generatedTitle: string;
    generatedDescription: string;
    technicalSpecs: unknown;
    dimensions: unknown;
    compatibility: unknown;
    sources: unknown;
  } | null;
};

export type AIRequestInput = {
  module: AIModule;
  product: AIProductContext;
  marketplace: string;
  titleLimit?: number;
  selectedTitle?: string;
  marginPercent?: number;
  marketplaceFeePercent?: number;
  taxPercent?: number;
  estimatedFreight?: number;
  manualNotes?: string;
};

export type AIResult = {
  configured: boolean;
  module: AIModule;
  marketplace: string;
  status: "GENERATED" | "NEEDS_REVIEW" | "ERROR";
  searchMode?: "EAN/GTIN" | "Nome";
  message?: string;
  result: Record<string, unknown>;
};

const moduleNames: Record<AIModule, string> = {
  "title-generation": "Geração de títulos",
  "description-generation": "Descrições inteligentes",
  classification: "Classificação automática",
  "price-suggestion": "Sugestão de preço",
  "ad-diagnosis": "Diagnóstico de anúncios"
};

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const enabled = process.env.OPENAI_ENABLED?.trim();
  const maxTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 1800);

  return {
    apiKey,
    configured: Boolean(apiKey) && enabled !== "0" && enabled?.toLowerCase() !== "false",
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 1800
  };
}

export function getAIStatus() {
  const config = getOpenAIConfig();

  return {
    configured: config.configured,
    enabled: config.configured,
    model: config.configured ? config.model : null,
    message: config.configured ? "IA configurada para geração real no backend." : AI_NOT_CONFIGURED_MESSAGE,
    modules: Object.entries(moduleNames).map(([id, name]) => ({ id, name, available: true }))
  };
}

function asBrazilianMoney(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function normalizeLimit(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return 60;
  return Math.min(Math.max(Math.round(value), 30), 120);
}

function clampTitle(title: string, limit: number) {
  const compact = title.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return compact.slice(0, limit).replace(/\s+\S*$/, "").trim();
}

function buildFallbackTitleOptions(product: AIProductContext, limit: number) {
  const base = clampTitle(product.name, limit);
  const withSku = clampTitle(`${product.name} ${product.sku}`, limit);
  const withCategory = product.category ? clampTitle(`${product.name} ${product.category}`, limit) : base;
  const unique = Array.from(new Set([base, withSku, withCategory, base, base])).slice(0, 5);

  while (unique.length < 5) unique.push(base);

  return unique.map((title, index) => ({
    title,
    characters: title.length,
    score: index === 0 ? 55 : 45,
    reason: "Base local para revisão manual, sem geração real de IA.",
    inferredFields: [],
    needsReview: true
  }));
}

function calculatePrice(input: AIRequestInput) {
  const cost = input.product.costPrice || Number(input.product.displayValue?.replace(/\./g, "").replace(",", ".") ?? 0);
  const margin = Math.max(input.marginPercent ?? 30, 0);
  const fee = Math.max(input.marketplaceFeePercent ?? 0, 0);
  const tax = Math.max(input.taxPercent ?? 0, 0);
  const freight = Math.max(input.estimatedFreight ?? 0, 0);
  const divisor = Math.max(1 - (margin + fee + tax) / 100, 0.1);
  const suggested = (cost + freight) / divisor;
  const minimum = (cost + freight) / Math.max(1 - (fee + tax) / 100, 0.1);
  const premium = suggested * 1.12;

  return {
    minimumRecommendedPrice: Number(minimum.toFixed(2)),
    suggestedPrice: Number(suggested.toFixed(2)),
    premiumPrice: Number(premium.toFixed(2)),
    estimatedMarginPercent: margin,
    formula: `(custo ${asBrazilianMoney(cost)} + frete ${asBrazilianMoney(freight)}) / (1 - margem/taxas)`,
    observations: [
      "Cálculo baseado nos dados internos informados.",
      input.product.salePrice ? `Preço atual: ${asBrazilianMoney(input.product.salePrice)}.` : "Preço atual não informado."
    ],
    risks: fee || tax ? ["Revise comissões e impostos reais antes de aplicar."] : ["Taxas externas não informadas."]
  };
}

function fallbackResult(input: AIRequestInput): AIResult {
  const limit = normalizeLimit(input.titleLimit);
  const price = calculatePrice(input);
  const status: AIResult["status"] = input.module === "price-suggestion" ? "GENERATED" : "NEEDS_REVIEW";

  const resultByModule: Record<AIModule, Record<string, unknown>> = {
    "title-generation": {
      options: buildFallbackTitleOptions(input.product, limit),
      selectedTitle: clampTitle(input.product.name, limit),
      qualityScore: 55,
      reviewAlerts: [AI_NOT_CONFIGURED_MESSAGE, "Revise manualmente antes de salvar ou aplicar."]
    },
    "description-generation": {
      text: buildDescriptionTemplate(input.product, input.selectedTitle || input.product.name),
      reviewAlerts: [AI_NOT_CONFIGURED_MESSAGE, "Descrição criada como modelo editável com dados locais."]
    },
    classification: {
      suggestedCategory: input.product.category ?? "Não informado",
      suggestedSubcategory: "Não informado",
      suggestedAttributes: [],
      possibleCompatibilities: [],
      confidence: "Baixa",
      pendingFields: ["atributos", "compatibilidade", "marca"],
      reviewAlerts: [AI_NOT_CONFIGURED_MESSAGE]
    },
    "price-suggestion": {
      ...price,
      reviewAlerts: ["Resultado calculado por fórmula local. IA real não configurada."]
    },
    "ad-diagnosis": {
      overallScore: scoreProduct(input.product),
      issues: diagnoseIssues(input.product),
      opportunities: ["Completar ficha técnica", "Adicionar imagem e EAN/GTIN quando possível"],
      checklist: buildChecklist(input.product),
      suggestions: ["Revise título, descrição, categoria e imagem antes da publicação."],
      priority: "Média",
      reviewAlerts: [AI_NOT_CONFIGURED_MESSAGE]
    }
  };

  return {
    configured: false,
    module: input.module,
    marketplace: input.marketplace,
    status,
    searchMode: input.product.ean ? "EAN/GTIN" : "Nome",
    message: AI_NOT_CONFIGURED_MESSAGE,
    result: resultByModule[input.module]
  };
}

function buildDescriptionTemplate(product: AIProductContext, title: string) {
  return `Título do Produto:
${title}

Descrição do Produto:
${product.description || "Texto comercial a revisar com base nas informações do produto."}

Ficha Técnica:
* Produto: ${product.name}
* SKU: ${product.sku}
* EAN/GTIN: ${product.ean || "Não informado"}
* Unidade: ${product.unit || "Não informado"}
* Categoria: ${product.category || "Não informado"}
* Aplicação: Não informado
* Material: Não informado
* Medidas: Não informado
* Marca: ${product.origin || "Não informado"}
* Origem: ${product.origin || "Não informado"}
* Observações: ${product.description || "Não informado"}

Dimensões do Produto:
* Altura: Não informado
* Largura: Não informado
* Comprimento: Não informado
* Peso: Não informado

Compatibilidade do Produto:
Compatibilidade não confirmada.

Vantagens:
* Produto cadastrado para revisão
* Informações organizadas para anúncio
* Conteúdo editável antes da publicação

Conteúdo da Embalagem:
* 1x ${title}

Tutorial de Instalação:
Recomenda-se instalação por profissional qualificado quando aplicável.

Cuidados e Manutenção:
Confira compatibilidade, medidas e aplicação antes da compra.`;
}

function buildChecklist(product: AIProductContext) {
  return {
    titleAdequate: Boolean(product.name),
    descriptionComplete: Boolean(product.description && product.description.length > 80),
    technicalSpecsComplete: Boolean(product.category && product.unit),
    compatibilityClear: Boolean(product.enrichmentDraft),
    priceCoherent: product.salePrice > 0,
    imagePresent: Boolean(product.imageUrl),
    gtinPresent: Boolean(product.ean),
    categoryFilled: Boolean(product.category)
  };
}

function diagnoseIssues(product: AIProductContext) {
  const issues: string[] = [];
  if (!product.ean) issues.push("EAN/GTIN ausente.");
  if (!product.imageUrl) issues.push("Imagem principal ausente.");
  if (!product.description) issues.push("Descrição ausente ou incompleta.");
  if (!product.category) issues.push("Categoria não preenchida.");
  if (!product.salePrice) issues.push("Preço de venda não informado.");
  return issues.length ? issues : ["Nenhum problema crítico nos dados locais."];
}

function scoreProduct(product: AIProductContext) {
  const checklist = buildChecklist(product);
  const total = Object.values(checklist).filter(Boolean).length;
  return Math.round((total / Object.keys(checklist).length) * 100);
}

function systemPrompt(module: AIModule) {
  return `Você é um assistente de cadastro de produtos para e-commerce e marketplaces no Brasil.
Responda sempre em JSON válido, sem markdown.
Use português brasileiro.
Nunca invente dado como certeza. Quando inferir algo, marque como inferido e precisa de revisão.
Não publique, não altere estoque, não altere preço e não assuma dados externos inexistentes.
Módulo atual: ${moduleNames[module]}.`;
}

function userPrompt(input: AIRequestInput) {
  const limit = normalizeLimit(input.titleLimit);
  const price = calculatePrice(input);

  const moduleInstructions: Record<AIModule, string> = {
    "title-generation": `Gere 5 títulos para ${input.marketplace}. Limite: ${limit} caracteres. Retorne { "options": [{ "title", "characters", "score", "reason", "inferredFields", "needsReview" }], "selectedTitle", "qualityScore", "reviewAlerts" }.`,
    "description-generation": `Gere uma descrição completa no formato solicitado, com campos desconhecidos como "Não informado". Retorne { "text", "sections", "reviewAlerts" }.`,
    classification: `Sugira categoria, subcategoria, atributos e compatibilidades. Retorne { "suggestedCategory", "suggestedSubcategory", "suggestedAttributes", "possibleCompatibilities", "confidence", "pendingFields", "reviewAlerts" }.`,
    "price-suggestion": `Analise a sugestão de preço calculada internamente e complemente observações. Não invente concorrência. Retorne { "minimumRecommendedPrice", "suggestedPrice", "premiumPrice", "estimatedMarginPercent", "formula", "observations", "risks", "reviewAlerts" }. Cálculo interno: ${JSON.stringify(price)}.`,
    "ad-diagnosis": `Faça diagnóstico do anúncio. Retorne { "overallScore", "issues", "opportunities", "checklist", "suggestions", "priority", "reviewAlerts" }.`
  };

  return JSON.stringify({
    instruction: moduleInstructions[input.module],
    marketplace: input.marketplace,
    product: input.product,
    options: {
      titleLimit: limit,
      selectedTitle: input.selectedTitle,
      marginPercent: input.marginPercent,
      marketplaceFeePercent: input.marketplaceFeePercent,
      taxPercent: input.taxPercent,
      estimatedFreight: input.estimatedFreight,
      manualNotes: input.manualNotes
    }
  });
}

function parseJSONResponse(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed) as Record<string, unknown>;
}

async function callOpenAI(input: AIRequestInput) {
  const config = getOpenAIConfig();
  if (!config.configured || !config.apiKey) return fallbackResult(input);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt(input.module) },
        { role: "user", content: userPrompt(input) }
      ],
      response_format: { type: "json_object" },
      max_tokens: config.maxTokens,
      temperature: 0.4
    })
  });

  if (!response.ok) {
    return {
      ...fallbackResult(input),
      configured: true,
      status: "ERROR" as const,
      message: "Erro na busca de IA. Revise a configuração e tente novamente."
    };
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");

  return {
    configured: true,
    module: input.module,
    marketplace: input.marketplace,
    status: "GENERATED" as const,
    searchMode: input.product.ean ? "EAN/GTIN" : "Nome",
    result: parseJSONResponse(content)
  };
}

export async function generateProductTitles(input: Omit<AIRequestInput, "module">) {
  return callOpenAI({ ...input, module: "title-generation" });
}

export async function generateProductDescription(input: Omit<AIRequestInput, "module">) {
  return callOpenAI({ ...input, module: "description-generation" });
}

export async function classifyProduct(input: Omit<AIRequestInput, "module">) {
  return callOpenAI({ ...input, module: "classification" });
}

export async function suggestProductPrice(input: Omit<AIRequestInput, "module">) {
  return callOpenAI({ ...input, module: "price-suggestion" });
}

export async function diagnoseAd(input: Omit<AIRequestInput, "module">) {
  return callOpenAI({ ...input, module: "ad-diagnosis" });
}

export async function runAIModule(input: AIRequestInput) {
  if (input.module === "title-generation") return generateProductTitles(input);
  if (input.module === "description-generation") return generateProductDescription(input);
  if (input.module === "classification") return classifyProduct(input);
  if (input.module === "price-suggestion") return suggestProductPrice(input);
  return diagnoseAd(input);
}

export function isAIModule(value: string): value is AIModule {
  return value in moduleNames;
}
