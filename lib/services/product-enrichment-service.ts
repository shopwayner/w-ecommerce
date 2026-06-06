import type { Prisma } from "@prisma/client";
import { searchMercadoLivreProduct } from "@/lib/services/providers/mercado-livre-provider";

type ProductForEnrichment = {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  category: string | null;
  brand: string | null;
  status: string;
  blockedFields: Prisma.JsonValue | null;
  prices: Array<{ salePrice: { toString(): string } }>;
  inventory: Array<{ physicalQuantity: number; reservedQuantity: number }>;
};

type ProductMetadata = {
  unit: string;
  origin: string;
  displayValue: string;
  salePriceDisplay: string;
};

function readMetadata(product: ProductForEnrichment): ProductMetadata {
  const fields = product.blockedFields && typeof product.blockedFields === "object" && !Array.isArray(product.blockedFields) ? product.blockedFields : {};
  const metadata = fields as Record<string, unknown>;

  return {
    unit: typeof metadata.unit === "string" ? metadata.unit : "Nao informado",
    origin: typeof metadata.origin === "string" ? metadata.origin : product.brand ?? "Nao informado",
    displayValue: typeof metadata.displayValue === "string" ? metadata.displayValue : "Nao informado",
    salePriceDisplay: typeof metadata.salePriceDisplay === "string" ? metadata.salePriceDisplay : product.prices[0]?.salePrice.toString() ?? "0,00"
  };
}

function normalizeTitle(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\bINOX\b/gi, "Inox")
    .replace(/\bBROS\b/g, "Bros")
    .replace(/\bXRE\b/g, "XRE")
    .replace(/\bEDD\b/g, "EDD")
    .trim();
}

function buildSuggestedTitle(product: ProductForEnrichment) {
  const name = product.name.toUpperCase();

  if (name.includes("RAIO INOX") && name.includes("BROS160") && name.includes("XRE190")) {
    return "Raio Inox Bace Bros 160/XRE 190 Traseiro Freio Disco";
  }

  const base = normalizeTitle(product.name.toLowerCase().replace(/(^|\s)\S/g, (match) => match.toUpperCase()));
  return base.length <= 60 ? base : base.slice(0, 57).trimEnd() + "...";
}

function limitMarketplaceTitle(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeTitle(value);
  return normalized.length <= 60 ? normalized : normalized.slice(0, 57).trimEnd() + "...";
}

function stockTotal(product: ProductForEnrichment) {
  return product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0);
}

function buildCompatibility(productName: string) {
  const upperName = productName.toUpperCase();
  const inferred: string[] = [];

  if (upperName.includes("BROS160")) inferred.push("Honda Bros 160 (inferido pelo nome original)");
  if (upperName.includes("XRE190")) inferred.push("Honda XRE 190 (inferido pelo nome original)");
  if (upperName.includes("BIZ125")) inferred.push("Honda Biz 125 (inferido pelo nome original)");
  if (upperName.includes("BIZ100")) inferred.push("Honda Biz 100 (inferido pelo nome original)");
  if (upperName.includes("TITAN150")) inferred.push("Honda Titan 150 (inferido pelo nome original)");

  return inferred.length ? inferred : ["Compatibilidade nao confirmada"];
}

