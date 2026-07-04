"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Download, FileUp, ImageIcon, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProductCopyButton } from "@/components/product-copy-button";
import { Badge, Button, Card, DataTable, KpiCard, PageHeader } from "@/components/ui";

type ProductListItem = {
  id: string;
  name: string;
  sku: string | null;
  ean: string | null;
  description: string | null;
  category: string | null;
  origin: string | null;
  unit: string | null;
  status: string;
  displayValue: string | null;
  salePriceDisplay: string | null;
  costPriceDisplay?: string | null;
  imageUrl: string | null;
  hasEnrichmentDraft: boolean;
  externalProductId?: string | null;
  blingStatus?: string | null;
  blingAccount: {
    blingAccountId: string;
    blingAccountName: string | null;
    displayName: string | null;
    blingAccountShortId: string;
    isActiveDefault: boolean;
    externalProductId: string;
    status: string;
  } | null;
  price: string;
  stock: number;
  updatedAt: string;
};

type ProductEnrichmentDraft = {
  id: string;
  productId: string;
  originalName: string;
  generatedTitle: string;
  generatedDescription: string;
  technicalSpecs: Record<string, string>;
  dimensions: Record<string, string>;
  compatibility: string[];
  advantages: string[];
  packageContent: string[];
  installationTutorial: string;
  careInstructions: string;
  sources: Array<{
    provider: string;
    status: string;
    query: string | null;
    url: string | null;
    summary: string;
    title?: string | null;
    price?: number | null;
    image?: string | null;
    category?: string | null;
    brand?: string | null;
    searchMode?: string;
    configured?: boolean;
    alternatives?: Array<{ title: string | null; price: number | null; url: string | null }>;
  }>;
  status: string;
  updatedAt: string;
};

type EnrichmentResponse = {
  data: ProductEnrichmentDraft;
  search?: { mode: string; status: string; rawResult: string };
  baseData?: Record<string, string | number>;
};

const statusLabel: Record<string, string> = {
  READY_FOR_TEST: "Pronto para teste",
  DRAFT: "Rascunho"
};

type ImageFilter = "all" | "yes" | "no";
type StockFilter = "all" | "positive" | "negative" | "zero";
type ProductFilterMenu = "images" | "stock" | null;

const pageSizeOptions = [20, 50, 100];

const imageFilterLabels: Record<ImageFilter, string> = {
  all: "Todos",
  yes: "Sim",
  no: "Nao"
};

const stockFilterLabels: Record<StockFilter, string> = {
  all: "Todos",
  positive: "Maior que zero",
  negative: "Menor que zero",
  zero: "Igual a zero"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function normalizeGtinInput(value: string) {
  return value.replace(/\D/g, "");
}

function isValidGtin(value: string) {
  if (!value) return true;
  if (![8, 12, 13, 14].includes(value.length)) return false;

  const digits = value.split("").map(Number);
  if (digits.some((digit) => Number.isNaN(digit))) return false;

  const checkDigit = digits.at(-1);
  const sum = digits
    .slice(0, -1)
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return checkDigit === (10 - (sum % 10)) % 10;
}

function formatCurrencyDisplay(value: string | null | undefined) {
  const rawValue = value?.trim();
  if (!rawValue) return null;
  if (/^R\$/i.test(rawValue)) return rawValue;

  const currencyValue = rawValue.replace(/[^\d,.-]/g, "");
  const normalizedValue = currencyValue.includes(",")
    ? currencyValue.replace(/\./g, "").replace(",", ".")
    : currencyValue;
  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue)) return rawValue;

  return parsedValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function getBlingDisplayName(product: ProductListItem) {
  return product.blingAccount?.displayName ?? product.blingAccount?.blingAccountName ?? null;
}

function ProductCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      aria-label={label}
      checked={checked}
      className="h-4 w-4 rounded border-matrix-border bg-matrix-panel2 text-matrix-gold accent-matrix-gold"
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
  );
}

