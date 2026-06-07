"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Clipboard,
  FileText,
  Gauge,
  Loader2,
  PackageSearch,
  Save,
  Search,
  Sparkles,
  Tags,
  X
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

type AIModuleId = "title-generation" | "description-generation" | "classification" | "price-suggestion" | "ad-diagnosis";

type ProductListItem = {
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
  imageUrl: string | null;
  hasEnrichmentDraft: boolean;
  price: string;
  stock: number;
  updatedAt: string;
};

type AIStatus = {
  configured: boolean;
  model: string | null;
  message: string;
};

type RunResult = {
  jobId: string;
  configured: boolean;
  module: AIModuleId;
  marketplace: string;
  status: "GENERATED" | "NEEDS_REVIEW" | "ERROR";
  searchMode?: string;
  message?: string;
  result: Record<string, unknown>;
};

const marketplaces = ["Geral", "Mercado Livre", "Magalu", "Shopee", "Amazon", "TikTok Shop", "Shein"];

const modules: Array<{
  id: AIModuleId;
  title: string;
  detail: string;
  icon: typeof Sparkles;
}> = [
  {
    id: "title-generation",
    title: "Geração de títulos",
    detail: "Cria 5 opções otimizadas, com limite de caracteres e alertas de revisão.",
    icon: Sparkles
  },
  {
    id: "description-generation",
    title: "Descrições inteligentes",
    detail: "Gera descrição completa, ficha técnica e conteúdo editável para revisão.",
    icon: FileText
  },
  {
    id: "classification",
    title: "Classificação automática",
    detail: "Sugere categoria, atributos, compatibilidades e campos pendentes.",
    icon: Tags
  },
  {
    id: "price-suggestion",
    title: "Sugestão de preço",
    detail: "Calcula preço mínimo, sugerido e premium com margens e taxas.",
    icon: Gauge
  },
  {
    id: "ad-diagnosis",
    title: "Diagnóstico de anúncios",
    detail: "Avalia qualidade do anúncio e mostra checklist para publicação.",
    icon: BadgeCheck
  }
];

function stringifyResult(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function safeParseResult(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return { parsed };
  } catch {
    return { parsed: { text: value } };
  }
}

function getSuggestionTitle(moduleId: AIModuleId, product: ProductListItem | null, resultText: string) {
  const { parsed } = safeParseResult(resultText);
  if (moduleId === "title-generation") {
    const selected = parsed.selectedTitle;
    if (typeof selected === "string" && selected.trim()) return selected.trim();
  }
  return `${modules.find((module) => module.id === moduleId)?.title ?? "Sugestão de IA"} - ${product?.sku ?? "produto"}`;
}

function valueOrDash(value: string | null | undefined) {
  return value?.trim() ? value : "-";
}

export function IAPage() {
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [activeModule, setActiveModule] = useState<AIModuleId | null>(null);
  const [initialProductId, setInitialProductId] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    async function load() {
      setLoadingProducts(true);
      try {
        const [productsResponse, statusResponse] = await Promise.all([fetch("/api/products"), fetch("/api/ai/status")]);
        const productsPayload = (await productsResponse.json()) as { data?: ProductListItem[] };
        const statusPayload = (await statusResponse.json()) as { data?: AIStatus };
        setProducts(productsPayload.data ?? []);
        setStatus(statusPayload.data ?? null);
      } finally {
        setLoadingProducts(false);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const moduleParam = params.get("module");
    const productId = params.get("productId");
    if (moduleParam && modules.some((module) => module.id === moduleParam)) setActiveModule(moduleParam as AIModuleId);
    if (productId) setInitialProductId(productId);
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="IA"
        description="Módulos inteligentes para revisar produtos, criar conteúdo e salvar sugestões sem alterar o cadastro automaticamente."
      />

      {status ? (
        <Card className="mb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-matrix-fg">Status da IA</p>
              <p className="mt-1 text-sm text-matrix-muted">{status.message}</p>
            </div>
            <Badge tone={status.configured ? "success" : "warning"}>{status.configured ? `Configurada${status.model ? `: ${status.model}` : ""}` : "IA não configurada"}</Badge>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <Card key={module.id} className="flex min-h-56 flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-lg bg-matrix-goldSoft/55 text-matrix-goldDark">
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge tone="info">Ativo</Badge>
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-normal text-matrix-fg">{module.title}</h3>
                <p className="mt-2 text-sm leading-6 text-matrix-muted">{module.detail}</p>
              </div>
              <Button className="mt-4 w-full" onClick={() => setActiveModule(module.id)}>
                Abrir módulo
              </Button>
            </Card>
          );
        })}
      </div>

      {activeModule ? (
        <AIModuleWorkspace
          initialProductId={initialProductId}
          loadingProducts={loadingProducts}
          moduleId={activeModule}
          onClose={() => {
            setActiveModule(null);
            setInitialProductId(null);
          }}
          products={products}
          status={status}
        />
      ) : null}
    </AppShell>
  );
}