export async function generateProductEnrichmentDraft(product: ProductForEnrichment) {
  const metadata = readMetadata(product);
  const mercadoLivre = await searchMercadoLivreProduct({ ean: product.ean, name: product.name });
  const mercadoLivreTitle = limitMarketplaceTitle(mercadoLivre.bestResult?.title);
  const generatedTitle = mercadoLivreTitle ?? buildSuggestedTitle(product);
  const searchMode = product.ean ? "EAN/GTIN" : "nome do produto";
  const sources = [
    {
      provider: "Amazon",
      status: product.ean ? "Nao configurado" : "Nao consultado",
      query: product.ean ?? null,
      url: null,
      summary: product.ean ? "API da Amazon nao configurada neste ambiente." : "Produto sem EAN/GTIN para consulta prioritaria."
    },
    {
      provider: "Mercado Livre",
      status: mercadoLivre.status,
      query: mercadoLivre.query,
      url: mercadoLivre.bestResult?.url ?? null,
      title: mercadoLivre.bestResult?.title ?? null,
      price: mercadoLivre.bestResult?.price ?? null,
      image: mercadoLivre.bestResult?.image ?? null,
      category: mercadoLivre.bestResult?.category ?? null,
      brand: mercadoLivre.bestResult?.brand ?? null,
      attributes: mercadoLivre.bestResult?.attributes ?? {},
      compatibility: mercadoLivre.bestResult?.compatibility ?? [],
      alternatives: mercadoLivre.alternatives.map((alternative) => ({
        title: alternative.title,
        price: alternative.price,
        url: alternative.url,
        image: alternative.image,
        category: alternative.category,
        brand: alternative.brand
      })),
      searchMode: mercadoLivre.searchMode,
      configured: mercadoLivre.configured,
      summary:
        mercadoLivre.status === "Encontrado" && mercadoLivre.bestResult?.title
          ? `Titulo encontrado: ${mercadoLivre.bestResult.title}`
          : mercadoLivre.status === "Nao configurado"
            ? "API do Mercado Livre nao configurada neste ambiente."
            : mercadoLivre.status === "Erro na busca"
              ? "Erro na busca do Mercado Livre. Rascunho local preservado."
              : "Nenhum resultado encontrado no Mercado Livre."
    },
    {
      provider: "Google",
      status: "Nao configurado",
      query: product.name,
      url: null,
      summary: "Busca externa do Google nao configurada neste ambiente."
    }
  ];

  const technicalSpecs = {
    Produto: generatedTitle,
    SKU: product.sku,
    "EAN/GTIN": product.ean ?? "Nao informado",
    Unidade: metadata.unit,
    Categoria: mercadoLivre.bestResult?.category ?? product.category ?? "Nao informado",
    Aplicacao: (mercadoLivre.bestResult?.compatibility.length ? mercadoLivre.bestResult.compatibility : buildCompatibility(product.name)).join("; "),
    Material: product.name.toUpperCase().includes("INOX") ? "Inox (inferido pelo nome original)" : "Nao informado",
    Medidas: "Nao informado",
    Marca: mercadoLivre.bestResult?.brand ?? "Nao informado",
    Origem: metadata.origin,
    Observacoes: mercadoLivre.bestResult ? "Rascunho usa resultado do Mercado Livre e precisa de revisao." : "Rascunho gerado para revisao. Informacoes externas nao configuradas."
  };

  return {
    originalName: product.name,
    generatedTitle,
    generatedDescription: `Rascunho comercial para ${generatedTitle}. Produto gerado com base no cadastro local e no nome original. Revise aplicacao, marca, medidas e compatibilidade antes de publicar em qualquer marketplace.`,
    technicalSpecs,
    dimensions: {
      Altura: "Nao informado",
      Largura: "Nao informado",
      Comprimento: "Nao informado",
      Peso: "Nao informado"
    },
    compatibility: mercadoLivre.bestResult?.compatibility.length ? mercadoLivre.bestResult.compatibility : buildCompatibility(product.name),
    advantages: ["Cadastro estruturado para e-commerce", "Informacoes organizadas para revisao", "Base pronta para complementar com fontes oficiais"],
    packageContent: [`1x ${generatedTitle}`],
    installationTutorial:
      "Confira se a peca corresponde ao modelo da moto antes da instalacao. Para pecas tecnicas, recomenda-se instalacao por profissional qualificado.",
    careInstructions:
      "Armazene em local seco, confira encaixes antes da montagem e evite instalacao forcada para preservar a peca e a seguranca do conjunto.",
    sources,
    status: "NEEDS_REVIEW",
    search: {
      mode: mercadoLivre.searchMode ?? searchMode,
      status: "Precisa de revisao",
      rawResult:
        mercadoLivre.status === "Encontrado"
          ? `Mercado Livre consultado por ${mercadoLivre.searchMode}. Resultado principal: ${mercadoLivre.bestResult?.title ?? "sem titulo"}.`
          : mercadoLivre.status === "Nao configurado"
            ? "Pesquisa externa nao configurada. Rascunho basico criado a partir do cadastro local."
            : `${mercadoLivre.status}. Rascunho basico criado a partir do cadastro local.`
    },
    baseData: {
      name: product.name,
      sku: product.sku,
      ean: product.ean ?? "Nao informado",
      unit: metadata.unit,
      category: product.category ?? "Nao informado",
      origin: metadata.origin,
      displayValue: metadata.displayValue,
      salePrice: metadata.salePriceDisplay,
      stock: stockTotal(product),
      blingStatus: "Sem Bling"
    }
  };
}

export function formatDraftContent(draft: Awaited<ReturnType<typeof generateProductEnrichmentDraft>>) {
  const specEntries = Object.entries(draft.technicalSpecs)
    .map(([key, value]) => `* ${key}: ${value}`)
    .join("\n");
  const dimensionEntries = Object.entries(draft.dimensions)
    .map(([key, value]) => `* ${key}: ${value}`)
    .join("\n");

  return `Titulo do Produto:
${draft.generatedTitle}

Descricao do Produto:
${draft.generatedDescription}

Ficha Tecnica:
${specEntries}

Dimensoes do Produto:
${dimensionEntries}

Compatibilidade do Produto:
${draft.compatibility.join("\n")}

Vantagens:
${draft.advantages.map((item) => `* ${item}`).join("\n")}

Conteudo da Embalagem:
${draft.packageContent.map((item) => `* ${item}`).join("\n")}

Tutorial de Instalacao:
${draft.installationTutorial}

Cuidados e Manutencao:
${draft.careInstructions}`;
}