export function ProductsPage() {
  const [open, setOpen] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<ProductListItem | null>(null);
  const [enrichmentProducts, setEnrichmentProducts] = useState<ProductListItem[] | null>(null);
  const [activeEnrichmentProductId, setActiveEnrichmentProductId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [imageFilter, setImageFilter] = useState<ImageFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [openFilterMenu, setOpenFilterMenu] = useState<ProductFilterMenu>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const filterBarRef = useRef<HTMLDivElement>(null);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const response = await fetch("/api/products?limit=all");
      if (!response.ok) {
        setProducts([]);
        return;
      }

      const payload = (await response.json()) as { data?: ProductListItem[] };
      setProducts(payload.data ?? []);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    function reloadForAccountContext() {
      void loadProducts();
    }

    window.addEventListener("w-account-context-updated", reloadForAccountContext);
    window.addEventListener("w-erps-active-account-updated", reloadForAccountContext);
    return () => {
      window.removeEventListener("w-account-context-updated", reloadForAccountContext);
      window.removeEventListener("w-erps-active-account-updated", reloadForAccountContext);
    };
  }, [loadProducts]);

  useEffect(() => {
    const productIds = new Set(products.map((product) => product.id));
    setSelectedProductIds((current) => new Set([...current].filter((id) => productIds.has(id))));
  }, [products]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!filterBarRef.current?.contains(event.target as Node)) {
        setOpenFilterMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenFilterMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [imageFilter, pageSize, searchQuery, stockFilter]);

  const importedFromBlingCount = useMemo(() => products.filter((product) => product.blingAccount).length, [products]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return products.filter((product) => {
      const hasImage = Boolean(product.imageUrl?.trim());
      const matchesImage =
        imageFilter === "all" ||
        (imageFilter === "yes" && hasImage) ||
        (imageFilter === "no" && !hasImage);
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "positive" && product.stock > 0) ||
        (stockFilter === "negative" && product.stock < 0) ||
        (stockFilter === "zero" && product.stock === 0);
      const matchesSearch =
        !normalizedSearch ||
        [product.name, product.sku, product.ean]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      return matchesSearch && matchesImage && matchesStock;
    });
  }, [imageFilter, products, searchQuery, stockFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredProducts.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredProducts, pageSize]);

  const visibleProductIds = useMemo(() => paginatedProducts.map((product) => product.id), [paginatedProducts]);
  const selectedProducts = useMemo(() => products.filter((product) => selectedProductIds.has(product.id)), [products, selectedProductIds]);
  const selectedVisibleCount = visibleProductIds.filter((id) => selectedProductIds.has(id)).length;
  const allVisibleSelected = visibleProductIds.length > 0 && selectedVisibleCount === visibleProductIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleProductIds.length;
  const visibleProductsLabel =
    filteredProducts.length === 1 ? "1 produto visivel" : `${filteredProducts.length} produtos visiveis`;
  const pageStart = filteredProducts.length ? (currentPage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(currentPage * pageSize, filteredProducts.length);

  function toggleProductSelection(productId: string, checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(productId);
      } else {
        next.delete(productId);
      }
      return next;
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      for (const productId of visibleProductIds) {
        if (checked) {
          next.add(productId);
        } else {
          next.delete(productId);
        }
      }
      return next;
    });
  }

  function openEnrichment(productsToRegister: ProductListItem[]) {
    setEnrichmentProducts(productsToRegister);
    setActiveEnrichmentProductId(productsToRegister[0]?.id ?? null);
  }

  function handleProductUpdated(product: ProductListItem) {
    setProducts((current) => current.map((item) => (item.id === product.id ? product : item)));
    setViewingProduct(product);
  }

  return (
    <AppShell>
      <PageHeader
        title="Produtos"
        description="Catalogo central com SKU, EAN, fiscal, imagens, vinculos Bling e status de publicacao."
        actions={
          <>
            <Link
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-matrix-gold px-3 py-2 text-sm font-semibold text-black shadow-gold transition hover:bg-matrix-goldDark hover:text-white"
              href="/products/cadastro-inteligente"
            >
              <Sparkles className="h-4 w-4" /> Cadastro Inteligente
            </Link>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo produto</Button>
            <Button variant="secondary"><FileUp className="h-4 w-4" /> Importar do Bling</Button>
            <Button variant="secondary"><Download className="h-4 w-4" /> Exportar</Button>
            <Button variant="secondary"><RefreshCw className="h-4 w-4" /> Sincronizar</Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <KpiCard label="Produtos cadastrados" value={String(products.length)} hint={products.length ? "Catalogo local carregado" : "Catalogo vazio"} />
        <KpiCard label="Em revisao" value="0" hint="Nenhuma pendencia" tone="warning" />
        <KpiCard label="Prontos para enviar" value={String(products.filter((product) => product.status === "READY_FOR_TEST").length)} hint="Produtos prontos para teste" tone="success" />
        <KpiCard
          label="Importados do Bling"
          value={String(importedFromBlingCount)}
          hint={importedFromBlingCount ? "Produtos vinculados a conta Bling" : "Nenhum vinculo Bling"}
          tone="purple"
        />
      </div>
      <Card className="mt-4">
        <div ref={filterBarRef} className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-matrix-muted" />
            <input
              aria-label="Buscar por titulo, SKU ou GTIN"
              className="h-10 w-full rounded-md border border-matrix-border bg-white/[0.03] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-600 focus:border-matrix-gold/55"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar por titulo, SKU ou GTIN"
              value={searchQuery}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Button
                aria-expanded={openFilterMenu === "images"}
                className="min-w-28 justify-between"
                onClick={() => setOpenFilterMenu((current) => (current === "images" ? null : "images"))}
                type="button"
                variant="secondary"
              >
                Imagens{imageFilter !== "all" ? `: ${imageFilterLabels[imageFilter]}` : ""}
                <ChevronDown className="h-4 w-4" />
              </Button>
              {openFilterMenu === "images" ? (
                <div className="absolute right-0 top-[calc(100%+0.35rem)] z-30 w-44 rounded-md border border-matrix-border bg-matrix-panel p-1 shadow-glow">
                  {(["all", "yes", "no"] as ImageFilter[]).map((option) => (
                    <button
                      key={option}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition hover:bg-matrix-goldSoft/30 ${
                        imageFilter === option ? "text-matrix-goldDark" : "text-matrix-fg"
                      }`}
                      onClick={() => {
                        setImageFilter(option);
                        setOpenFilterMenu(null);
                      }}
                      type="button"
                    >
                      {imageFilterLabels[option]}
                      {imageFilter === option ? <span className="text-xs">Ativo</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="relative">
              <Button
                aria-expanded={openFilterMenu === "stock"}
                className="min-w-36 justify-between"
                onClick={() => setOpenFilterMenu((current) => (current === "stock" ? null : "stock"))}
                type="button"
                variant="secondary"
              >
                Estoque{stockFilter !== "all" ? `: ${stockFilterLabels[stockFilter]}` : ""}
                <ChevronDown className="h-4 w-4" />
              </Button>
              {openFilterMenu === "stock" ? (
                <div className="absolute right-0 top-[calc(100%+0.35rem)] z-30 w-56 rounded-md border border-matrix-border bg-matrix-panel p-1 shadow-glow">
                  {(["all", "positive", "negative", "zero"] as StockFilter[]).map((option) => (
                    <button
                      key={option}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition hover:bg-matrix-goldSoft/30 ${
                        stockFilter === option ? "text-matrix-goldDark" : "text-matrix-fg"
                      }`}
                      onClick={() => {
                        setStockFilter(option);
                        setOpenFilterMenu(null);
                      }}
                      type="button"
                    >
                      {stockFilterLabels[option]}
                      {stockFilter === option ? <span className="text-xs">Ativo</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <span className="inline-flex h-10 items-center rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 text-sm font-semibold text-matrix-fg">
              Pagina {currentPage} de {totalPages}
            </span>
            <select
              aria-label="Produtos por pagina"
              className="h-10 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 text-sm font-semibold text-matrix-fg outline-none"
              onChange={(event) => setPageSize(Number(event.target.value))}
              value={pageSize}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} produtos por pagina
                </option>
              ))}
            </select>
            <Button disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} type="button" variant="secondary">
              Anterior
            </Button>
            <Button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} type="button" variant="secondary">
              Proxima
            </Button>
            <span className="text-xs text-matrix-muted">{visibleProductsLabel}</span>
          </div>
        </div>
        {selectedProducts.length ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-matrix-gold/25 bg-matrix-goldSoft/28 px-3 py-2">
            <p className="text-sm font-semibold text-matrix-goldDark">
              {selectedProducts.length === 1
                ? "1 produto selecionado para cadastro"
                : `${selectedProducts.length} produtos selecionados para cadastro`}
            </p>
            <Button onClick={() => openEnrichment(selectedProducts)}>Cadastrar selecionados</Button>
          </div>
        ) : null}
        <DataTable
          columns={[
            <ProductCheckbox
              key="select-all"
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              label="Selecionar todos os produtos visiveis"
              onChange={toggleVisibleSelection}
            />,
            "Produto",
            "SKU",
            "EAN",
            "Unidade",
            "Categoria",
            "Custo",
            "Preco venda",
            "Margem",
            "Estoque",
            "Acoes"
          ]}
          rows={paginatedProducts.map((product) => [
            <ProductCheckbox
              key={`${product.id}-select`}
              checked={selectedProductIds.has(product.id)}
              label={`Selecionar ${product.name}`}
              onChange={(checked) => toggleProductSelection(product.id, checked)}
            />,
            <div key={`${product.id}-name`} className="flex min-w-[280px] items-center gap-2">
              <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md border border-matrix-border bg-matrix-panel2/80">
                {product.imageUrl ? (
                  <Image
                    alt={product.name}
                    className="h-full w-full object-cover"
                    height={44}
                    src={product.imageUrl}
                    unoptimized
                    width={44}
                  />
                ) : (
                  <ImageIcon className="h-4 w-4 text-matrix-muted" />
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 truncate">{product.name}</span>
                <ProductCopyButton label="Copiar titulo" text={product.name} />
              </div>
            </div>,
            <div key={`${product.id}-sku`} className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate">{product.sku || "-"}</span>
              <ProductCopyButton label="Copiar SKU" text={product.sku} />
            </div>,
            <div key={`${product.id}-ean`} className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate">{product.ean ?? "-"}</span>
              <ProductCopyButton label="Copiar EAN" text={product.ean} />
            </div>,
            product.unit ?? "-",
            product.category ?? "-",
            formatCurrencyDisplay(product.costPriceDisplay ?? product.displayValue) ?? "-",
            formatCurrencyDisplay(product.salePriceDisplay) ?? "0,00",
            <span key={`${product.id}-margin`} className="text-xs text-matrix-muted">Aguardando marketplace</span>,
            product.stock,
            <Button key={`${product.id}-actions`} variant="ghost" onClick={() => setViewingProduct(product)}>Ver</Button>
          ])}
          emptyMessage={loadingProducts ? "Carregando produtos..." : "Nenhum produto cadastrado ainda."}
          footer={
            <div className="flex flex-col gap-1 border-t border-matrix-border px-3 py-2 text-xs text-matrix-muted sm:flex-row sm:items-center sm:justify-between">
              <span>
                Pagina {currentPage} de {totalPages}
              </span>
              <span>
                {pageStart}-{pageEnd} de {filteredProducts.length} produtos filtrados
              </span>
            </div>
          }
        />
      </Card>
      {viewingProduct ? (
        <ProductDetailsModal
          product={viewingProduct}
          onClose={() => setViewingProduct(null)}
          onProductUpdated={handleProductUpdated}
          onRegister={() => {
            openEnrichment([viewingProduct]);
            setViewingProduct(null);
          }}
        />
      ) : null}
      {enrichmentProducts ? (
        <SmartRegistrationModal
          activeProductId={activeEnrichmentProductId}
          onActiveProductChange={setActiveEnrichmentProductId}
          onClose={() => setEnrichmentProducts(null)}
          onSaved={() => void loadProducts()}
          products={enrichmentProducts}
        />
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/50">
          <aside className="matrix-scroll ml-auto h-full w-full max-w-xl overflow-y-auto border-l border-matrix-border bg-matrix-panel p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">Novo produto</h3>
              <button onClick={() => setOpen(false)} className="rounded-md border border-matrix-border px-3 py-2 text-sm text-slate-300">Fechar</button>
            </div>
            <div className="mt-6 grid gap-4">
              {["Nome", "SKU", "EAN", "Descricao", "Marca", "Categoria", "NCM", "CEST", "Preco de custo", "Markup", "Preco de venda", "Estoque minimo", "Imagens", "Campos bloqueados"].map((field) => (
                <label key={field} className="grid gap-2 text-sm text-slate-300">
                  {field}
                  <input className="rounded-md border border-matrix-border bg-white/[0.03] px-3 py-2 outline-none" />
                </label>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button>Salvar</Button>
              <Button variant="secondary">Enviar para Bling</Button>
              <Button variant="secondary">Atualizar em todos</Button>
            </div>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

type ProductEditForm = {
  name: string;
  sku: string;
  ean: string;
  unit: string;
  category: string;
  origin: string;
  status: string;
  displayValue: string;
  salePriceDisplay: string;
  stock: string;
  imageUrl: string;
  description: string;
};

function productToForm(product: ProductListItem): ProductEditForm {
  return {
    name: product.name,
    sku: product.sku ?? "",
    ean: product.ean ?? "",
    unit: product.unit ?? "",
    category: product.category ?? "",
    origin: product.origin ?? "",
    status: product.status,
    displayValue: product.displayValue ?? "0,00",
    salePriceDisplay: product.salePriceDisplay ?? "0,00",
    stock: String(product.stock),
    imageUrl: product.imageUrl ?? "",
    description: product.description ?? ""
  };
}

function ProductDetailsModal({
  product,
  onClose,
  onProductUpdated,
  onRegister
}: {
  product: ProductListItem;
  onClose: () => void;
  onProductUpdated: (product: ProductListItem) => void;
  onRegister: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProductEditForm>(() => productToForm(product));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(productToForm(product)), [form, product]);

  useEffect(() => {
    setForm(productToForm(product));
    setEditing(false);
    setMessage("");
    setError("");
  }, [product]);

  function requestClose() {
    if (editing && dirty && !window.confirm("Descartar alteracoes nao salvas?")) return;
    onClose();
  }

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

  function updateField(field: keyof ProductEditForm, value: string) {
    setMessage("");
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  function cancelEdit() {
    setForm(productToForm(product));
    setEditing(false);
    setMessage("");
    setError("");
  }

  function validateForm() {
    if (!form.name.trim() || !form.sku.trim()) return "Nome e SKU sao obrigatorios.";
    if (form.ean && !isValidGtin(form.ean)) return "GTIN/EAN invalido. Informe 8, 12, 13 ou 14 digitos validos.";

    const stock = Number(form.stock.replace(",", "."));
    if (!Number.isInteger(stock) || stock < 0) return "Estoque deve ser um numero inteiro maior ou igual a zero.";
    if (form.displayValue.trim().startsWith("-") || form.salePriceDisplay.trim().startsWith("-")) {
      return "Valor e preco de venda nao podem ser negativos.";
    }

    return "";
  }

  async function saveChanges() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          ean: form.ean || null,
          unit: form.unit || null,
          category: form.category || null,
          origin: form.origin || null,
          status: form.status,
          displayValue: form.displayValue,
          salePriceDisplay: form.salePriceDisplay,
          stock: Number(form.stock),
          imageUrl: form.imageUrl || null,
          description: form.description || null
        })
      });
      const payload = (await response.json()) as { data?: ProductListItem; error?: string };

      if (!response.ok || !payload.data) {
        setError(payload.error ?? "Nao foi possivel salvar o produto.");
        return;
      }

      onProductUpdated(payload.data);
      setForm(productToForm(payload.data));
      setEditing(false);
      setMessage("Alteracoes salvas com sucesso.");
    } finally {
      setSaving(false);
    }
  }

  const details = [
    ["Nome do produto", product.name],
    ["SKU", product.sku ?? "Sem SKU"],
    ["EAN", product.ean ?? "-"],
    ["Unidade", product.unit ?? "-"],
    ["Categoria", product.category ?? "-"],
    ["Origem", product.origin ?? "-"],
    ["Status", statusLabel[product.status] ?? product.status],
    ["Valor", product.displayValue ?? "-"],
    ["Preco de venda", product.salePriceDisplay ?? "0,00"],
    ["Estoque", String(product.stock)],
    ["Status Bling", getBlingDisplayName(product) ?? "Sem Bling"],
    ["Data de atualizacao", formatDate(product.updatedAt)],
    ["Observacoes", product.description ?? "-"]
  ];

  const isLocalTestProduct = product.sku?.startsWith("TEST-") || product.origin === "Teste local";
  const inputClass = "rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60";
  const fieldClass = "rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3";
  const aiModules = [
    ["Gerar título com IA", "title-generation"],
    ["Gerar descrição com IA", "description-generation"],
    ["Classificar com IA", "classification"],
    ["Sugerir preço", "price-suggestion"],
    ["Diagnosticar anúncio", "ad-diagnosis"]
  ];

  function openAIModule(moduleId: string) {
    window.location.assign(`/ia?module=${moduleId}&productId=${product.id}`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-6 backdrop-blur-sm" onClick={requestClose}>
      <section
        aria-modal="true"
        className="matrix-scroll max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-matrix-gold/30 bg-matrix-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Produto</p>
            <h3 className="mt-1 text-2xl font-bold tracking-normal text-matrix-fg">Detalhes do produto</h3>
            <p className="mt-1 text-sm text-matrix-muted">
              {editing ? "Edite o cadastro base antes de gerar o Cadastro Inteligente." : "Visualizacao do cadastro atual do produto."}
            </p>
          </div>
          <button
            aria-label="Fechar detalhes do produto"
            className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:border-matrix-gold/45 hover:text-matrix-goldDark"
            onClick={requestClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="grid min-h-48 place-items-center rounded-lg border border-matrix-border bg-matrix-panel2/70 text-matrix-muted">
            {product.imageUrl ? (
              <Image
                alt={product.name}
                className="h-full max-h-60 w-full rounded-lg object-cover"
                height={240}
                src={product.imageUrl}
                unoptimized
                width={320}
              />
            ) : (
              <div className="text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-matrix-goldSoft/60 text-matrix-goldDark">
                  <ImageIcon className="h-7 w-7" />
                </div>
                <p className="mt-3 text-sm font-semibold text-matrix-fg">Sem imagem</p>
                <p className="mt-1 text-xs text-matrix-muted">Placeholder atual</p>
              </div>
            )}
          </div>

          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted sm:col-span-2`}>
                Nome do produto
                <input className={inputClass} value={form.name} onChange={(event) => updateField("name", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                SKU
                <input className={inputClass} value={form.sku} onChange={(event) => updateField("sku", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                EAN/GTIN
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="8, 12, 13 ou 14 digitos"
                  value={form.ean}
                  onChange={(event) => updateField("ean", normalizeGtinInput(event.target.value))}
                />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                Unidade
                <input className={inputClass} value={form.unit} onChange={(event) => updateField("unit", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                Categoria
                <input className={inputClass} value={form.category} onChange={(event) => updateField("category", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                Origem
                <input className={inputClass} value={form.origin} onChange={(event) => updateField("origin", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                Status
                <select className={inputClass} value={form.status} onChange={(event) => updateField("status", event.target.value)}>
                  <option value="READY_FOR_TEST">Pronto para teste</option>
                  <option value="DRAFT">Rascunho</option>
                </select>
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                Valor
                <input className={inputClass} inputMode="decimal" value={form.displayValue} onChange={(event) => updateField("displayValue", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                Preco de venda
                <input className={inputClass} inputMode="decimal" value={form.salePriceDisplay} onChange={(event) => updateField("salePriceDisplay", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                Estoque
                <input className={inputClass} inputMode="numeric" value={form.stock} onChange={(event) => updateField("stock", normalizeGtinInput(event.target.value))} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted`}>
                URL da imagem
                <input className={inputClass} value={form.imageUrl} onChange={(event) => updateField("imageUrl", event.target.value)} />
              </label>
              <label className={`${fieldClass} grid gap-2 text-xs font-medium text-matrix-muted sm:col-span-2`}>
                Observacoes
                <textarea className={`${inputClass} min-h-24`} value={form.description} onChange={(event) => updateField("description", event.target.value)} />
              </label>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {details.map(([label, value]) => (
                <div key={label} className={fieldClass}>
                  <p className="text-xs font-medium text-matrix-muted">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-matrix-fg">{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {isLocalTestProduct ? (
          <div className="mt-4 rounded-lg border border-matrix-gold/25 bg-matrix-goldSoft/35 px-3 py-2 text-sm font-semibold text-matrix-goldDark">
            Produto de teste/local
          </div>
        ) : null}

        {!editing ? (
          <div className="mt-4 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-matrix-fg">
              <Sparkles className="h-4 w-4 text-matrix-goldDark" />
              Ações rápidas de IA
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {aiModules.map(([label, moduleId]) => (
                <Button key={moduleId} onClick={() => openAIModule(moduleId)} variant="secondary">
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        {message ? <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {editing ? (
            <>
              <Button variant="secondary" onClick={cancelEdit} disabled={saving}>Cancelar</Button>
              <Button onClick={saveChanges} disabled={saving}>{saving ? "Salvando..." : "Salvar alteracoes"}</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setEditing(true)}>Editar produto</Button>
          )}
          <Button onClick={onRegister} disabled={saving}>Cadastrar produto</Button>
        </div>
      </section>
    </div>
  );
}

function formatGeneratedContent(draft: ProductEnrichmentDraft) {
  const specs = Object.entries(draft.technicalSpecs).map(([key, value]) => `* ${key}: ${value}`).join("\n");
  const dimensions = Object.entries(draft.dimensions).map(([key, value]) => `* ${key}: ${value}`).join("\n");

  return `Titulo do Produto:
${draft.generatedTitle}

Descricao do Produto:
${draft.generatedDescription}

Ficha Tecnica:
${specs}

Dimensoes do Produto:
${dimensions}

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

function SmartRegistrationModal({
  activeProductId,
  onActiveProductChange,
  onClose,
  onSaved,
  products
}: {
  activeProductId: string | null;
  onActiveProductChange: (productId: string) => void;
  onClose: () => void;
  onSaved: () => void;
  products: ProductListItem[];
}) {
  const activeProduct = products.find((product) => product.id === activeProductId) ?? products[0];
  const [draft, setDraft] = useState<ProductEnrichmentDraft | null>(null);
  const [search, setSearch] = useState<EnrichmentResponse["search"] | null>(null);
  const [baseData, setBaseData] = useState<EnrichmentResponse["baseData"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function generateDraft(product: ProductListItem) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/products/${product.id}/enrichment`, { method: "POST" });
      const payload = (await response.json()) as EnrichmentResponse;

      if (!response.ok) {
        setMessage("Nao foi possivel gerar o rascunho.");
        return;
      }

      setDraft(payload.data);
      setSearch(payload.search ?? null);
      setBaseData(payload.baseData ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    if (!draft || !activeProduct || draft.generatedTitle.length > 60) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/products/${activeProduct.id}/enrichment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const payload = (await response.json()) as EnrichmentResponse;

      if (!response.ok) {
        setMessage("Nao foi possivel salvar. Confira o limite do titulo.");
        return;
      }

      setDraft(payload.data);
      setMessage("Rascunho salvo com sucesso.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function processAll() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/products/enrichment/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: products.map((product) => product.id) })
      });

      if (!response.ok) {
        setMessage("Nao foi possivel processar o lote.");
        return;
      }

      setMessage(`${products.length} rascunhos gerados para revisao.`);
      onSaved();
      if (activeProduct) await generateDraft(activeProduct);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeProduct) void generateDraft(activeProduct);
    // generateDraft is intentionally recreated with local UI state setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProduct?.id]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  if (!activeProduct) return null;

  const titleLength = draft?.generatedTitle.length ?? 0;
  const titleTooLong = titleLength > 60;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <aside
        aria-modal="true"
        className="matrix-scroll ml-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto rounded-xl border border-matrix-gold/30 bg-matrix-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Marketplace</p>
            <h3 className="mt-1 text-2xl font-bold text-matrix-fg">Cadastro inteligente do produto</h3>
            <p className="mt-1 text-sm text-matrix-muted">Rascunho local para revisao. Nada sera publicado automaticamente.</p>
          </div>
          <button
            aria-label="Fechar cadastro inteligente"
            className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:border-matrix-gold/45 hover:text-matrix-goldDark"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[300px_1fr]">
          <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-semibold text-matrix-fg">Produtos selecionados</h4>
              {products.length > 1 ? <Button onClick={processAll} variant="secondary">Processar todos</Button> : null}
            </div>
            <div className="mt-3 space-y-2">
              {products.map((product) => (
                <button
                  key={product.id}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                    product.id === activeProduct.id ? "border-matrix-gold/60 bg-matrix-goldSoft/35 text-matrix-goldDark" : "border-matrix-border text-matrix-fg hover:border-matrix-gold/35"
                  }`}
                  onClick={() => onActiveProductChange(product.id)}
                  type="button"
                >
                  <span className="block font-semibold">{product.name}</span>
                  <span className="text-xs text-matrix-muted">{product.sku ?? "Sem SKU"}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="space-y-4">
            <section className="grid gap-3 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3 md:grid-cols-4">
              {["Produto base", "Pesquisa e correcao", "Conteudo gerado", "Revisao final"].map((step, index) => (
                <div key={step} className="rounded-md border border-matrix-border bg-matrix-panel/70 p-3">
                  <p className="text-xs font-semibold text-matrix-goldDark">Etapa {index + 1}</p>
                  <p className="mt-1 text-sm font-semibold text-matrix-fg">{step}</p>
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  ["Nome atual", activeProduct.name],
                  ["SKU", activeProduct.sku ?? "Sem SKU"],
                  ["EAN/GTIN", activeProduct.ean ?? "Nao informado"],
                  ["Unidade", activeProduct.unit ?? "Nao informado"],
                  ["Categoria", activeProduct.category ?? "Nao informado"],
                  ["Origem", activeProduct.origin ?? "Nao informado"],
                  ["Valor", activeProduct.displayValue ?? "Nao informado"],
                  ["Preco venda", activeProduct.salePriceDisplay ?? "0,00"],
                  ["Estoque", String(activeProduct.stock)],
                  ["Status Bling", getBlingDisplayName(activeProduct) ?? "Sem Bling"]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-matrix-border bg-matrix-panel/70 p-3">
                    <p className="text-xs text-matrix-muted">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-matrix-fg">{value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-matrix-fg">Pesquisa</h4>
                  <p className="text-sm text-matrix-muted">
                    Busca por {search?.mode ?? (activeProduct.ean ? "EAN/GTIN" : "nome do produto")} - {search?.status ?? "Aguardando"}
                  </p>
                </div>
                <Button onClick={() => generateDraft(activeProduct)} variant="secondary" disabled={loading}>
                  {loading ? "Pesquisando..." : "Recriar titulo"}
                </Button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {(draft?.sources ?? []).map((source) => (
                  <div key={source.provider} className="rounded-md border border-matrix-border bg-matrix-panel/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-matrix-fg">{source.provider}</p>
                      {typeof source.configured === "boolean" ? (
                        <Badge tone={source.configured ? "success" : "muted"}>{source.configured ? "Configurado" : "Nao configurado"}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-matrix-muted">
                      {source.status}
                      {source.searchMode ? ` por ${source.searchMode}` : ""}
                    </p>
                    {source.title ? <p className="mt-2 text-sm font-semibold text-matrix-fg">{source.title}</p> : null}
                    {source.price !== null && source.price !== undefined ? (
                      <p className="mt-1 text-xs text-matrix-muted">Preco ref.: {source.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                    ) : null}
                    {source.category || source.brand ? (
                      <p className="mt-1 text-xs text-matrix-muted">
                        {[source.brand, source.category].filter(Boolean).join(" - ")}
                      </p>
                    ) : null}
                    {source.url ? (
                      <a className="mt-2 block break-all text-xs font-semibold text-matrix-goldDark hover:underline" href={source.url} rel="noreferrer" target="_blank">
                        Fonte Mercado Livre
                      </a>
                    ) : null}
                    <p className="mt-2 text-xs text-matrix-muted">{source.summary}</p>
                    {source.alternatives?.length ? (
                      <p className="mt-2 text-xs text-matrix-muted">{source.alternatives.length} alternativa(s) encontrada(s) para revisao.</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel/70 p-3 text-sm text-matrix-muted">
                {search?.rawResult ?? "Aguardando geracao do rascunho."}
              </p>
              {baseData ? (
                <div className="mt-3 grid gap-2 text-xs text-matrix-muted md:grid-cols-4">
                  <span>Base: {baseData.name}</span>
                  <span>SKU: {baseData.sku}</span>
                  <span>Estoque: {baseData.stock}</span>
                  <span>Bling: {baseData.blingStatus}</span>
                </div>
              ) : null}
            </section>

            <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
              <label className="grid gap-2 text-sm font-semibold text-matrix-fg">
                Titulo corrigido
                <input
                  className={`rounded-md border bg-matrix-panel px-3 py-2 outline-none ${titleTooLong ? "border-red-500 text-red-300" : "border-matrix-border"}`}
                  maxLength={80}
                  value={draft?.generatedTitle ?? ""}
                  onChange={(event) => draft && setDraft({ ...draft, generatedTitle: event.target.value })}
                />
              </label>
              <p className={`mt-2 text-xs ${titleTooLong ? "text-red-300" : "text-matrix-muted"}`}>{titleLength}/60 caracteres</p>
            </section>

            <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
              <h4 className="font-semibold text-matrix-fg">Conteudo gerado</h4>
              <textarea
                className="matrix-scroll mt-3 min-h-[360px] w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm leading-6 text-matrix-fg outline-none"
                value={draft ? formatGeneratedContent(draft) : "Gerando conteudo..."}
                readOnly
              />
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="grid gap-2 text-sm text-matrix-muted md:col-span-3">
                  Descricao editavel
                  <textarea
                    className="min-h-24 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none"
                    value={draft?.generatedDescription ?? ""}
                    onChange={(event) => draft && setDraft({ ...draft, generatedDescription: event.target.value })}
                  />
                </label>
                <label className="grid gap-2 text-sm text-matrix-muted">
                  Tutorial de instalacao
                  <textarea
                    className="min-h-28 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none"
                    value={draft?.installationTutorial ?? ""}
                    onChange={(event) => draft && setDraft({ ...draft, installationTutorial: event.target.value })}
                  />
                </label>
                <label className="grid gap-2 text-sm text-matrix-muted">
                  Cuidados e manutencao
                  <textarea
                    className="min-h-28 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none"
                    value={draft?.careInstructions ?? ""}
                    onChange={(event) => draft && setDraft({ ...draft, careInstructions: event.target.value })}
                  />
                </label>
                <div className="rounded-md border border-matrix-border bg-matrix-panel p-3 text-sm text-matrix-muted">
                  <p className="font-semibold text-matrix-fg">Dados nao encontrados</p>
                  <p className="mt-2">Medidas, peso, marca e fontes externas ficam como Nao informado quando nao houver API configurada.</p>
                </div>
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3">
              <p className="text-sm text-matrix-muted">{message || "Revise os campos antes de salvar como rascunho local."}</p>
              <Button disabled={!draft || titleTooLong || saving} onClick={saveDraft}>
                {saving ? "Salvando..." : "Salvar rascunho"}
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