function AIModuleWorkspace({
  initialProductId,
  loadingProducts,
  moduleId,
  onClose,
  products,
  status
}: {
  initialProductId: string | null;
  loadingProducts: boolean;
  moduleId: AIModuleId;
  onClose: () => void;
  products: ProductListItem[];
  status: AIStatus | null;
}) {
  const activeModuleConfig = modules.find((item) => item.id === moduleId) ?? modules[0];
  const [productId, setProductId] = useState(initialProductId ?? products[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState("Mercado Livre");
  const [titleLimit, setTitleLimit] = useState(60);
  const [marginPercent, setMarginPercent] = useState(30);
  const [marketplaceFeePercent, setMarketplaceFeePercent] = useState(12);
  const [taxPercent, setTaxPercent] = useState(6);
  const [estimatedFreight, setEstimatedFreight] = useState(0);
  const [manualNotes, setManualNotes] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [resultText, setResultText] = useState("");

  useEffect(() => {
    if (initialProductId) setProductId(initialProductId);
  }, [initialProductId]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const product = useMemo(() => products.find((item) => item.id === productId) ?? null, [productId, products]);
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter((item) => `${item.name} ${item.sku} ${item.ean ?? ""}`.toLowerCase().includes(normalized));
  }, [products, query]);

  const titleOptions = useMemo(() => {
    if (!result || moduleId !== "title-generation") return [];
    const options = result.result.options;
    return Array.isArray(options) ? options : [];
  }, [moduleId, result]);

  async function runModule() {
    if (!product) {
      setMessage("Selecione um produto para executar o módulo.");
      return;
    }

    setRunning(true);
    setMessage("");
    try {
      const response = await fetch(`/api/ai/modules/${moduleId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          marketplace,
          titleLimit,
          selectedTitle,
          marginPercent,
          marketplaceFeePercent,
          taxPercent,
          estimatedFreight,
          manualNotes
        })
      });
      const payload = (await response.json()) as { data?: RunResult; error?: string };

      if (!response.ok || !payload.data) {
        setMessage(payload.error ?? "Não foi possível executar o módulo.");
        return;
      }

      setResult(payload.data);
      setResultText(stringifyResult(payload.data.result));
      setMessage(payload.data.message ?? "Resultado gerado para revisão.");
    } finally {
      setRunning(false);
    }
  }

  async function saveSuggestion() {
    if (!product || !resultText.trim()) return;

    setSaving(true);
    setMessage("");
    try {
      const { parsed } = safeParseResult(resultText);
      const response = await fetch("/api/ai/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          aiJobId: result?.jobId ?? null,
          type: moduleId,
          title: getSuggestionTitle(moduleId, product, resultText),
          contentJson: parsed,
          status: result?.status === "GENERATED" ? "GENERATED" : "NEEDS_REVIEW"
        })
      });

      if (!response.ok) {
        setMessage("Não foi possível salvar a sugestão.");
        return;
      }

      setMessage("Sugestão salva como rascunho para revisão.");
    } finally {
      setSaving(false);
    }
  }

  async function copyResult() {
    if (!resultText.trim()) return;
    await navigator.clipboard.writeText(resultText);
    setMessage("Resultado copiado.");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <aside
        aria-modal="true"
        className="matrix-scroll ml-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto rounded-xl border border-matrix-gold/30 bg-matrix-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Módulo de IA</p>
            <h3 className="mt-1 text-2xl font-bold tracking-normal text-matrix-fg">{activeModuleConfig.title}</h3>
            <p className="mt-1 text-sm text-matrix-muted">Gere, edite e salve sugestões. Nada é aplicado ao produto automaticamente.</p>
          </div>
          <button
            aria-label="Fechar módulo de IA"
            className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:border-matrix-gold/45 hover:text-matrix-goldDark"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[330px_1fr]">
          <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
            <div className="flex items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2">
              <Search className="h-4 w-4 text-matrix-goldDark" />
              <input
                className="w-full bg-transparent text-sm text-matrix-fg outline-none placeholder:text-matrix-muted"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por produto, SKU ou EAN"
                value={query}
              />
            </div>

            <div className="matrix-scroll mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {filteredProducts.map((item) => (
                <button
                  key={item.id}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                    item.id === product?.id
                      ? "border-matrix-gold/60 bg-matrix-goldSoft/35 text-matrix-goldDark"
                      : "border-matrix-border text-matrix-fg hover:border-matrix-gold/35"
                  }`}
                  onClick={() => setProductId(item.id)}
                  type="button"
                >
                  <span className="block font-semibold">{item.name}</span>
                  <span className="text-xs text-matrix-muted">{item.sku} {item.ean ? `- ${item.ean}` : ""}</span>
                </button>
              ))}
              {!filteredProducts.length ? (
                <p className="rounded-md border border-matrix-border bg-matrix-panel p-3 text-sm text-matrix-muted">
                  {loadingProducts ? "Carregando produtos..." : "Nenhum produto encontrado."}
                </p>
              ) : null}
            </div>

            <label className="mt-4 grid gap-2 text-sm font-semibold text-matrix-fg">
              Marketplace
              <select
                className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm outline-none"
                onChange={(event) => setMarketplace(event.target.value)}
                value={marketplace}
              >
                {marketplaces.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            {moduleId === "title-generation" ? (
              <label className="mt-4 grid gap-2 text-sm font-semibold text-matrix-fg">
                Limite de caracteres
                <input
                  className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 outline-none"
                  min={30}
                  max={120}
                  onChange={(event) => setTitleLimit(Number(event.target.value))}
                  type="number"
                  value={titleLimit}
                />
              </label>
            ) : null}

            {moduleId === "price-suggestion" ? (
              <div className="mt-4 grid gap-3">
                {[
                  ["Margem desejada (%)", marginPercent, setMarginPercent],
                  ["Taxa marketplace (%)", marketplaceFeePercent, setMarketplaceFeePercent],
                  ["Imposto (%)", taxPercent, setTaxPercent],
                  ["Frete estimado", estimatedFreight, setEstimatedFreight]
                ].map(([label, value, setter]) => (
                  <label key={label as string} className="grid gap-2 text-sm font-semibold text-matrix-fg">
                    {label as string}
                    <input
                      className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 outline-none"
                      min={0}
                      onChange={(event) => (setter as (value: number) => void)(Number(event.target.value))}
                      type="number"
                      value={value as number}
                    />
                  </label>
                ))}
              </div>
            ) : null}

            <label className="mt-4 grid gap-2 text-sm font-semibold text-matrix-fg">
              Observações para análise
              <textarea
                className="min-h-24 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm outline-none"
                onChange={(event) => setManualNotes(event.target.value)}
                placeholder="Opcional"
                value={manualNotes}
              />
            </label>
          </section>

          <div className="space-y-4">
            <section className="grid gap-3 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4 md:grid-cols-4">
              {product ? (
                <>
                  <Info label="Produto" value={product.name} />
                  <Info label="SKU" value={product.sku} />
                  <Info label="EAN/GTIN" value={valueOrDash(product.ean)} />
                  <Info label="Categoria" value={valueOrDash(product.category)} />
                  <Info label="Unidade" value={valueOrDash(product.unit)} />
                  <Info label="Valor" value={valueOrDash(product.displayValue)} />
                  <Info label="Preço venda" value={valueOrDash(product.salePriceDisplay)} />
                  <Info label="Estoque" value={String(product.stock)} />
                </>
              ) : (
                <div className="md:col-span-4">
                  <p className="text-sm text-matrix-muted">Selecione um produto para iniciar.</p>
                </div>
              )}
            </section>

            {!status?.configured ? (
              <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm font-semibold text-orange-200">
                IA não configurada. Configure OPENAI_API_KEY no ambiente para usar geração real.
              </p>
            ) : null}

            <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-matrix-fg">Execução</h4>
                  <p className="text-sm text-matrix-muted">
                    Busca por {product?.ean ? "EAN/GTIN" : "nome"} - {result?.status ?? "Aguardando"}
                  </p>
                </div>
                <Button disabled={running || !product} onClick={runModule}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
                  {moduleId === "price-suggestion" ? "Calcular sugestão" : "Executar análise"}
                </Button>
              </div>
              {message ? <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm text-matrix-muted">{message}</p> : null}
            </section>

            {titleOptions.length ? (
              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <h4 className="font-semibold text-matrix-fg">Opções de título</h4>
                <div className="mt-3 grid gap-2">
                  {titleOptions.map((option, index) => {
                    const optionRecord = option as Record<string, unknown>;
                    const title = typeof optionRecord.title === "string" ? optionRecord.title : "";
                    return (
                      <button
                        key={`${title}-${index}`}
                        className={`rounded-md border px-3 py-2 text-left text-sm ${
                          selectedTitle === title ? "border-matrix-gold/60 bg-matrix-goldSoft/35" : "border-matrix-border bg-matrix-panel/80"
                        }`}
                        onClick={() => setSelectedTitle(title)}
                        type="button"
                      >
                        <span className="font-semibold text-matrix-fg">{title}</span>
                        <span className="ml-2 text-xs text-matrix-muted">{title.length}/{titleLimit}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="font-semibold text-matrix-fg">Resultado editável</h4>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!resultText.trim()} onClick={copyResult} variant="secondary">
                    <Clipboard className="h-4 w-4" /> Copiar
                  </Button>
                  <Button disabled={!resultText.trim() || saving || !product} onClick={saveSuggestion}>
                    <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar sugestão"}
                  </Button>
                </div>
              </div>
              <textarea
                className="matrix-scroll mt-3 min-h-[420px] w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 font-mono text-xs leading-5 text-matrix-fg outline-none"
                onChange={(event) => setResultText(event.target.value)}
                placeholder="Execute o módulo para gerar um resultado editável."
                value={resultText}
              />
              <p className="mt-3 text-xs text-matrix-muted">Para aplicar uma sugestão ao produto, use o endpoint seguro de aplicação com confirmação explícita. Esta tela salva rascunhos para revisão.</p>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-matrix-border bg-matrix-panel/70 p-3">
      <p className="text-xs text-matrix-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-matrix-fg">{value}</p>
    </div>
  );
}
