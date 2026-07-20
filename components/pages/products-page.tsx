"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangle,
  Barcode,
  Box,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Download,
  Edit3,
  FileText,
  FileUp,
  Factory,
  Folder,
  Globe2,
  ImageIcon,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
  X
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  BlingProductUpdateModal,
  type BlingProductReviewChanges,
  type BlingProductUpdatePreview,
  type BlingProductUpdateResult
} from "@/components/bling-product-update-modal";
import { ProductCopyButton } from "@/components/product-copy-button";
import { Badge, Button, Card, DataTable, KpiCard, PageHeader } from "@/components/ui";
import {
  EMPTY_PRODUCT_LIST_FILTERS,
  getProductPaginationItems,
  parseProductListFilters,
  type ProductListFilterOptions,
  type ProductListFilters
} from "@/lib/product-list-filters";

const MERCADO_LIVRE_LOGO_SRC = "/marketplaces/mercado-livre-oval.png";

type ProductListItem = {
  id: string;
  name: string;
  sku: string | null;
  ean: string | null;
  description: string | null;
  category: string | null;
  brand?: string | null;
  ncm?: string | null;
  origin: string | null;
  unit: string | null;
  status: string;
  source?: string | null;
  displayValue: string | null;
  salePriceDisplay: string | null;
  costPriceDisplay?: string | null;
  imageUrl: string | null;
  weight?: string | null;
  height?: string | null;
  width?: string | null;
  depth?: string | null;
  attributes?: unknown;
  hasEnrichmentDraft: boolean;
  externalProductId?: string | null;
  blingStatus?: string | null;
  marketplaceStores?: {
    mercadoLivre?: boolean;
  };
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

type ProductAccountContext = {
  mode: "MATRIX" | "ERP_ACCOUNT";
  provider: "BLING" | null;
  connectionId: string | null;
  selectedOption?: { status?: string } | null;
};

type BlingImportPreview = {
  totalReportedByBling: number | null;
  totalFound: number;
  pagesFound: number;
  simpleProducts: number;
  variations: number;
  active: number;
  inactive: number;
  withoutSku: number;
  existing: number;
  new: number;
  wouldUpdate: number;
  importable: number;
  errors: number;
  ignored: number;
  duplicateExternalIds: number;
  skuConflicts: number;
  completed: boolean;
  writesPerformed: false;
};

type BlingSyncJob = {
  id: string;
  status: string;
  totalFetched: number;
  totalCreatedDrafts: number;
  totalUpdatedDrafts: number;
  totalExistingProducts: number;
  totalErrors: number;
  currentPage: number;
  errorMessage: string | null;
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

const pageSizeOptions = [20, 50, 100];

const emptyFilterOptions: ProductListFilterOptions = {
  origins: [],
  categories: [],
  brands: [],
  categoriesTruncated: false,
  brandsTruncated: false
};

type ProductListSummary = {
  totalProducts: number;
  importedFromBlingCount: number;
  readyForTestCount: number;
  unknownBlingStatusCount: number;
};

type ProductListPagination = {
  page: number;
  limit: number | "all";
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

const emptySummary: ProductListSummary = {
  totalProducts: 0,
  importedFromBlingCount: 0,
  readyForTestCount: 0,
  unknownBlingStatusCount: 0
};

const emptyPagination: ProductListPagination = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false
};

function getBlingCatalogStatusLabel(status: string | null | undefined) {
  const normalized = status?.trim().toUpperCase();
  if (normalized === "ACTIVE") return "Ativo no Bling";
  if (normalized === "INACTIVE") return "Inativo no Bling";
  if (normalized === "DELETED") return "Excluido no Bling";
  return "Status do Bling nao confirmado";
}

function getBlingCatalogStatusMessage(status: string | null | undefined) {
  const normalized = status?.trim().toUpperCase();
  if (normalized === "INACTIVE") return "Este produto esta inativo no Bling.";
  if (normalized === "DELETED") return "Este produto foi excluido no Bling e permanece no sistema para preservar o historico.";
  if (normalized === "UNKNOWN") return "O status deste produto ainda nao foi atualizado.";
  return null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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

function ProductStoresCell({ product }: { product: ProductListItem }) {
  if (!product.marketplaceStores?.mercadoLivre) {
    return <span aria-hidden="true" className="block h-6 min-w-10" />;
  }

  return (
    <div className="flex min-w-10 items-center justify-center">
      <Image
        alt="Mercado Livre"
        className="h-auto w-6 object-contain"
        height={15}
        src={MERCADO_LIVRE_LOGO_SRC}
        title="Mercado Livre"
        width={24}
      />
    </div>
  );
}

function displayText(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "-";
  const text = String(value).trim();
  return text || "-";
}

function formatDecimalText(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "-";

  const rawValue = String(value).trim();
  if (!rawValue) return "-";

  const normalizedValue = rawValue.includes(",")
    ? rawValue.replace(/\./g, "").replace(",", ".")
    : rawValue;
  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue)) return rawValue;

  return parsedValue.toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
    minimumFractionDigits: parsedValue % 1 === 0 ? 0 : 2
  });
}

function formatMeasurement(value: string | number | null | undefined, unit: string) {
  const text = formatDecimalText(value);
  return text === "-" ? "-" : `${text} ${unit}`;
}

function cleanProductDescription(value: string | null | undefined) {
  if (!value?.trim()) return "";

  const decodeBasicEntities = (text: string) =>
    text
      .replace(/&nbsp;|&#160;|&ensp;|&emsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'");

  const isSectionTitle = (line: string) => {
    const title = line.endsWith(":") ? line.slice(0, -1).trim() : "";
    if (!title || title.length > 72) return false;
    if (title.split(/\s+/).length > 8) return false;
    if (!/[A-Za-z\u00C0-\u024F]/.test(title)) return false;
    if (
      /^(Marca|Modelo|C[o\u00f3]digo(?:\s+(?:de\s+Refer[e\u00ea]ncia|similar))?|Refer[e\u00ea]ncia|Tipo|Voltagem|Capacidade|CCA|Material|Acabamento|Sistema|Aplica[c\u00e7][a\u00e3]o|Fun[c\u00e7][a\u00e3]o|Instala[c\u00e7][a\u00e3]o|Altura|Largura|Comprimento|Profundidade|Peso)$/i.test(
        title
      )
    ) {
      return false;
    }
    return !/[.!?;]/.test(title);
  };

  const sectionHeadingPattern =
    /(Descricao do Produto|Descri\u00e7\u00e3o do Produto|Ficha Tecnica|Ficha T\u00e9cnica|Compatibilidade do Produto|Compatibilidade|Vantagens|Conteudo da Embalagem|Conte\u00fado da Embalagem|Dimensoes do Produto|Dimens\u00f5es do Produto|Dimensoes|Dimens\u00f5es|Tutorial de Instalacao|Tutorial de Instala\u00e7\u00e3o|Cuidados e Manutencao|Cuidados e Manuten\u00e7\u00e3o)\s*:/gi;
  const inlineFieldPattern =
    /(Marca|Modelo|C[o\u00f3]digo(?:\s+(?:de\s+Refer[e\u00ea]ncia|similar))?|Refer[e\u00ea]ncia|Tipo|Voltagem|Capacidade|CCA|Material|Acabamento|Sistema|Aplica[c\u00e7][a\u00e3]o|Fun[c\u00e7][a\u00e3]o|Instala[c\u00e7][a\u00e3]o|Altura|Largura|Comprimento|Profundidade|Peso)\s*:/gi;

  const sectionHeadings: string[] = [];
  const protectSectionHeading = (heading: string) => {
    const token = `__MATRIX_SECTION_HEADING_${sectionHeadings.length}__`;
    sectionHeadings.push(heading.trim().replace(/\s+:/g, ":"));
    return `\n${token}\n`;
  };

  let text = value.replace(/[\u200B-\u200D\uFEFF\u00A0\u202F\u2007]/g, " ");
  text = decodeBasicEntities(decodeBasicEntities(text));
  text = text
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\b[^>]*>/gi, "\n")
    .replace(/<\s*(p|div|section|article|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<\/\s*(p|div|section|article|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(sectionHeadingPattern, (match) => protectSectionHeading(match))
    .replace(inlineFieldPattern, "\n$1:");

  sectionHeadings.forEach((heading, index) => {
    text = text.split(`__MATRIX_SECTION_HEADING_${index}__`).join(heading);
  });

  const lines = text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line) => line && !/^[.\-\u2013\u2014_*\s]+$/.test(line));

  const normalizedLines: string[] = [];
  const pushBlankLine = () => {
    if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] !== "") {
      normalizedLines.push("");
    }
  };

  for (const line of lines) {
    if (isSectionTitle(line)) {
      pushBlankLine();
      normalizedLines.push(line);
      pushBlankLine();
    } else {
      normalizedLines.push(line);
    }
  }

  return normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeAttributeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function productAttributeValue(attributes: unknown, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeAttributeKey));

  if (Array.isArray(attributes)) {
    for (const attribute of attributes) {
      if (!attribute || typeof attribute !== "object") continue;
      const record = attribute as Record<string, unknown>;
      const identifier = [record.id, record.code, record.key, record.name, record.attributeId]
        .find((item): item is string => typeof item === "string");

      if (!identifier || !normalizedAliases.has(normalizeAttributeKey(identifier))) continue;

      const rawValue = [record.value_name, record.valueName, record.value, record.text]
        .find((item) => item !== null && item !== undefined && String(item).trim());

      return rawValue === undefined ? null : String(rawValue);
    }
  }

  if (attributes && typeof attributes === "object") {
    for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
      if (!normalizedAliases.has(normalizeAttributeKey(key))) continue;
      if (value === null || value === undefined || typeof value === "object") return null;
      return String(value);
    }
  }

  return null;
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

function ProductFilterSelect({
  label,
  value,
  onChange,
  children,
  hint
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1 text-sm text-matrix-fg">
      <span className="font-semibold">{label}</span>
      {hint ? <span className="text-xs text-matrix-muted">{hint}</span> : null}
      <select
        aria-label={label}
        className="h-9 w-full rounded-md border border-matrix-border bg-matrix-panel2 px-3 text-sm text-matrix-fg outline-none transition focus:border-matrix-gold/60 focus-visible:ring-2 focus-visible:ring-matrix-gold/40"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

export function ProductsPage() {
  const [open, setOpen] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<ProductListItem | null>(null);
  const [enrichmentProducts, setEnrichmentProducts] = useState<ProductListItem[] | null>(null);
  const [activeEnrichmentProductId, setActiveEnrichmentProductId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [accountContext, setAccountContext] = useState<ProductAccountContext | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [blingImportOpen, setBlingImportOpen] = useState(false);
  const [blingImportBusy, setBlingImportBusy] = useState(false);
  const [blingImportMessage, setBlingImportMessage] = useState("");
  const [blingImportPreview, setBlingImportPreview] = useState<BlingImportPreview | null>(null);
  const [blingSyncJob, setBlingSyncJob] = useState<BlingSyncJob | null>(null);
  const [blingUpdateOpen, setBlingUpdateOpen] = useState(false);
  const [blingUpdateBusy, setBlingUpdateBusy] = useState(false);
  const [blingUpdateMessage, setBlingUpdateMessage] = useState("");
  const [blingUpdatePreview, setBlingUpdatePreview] = useState<BlingProductUpdatePreview | null>(null);
  const [blingUpdateResult, setBlingUpdateResult] = useState<BlingProductUpdateResult | null>(null);
  const blingUpdateIdempotencyKey = useRef<string | null>(null);
  const blingUpdateRequestInFlight = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [pendingFilters, setPendingFilters] = useState<ProductListFilters>({ ...EMPTY_PRODUCT_LIST_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState<ProductListFilters>({ ...EMPTY_PRODUCT_LIST_FILTERS });
  const [filterOptions, setFilterOptions] = useState<ProductListFilterOptions>(emptyFilterOptions);
  const [summary, setSummary] = useState<ProductListSummary>(emptySummary);
  const [pagination, setPagination] = useState<ProductListPagination>(emptyPagination);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [urlNavigationVersion, setUrlNavigationVersion] = useState(0);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const appliedFiltersRef = useRef<ProductListFilters>({ ...EMPTY_PRODUCT_LIST_FILTERS });
  const pageSizeRef = useRef(20);
  const handledUrlNavigationVersionRef = useRef(0);

  const loadProducts = useCallback(async () => {
    if (!urlStateReady) return;
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({ page: String(currentPage), limit: String(pageSize) });
      if (debouncedSearchQuery.trim()) params.set("q", debouncedSearchQuery.trim());
      for (const [key, value] of Object.entries(appliedFilters)) {
        if (value !== "all") params.set(key, value);
      }

      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) {
        setProducts([]);
        return;
      }

      const payload = (await response.json()) as {
        data?: ProductListItem[];
        accountContext?: ProductAccountContext;
        filterOptions?: ProductListFilterOptions;
        pagination?: ProductListPagination;
        summary?: ProductListSummary;
      };
      setProducts(payload.data ?? []);
      setAccountContext(payload.accountContext ?? null);
      setFilterOptions(payload.filterOptions ?? emptyFilterOptions);
      setPagination(payload.pagination ?? emptyPagination);
      setSummary(payload.summary ?? emptySummary);
      if (payload.pagination?.page && payload.pagination.page !== currentPage) {
        setCurrentPage(payload.pagination.page);
      }
    } finally {
      setLoadingProducts(false);
    }
  }, [appliedFilters, currentPage, debouncedSearchQuery, pageSize, urlStateReady]);

  const writeUrlState = useCallback((
    nextFilters: ProductListFilters,
    nextPage: number,
    nextPageSize: number,
    nextSearch: string,
    mode: "push" | "replace" = "push"
  ) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    for (const [key, value] of Object.entries(nextFilters)) {
      if (value !== "all") params.set(key, value);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    if (nextPageSize !== 20) params.set("limit", String(nextPageSize));
    const nextUrl = `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`;
    window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", nextUrl);
  }, []);

  useEffect(() => {
    function readUrlState() {
      const params = new URLSearchParams(window.location.search);
      const nextFilters = parseProductListFilters(params);
      const nextSearch = params.get("q") ?? "";
      const requestedPage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
      const requestedLimit = Number.parseInt(params.get("limit") ?? "20", 10) || 20;
      const nextPageSize = pageSizeOptions.includes(requestedLimit) ? requestedLimit : 20;
      setPendingFilters(nextFilters);
      setAppliedFilters(nextFilters);
      appliedFiltersRef.current = nextFilters;
      setSearchQuery(nextSearch);
      setDebouncedSearchQuery(nextSearch);
      setCurrentPage(requestedPage);
      setPageSize(nextPageSize);
      pageSizeRef.current = nextPageSize;
      setUrlStateReady(true);
      setUrlNavigationVersion((current) => current + 1);
    }

    readUrlState();
    window.addEventListener("popstate", readUrlState);
    return () => window.removeEventListener("popstate", readUrlState);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;
    if (handledUrlNavigationVersionRef.current !== urlNavigationVersion) {
      handledUrlNavigationVersionRef.current = urlNavigationVersion;
      return;
    }
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1);
      writeUrlState(appliedFiltersRef.current, 1, pageSizeRef.current, searchQuery, "replace");
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchQuery, urlNavigationVersion, urlStateReady, writeUrlState]);

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
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && window.innerWidth < 1024) setIsFilterPanelOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const importedFromBlingCount = summary.importedFromBlingCount;
  const unknownBlingStatusCount = summary.unknownBlingStatusCount;
  const totalPages = pagination.totalPages;
  const paginatedProducts = products;

  const visibleProductIds = useMemo(() => paginatedProducts.map((product) => product.id), [paginatedProducts]);
  const selectedProducts = useMemo(() => products.filter((product) => selectedProductIds.has(product.id)), [products, selectedProductIds]);
  const selectedBlingConnectionId =
    accountContext?.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;
  const selectedLinkedBlingProducts = useMemo(
    () =>
      selectedProducts.filter(
        (product) =>
          selectedBlingConnectionId &&
          product.blingAccount?.blingAccountId === selectedBlingConnectionId &&
          Boolean(product.blingAccount.externalProductId?.trim())
      ),
    [selectedBlingConnectionId, selectedProducts]
  );
  const selectedBlingProduct =
    selectedProducts.length === 1 && selectedLinkedBlingProducts.length === 1
      ? selectedLinkedBlingProducts[0]
      : null;
  const selectedVisibleCount = visibleProductIds.filter((id) => selectedProductIds.has(id)).length;
  const allVisibleSelected = visibleProductIds.length > 0 && selectedVisibleCount === visibleProductIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleProductIds.length;
  const pageStart = pagination.total ? (currentPage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(currentPage * pageSize, pagination.total);
  const blingUpdateSelectionMessage = !selectedBlingConnectionId
    ? "Selecione uma conta Bling no topo para atualizar produtos vinculados."
    : selectedProducts.length > 1
      ? "Selecione apenas um produto para atualizar no Bling."
      : selectedLinkedBlingProducts.length === 0
        ? "Este produto ainda nao esta vinculado a esta conta Bling."
        : "Este produto pode ser revisado antes da atualizacao no Bling.";

  function updatePendingFilter<Key extends keyof ProductListFilters>(key: Key, value: ProductListFilters[Key]) {
    setPendingFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    appliedFiltersRef.current = pendingFilters;
    setAppliedFilters({ ...pendingFilters });
    setCurrentPage(1);
    writeUrlState(pendingFilters, 1, pageSize, searchQuery);
    if (window.innerWidth < 1024) setIsFilterPanelOpen(false);
  }

  function clearFilters() {
    const emptyFilters: ProductListFilters = { ...EMPTY_PRODUCT_LIST_FILTERS };
    appliedFiltersRef.current = emptyFilters;
    setPendingFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(1);
    writeUrlState(emptyFilters, 1, pageSize, searchQuery);
  }

  function changePage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    setCurrentPage(safePage);
    writeUrlState(appliedFilters, safePage, pageSize, searchQuery);
  }

  function changePageSize(nextPageSize: number) {
    pageSizeRef.current = nextPageSize;
    setPageSize(nextPageSize);
    setCurrentPage(1);
    writeUrlState(appliedFilters, 1, nextPageSize, searchQuery);
  }

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

  function closeBlingUpdateModal() {
    if (blingUpdateBusy) return;
    setBlingUpdateOpen(false);
    setBlingUpdateMessage("");
    setBlingUpdatePreview(null);
    setBlingUpdateResult(null);
    blingUpdateIdempotencyKey.current = null;
    blingUpdateRequestInFlight.current = false;
  }

  async function openBlingUpdatePreview() {
    setBlingUpdateOpen(true);
    setBlingUpdatePreview(null);
    setBlingUpdateResult(null);
    setBlingUpdateMessage("");
    blingUpdateIdempotencyKey.current = null;
    blingUpdateRequestInFlight.current = false;

    if (!selectedBlingConnectionId) {
      setBlingUpdateMessage("Selecione uma conta Bling no topo antes de atualizar produtos.");
      return;
    }
    if (accountContext?.selectedOption?.status !== "ACTIVE") {
      setBlingUpdateMessage("Reconecte a conta Bling antes de continuar.");
      return;
    }
    if (!selectedBlingProduct) {
      setBlingUpdateMessage(
        selectedProducts.length > 1
          ? "Selecione apenas um produto para atualizar no Bling."
          : "Este produto ainda nao esta vinculado a esta conta Bling."
      );
      return;
    }

    setBlingUpdateBusy(true);
    setBlingUpdateMessage("Carregando os dados atuais do produto...");
    try {
      const response = await fetch("/api/products/bling/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedBlingConnectionId,
          productId: selectedBlingProduct.id,
          confirmed: false
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setBlingUpdateMessage(payload.error ?? "Nao foi possivel revisar os produtos no Bling agora.");
        return;
      }

      const preview = payload.data as BlingProductUpdatePreview;
      setBlingUpdatePreview(preview);
      setBlingUpdateMessage("");
    } catch {
      setBlingUpdateMessage("Nao foi possivel atualizar o produto no Bling agora.");
    } finally {
      setBlingUpdateBusy(false);
    }
  }

  async function confirmBlingProductUpdate(fields: BlingProductReviewChanges) {
    if (
      !selectedBlingConnectionId ||
      !blingUpdatePreview ||
      blingUpdateBusy ||
      blingUpdateRequestInFlight.current ||
      blingUpdateResult?.status === "UPDATED"
    ) return;
    const hadIdempotencyKey = Boolean(blingUpdateIdempotencyKey.current);
    const idempotencyKey = blingUpdateIdempotencyKey.current ?? crypto.randomUUID();
    const operation = fields.name !== undefined && fields.images !== undefined
      ? "NAME_AND_IMAGES"
      : fields.images !== undefined
        ? "IMAGES_ONLY"
        : "NAME_ONLY";
    blingUpdateIdempotencyKey.current = idempotencyKey;
    blingUpdateRequestInFlight.current = true;
    setBlingUpdateBusy(true);
    setBlingUpdateMessage("Atualizando produto...");
    try {
      let activePreview = blingUpdatePreview;
      if (!hadIdempotencyKey && activePreview.confirmedLinkMismatch) {
        const confirmationResponse = await fetch("/api/products/bling/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId: selectedBlingConnectionId,
            productId: activePreview.item.productId,
            confirmed: false,
            confirmedLinkMismatch: true,
            idempotencyKey
          })
        });
        const confirmationPayload = await confirmationResponse.json().catch(() => ({}));
        if (
          !confirmationResponse.ok
          || !confirmationPayload.data?.confirmedLinkMismatch
          || !confirmationPayload.data?.linkMismatchConfirmation
        ) {
          blingUpdateIdempotencyKey.current = null;
          setBlingUpdateMessage(confirmationPayload.error ?? "Revise o vinculo novamente antes de atualizar.");
          return;
        }
        activePreview = confirmationPayload.data as BlingProductUpdatePreview;
        setBlingUpdatePreview(activePreview);
      }

      const response = await fetch("/api/products/bling/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedBlingConnectionId,
          productId: activePreview.item.productId,
          fields,
          operation,
          confirmed: true,
          idempotencyKey,
          ...(activePreview.confirmedLinkMismatch && activePreview.linkMismatchConfirmation
            ? {
                confirmedLinkMismatch: true,
                linkMismatchConfirmation: activePreview.linkMismatchConfirmation
              }
            : {}),
          ...(activePreview.confirmedIncidentReview && activePreview.incidentReviewConfirmation
            ? { incidentReviewConfirmation: activePreview.incidentReviewConfirmation }
            : {})
        })
      });
      const payload = await response.json().catch(() => ({}));
      const result = payload.data?.item as BlingProductUpdateResult | undefined;
      if (!response.ok || !result) {
        setBlingUpdateMessage(payload.error ?? "Nao foi possivel atualizar o produto no Bling agora.");
        return;
      }
      setBlingUpdateResult(result);
      setBlingUpdateMessage(result.message);
      if (result.status === "FAILED" && result.code !== "VERIFICATION_REQUIRED") {
        blingUpdateIdempotencyKey.current = null;
      }
      if (result.status !== "FAILED") {
        setSelectedProductIds((current) => new Set([...current].filter((id) => id !== result.productId)));
        await loadProducts();
      }
    } catch {
      setBlingUpdateResult({
        productId: blingUpdatePreview.item.productId,
        externalProductIdMasked: null,
        status: "FAILED",
        code: "VERIFICATION_REQUIRED",
        message: "A atualizacao pode ter sido concluida. Verifique novamente antes de tentar.",
        fields: []
      });
      setBlingUpdateMessage("A atualizacao pode ter sido concluida. Verifique novamente antes de tentar.");
    } finally {
      blingUpdateRequestInFlight.current = false;
      setBlingUpdateBusy(false);
    }
  }

  async function confirmBlingProductLinkMismatch() {
    if (
      !selectedBlingConnectionId
      || !blingUpdatePreview
      || blingUpdatePreview.item.status !== "VINCULO_PRECISA_REVISAO"
      || blingUpdateBusy
      || blingUpdateRequestInFlight.current
    ) return;
    const idempotencyKey = blingUpdateIdempotencyKey.current ?? crypto.randomUUID();
    blingUpdateIdempotencyKey.current = idempotencyKey;

    blingUpdateRequestInFlight.current = true;
    setBlingUpdateBusy(true);
    setBlingUpdateMessage("Confirmando o vínculo selecionado...");
    try {
      const response = await fetch("/api/products/bling/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedBlingConnectionId,
          productId: blingUpdatePreview.item.productId,
          confirmed: false,
          confirmedLinkMismatch: true,
          idempotencyKey,
          ...(blingUpdatePreview.confirmedIncidentReview && blingUpdatePreview.incidentReviewConfirmation
            ? { incidentReviewConfirmation: blingUpdatePreview.incidentReviewConfirmation }
            : {})
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data?.confirmedLinkMismatch || !payload.data?.linkMismatchConfirmation) {
        setBlingUpdateMessage(payload.error ?? "Não foi possível confirmar este vínculo agora.");
        return;
      }
      setBlingUpdatePreview(payload.data as BlingProductUpdatePreview);
      setBlingUpdateMessage("");
    } catch {
      setBlingUpdateMessage("Não foi possível confirmar este vínculo agora.");
    } finally {
      blingUpdateRequestInFlight.current = false;
      setBlingUpdateBusy(false);
    }
  }

  async function confirmBlingProductIncidentReview() {
    if (
      !selectedBlingConnectionId
      || !blingUpdatePreview
      || blingUpdatePreview.item.status !== "INCIDENT_REVIEW_REQUIRED"
      || blingUpdateBusy
      || blingUpdateRequestInFlight.current
    ) return;
    const idempotencyKey = blingUpdateIdempotencyKey.current ?? crypto.randomUUID();
    blingUpdateIdempotencyKey.current = idempotencyKey;

    blingUpdateRequestInFlight.current = true;
    setBlingUpdateBusy(true);
    setBlingUpdateMessage("Liberando somente a atualização do nome...");
    try {
      const response = await fetch("/api/products/bling/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedBlingConnectionId,
          productId: blingUpdatePreview.item.productId,
          confirmed: false,
          confirmIncidentReview: true,
          idempotencyKey
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (
        !response.ok
        || !payload.data?.confirmedIncidentReview
        || !payload.data?.incidentReviewConfirmation
      ) {
        blingUpdateIdempotencyKey.current = null;
        setBlingUpdateMessage(payload.error ?? "Não foi possível concluir esta revisão agora.");
        return;
      }
      setBlingUpdatePreview(payload.data as BlingProductUpdatePreview);
      setBlingUpdateMessage("");
    } catch {
      blingUpdateIdempotencyKey.current = null;
      setBlingUpdateMessage("Não foi possível concluir esta revisão agora.");
    } finally {
      blingUpdateRequestInFlight.current = false;
      setBlingUpdateBusy(false);
    }
  }

  function handleProductUpdated(updatedProduct: ProductListItem) {
    setProducts((currentProducts) =>
      currentProducts.map((product) => (product.id === updatedProduct.id ? updatedProduct : product))
    );
    setViewingProduct(updatedProduct);
  }

  async function openBlingImportPreview() {
    setBlingImportOpen(true);
    setBlingImportPreview(null);
    setBlingSyncJob(null);
    setBlingImportMessage("");

    const connectionId = accountContext?.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING" ? accountContext.connectionId : null;
    if (!connectionId) {
      setBlingImportMessage("Selecione uma conta Bling no topo antes de consultar os produtos.");
      return;
    }
    if (accountContext?.selectedOption?.status !== "ACTIVE") {
      setBlingImportMessage("Reconecte a conta Bling antes de continuar.");
      return;
    }

    setBlingImportBusy(true);
    try {
      const response = await fetch("/api/products/import-from-bling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dry-run", connectionId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBlingImportMessage(payload.error ?? "Nao foi possivel consultar os produtos do Bling agora.");
        return;
      }
      setBlingImportPreview(payload.preview as BlingImportPreview);
      setBlingImportMessage("Consulta concluida. Nenhum produto foi alterado.");
    } finally {
      setBlingImportBusy(false);
    }
  }

  async function loadBlingSyncJob(connectionId: string, jobId: string) {
    const response = await fetch(`/api/products/import-from-bling?connectionId=${encodeURIComponent(connectionId)}&jobId=${encodeURIComponent(jobId)}`);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const job = payload.job as BlingSyncJob | undefined;
    if (job) setBlingSyncJob(job);
    return job ?? null;
  }

  async function runPreparedBlingSync(connectionId: string, jobId: string) {
    let finished = false;
    const runPromise = fetch("/api/products/import-from-bling", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "run", connectionId, jobId, confirmed: true })
    }).finally(() => {
      finished = true;
    });

    while (!finished) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      await loadBlingSyncJob(connectionId, jobId);
    }

    const response = await runPromise;
    const payload = await response.json().catch(() => ({}));
    await loadBlingSyncJob(connectionId, jobId);
    if (!response.ok) throw new Error(payload.error ?? "Nao foi possivel concluir a sincronizacao.");
    setBlingImportMessage("Sincronizacao concluida em todas as paginas encontradas.");
    await loadProducts();
  }

  async function startBlingSync() {
    const connectionId = accountContext?.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING" ? accountContext.connectionId : null;
    if (!connectionId || !blingImportPreview || blingImportBusy) return;
    const confirmed = window.confirm("Esta acao percorrera todas as paginas do Bling e atualizara o catalogo local. Deseja continuar?");
    if (!confirmed) return;

    setBlingImportBusy(true);
    setBlingImportMessage("Preparando a sincronizacao completa...");
    try {
      const response = await fetch("/api/products/import-from-bling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "prepare", connectionId, confirmed: true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.job?.id) {
        setBlingImportMessage(payload.error ?? "Nao foi possivel preparar a sincronizacao.");
        return;
      }
      setBlingSyncJob(payload.job as BlingSyncJob);
      setBlingImportMessage("Sincronizando as paginas encontradas...");
      await runPreparedBlingSync(connectionId, payload.job.id as string);
    } catch (error) {
      setBlingImportMessage(error instanceof Error ? error.message : "Nao foi possivel concluir a sincronizacao.");
    } finally {
      setBlingImportBusy(false);
    }
  }

  return (
    <AppShell denseDesktopShell>
      <div className="relative flex min-w-0 items-stretch lg:h-[calc(100dvh-5.375rem)] lg:min-h-0 lg:gap-3" data-testid="products-layout">
        <div className="min-w-0 flex-1 lg:flex lg:min-h-0 lg:flex-col" data-testid="products-list-area">
          <div className="shrink-0 [&>div]:!mb-3 [&>div]:!flex-wrap [&>div]:!py-2 [&_h2]:!text-2xl">
          <PageHeader
            title="Produtos"
            description="Catalogo central com SKU, EAN, fiscal, imagens, vinculos Bling e status de publicacao."
            actions={
              <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto lg:gap-[5px]">
            <Link
              className="inline-flex min-h-8 w-auto min-w-max shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-matrix-gold px-2.5 py-1 text-[11px] font-semibold text-black shadow-gold transition hover:bg-matrix-goldDark hover:text-white"
              href="/products/cadastro-inteligente"
            >
              <Sparkles className="h-3 w-3 shrink-0" /> Cadastro Inteligente
            </Link>
            <Button className="!min-h-8 w-auto min-w-max shrink-0 gap-1 whitespace-nowrap !px-2.5 !py-1 text-[11px]" onClick={() => setOpen(true)}><Plus className="h-3 w-3 shrink-0" /> Novo produto</Button>
            <Button className="!min-h-8 w-auto min-w-max shrink-0 gap-1 whitespace-nowrap !px-2.5 !py-1 text-[11px]" onClick={() => void openBlingImportPreview()} variant="secondary"><FileUp className="h-3 w-3 shrink-0" /> Importar do Bling</Button>
            <Button className="!min-h-8 w-auto min-w-max shrink-0 gap-1 whitespace-nowrap !px-2.5 !py-1 text-[11px]" variant="secondary"><Download className="h-3 w-3 shrink-0" /> Exportar</Button>
            <Button className="!min-h-8 w-auto min-w-max shrink-0 gap-1 whitespace-nowrap !px-2.5 !py-1 text-[11px]" onClick={() => void openBlingImportPreview()} variant="secondary"><RefreshCw className="h-3 w-3 shrink-0" /> Sincronizar</Button>
              </div>
            }
          />
          </div>
          <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:max-w-none lg:grid-cols-[231px_214px_221px_219px] lg:gap-2 [&_section]:!min-h-[5.75rem] [&_section]:!p-2.5 [&_section_p:nth-child(2)]:!text-xl [&_section_p:nth-child(2)]:!leading-6">
            <KpiCard label="Produtos cadastrados" value={String(summary.totalProducts)} hint={summary.totalProducts ? "Catalogo local carregado" : "Catalogo vazio"} />
            <KpiCard label="Em revisao" value="0" hint="Nenhuma pendencia" tone="warning" />
            <KpiCard label="Prontos para enviar" value={String(summary.readyForTestCount)} hint="Produtos prontos para teste" tone="success" />
            <KpiCard
              label="Importados do Bling"
              value={String(importedFromBlingCount)}
              hint={importedFromBlingCount ? "Produtos vinculados a conta Bling" : "Nenhum vinculo Bling"}
              tone="purple"
            />
          </div>
          <Card className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col !px-2.5 !pb-4 !pt-3">
          <div className="relative mb-2 min-w-0">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-matrix-muted" />
              <input
                aria-label="Buscar por titulo, SKU ou GTIN"
                className="h-9 w-full rounded-md border border-matrix-border bg-white/[0.03] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-600 focus:border-matrix-gold/55"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar por titulo, SKU ou GTIN"
                value={searchQuery}
              />
            </div>
          </div>

        {unknownBlingStatusCount > 0 ? (
          <div className="mb-2 flex min-h-[30px] items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              O status de {unknownBlingStatusCount} {unknownBlingStatusCount === 1 ? "produto ainda nao foi atualizado" : "produtos ainda nao foi atualizado"}.
            </span>
          </div>
        ) : null}
        {selectedProducts.length ? (
          <div className="mb-3 flex flex-col gap-3 rounded-lg border border-matrix-gold/25 bg-matrix-goldSoft/28 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-matrix-goldDark">
                {selectedProducts.length === 1
                  ? "1 produto selecionado para cadastro"
                  : `${selectedProducts.length} produtos selecionados para cadastro`}
              </p>
              <p className="mt-1 text-xs text-matrix-muted">{blingUpdateSelectionMessage}</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button className="w-full sm:w-auto" onClick={() => openEnrichment(selectedProducts)}>
                Cadastrar selecionados
              </Button>
              <Button
                className="w-full sm:w-auto"
                disabled={
                  !selectedBlingConnectionId ||
                  accountContext?.selectedOption?.status !== "ACTIVE" ||
                  !selectedBlingProduct ||
                  blingUpdateBusy
                }
                onClick={() => void openBlingUpdatePreview()}
                type="button"
                variant="secondary"
              >
                <RefreshCw className="h-4 w-4" />
                Atualizar no Bling
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-matrix-border bg-matrix-panel [&_table]:w-full [&_table]:table-fixed [&_table]:min-w-[1030px] [&_th]:overflow-hidden [&_th]:px-2 [&_th]:py-1 [&_td]:overflow-hidden [&_td]:px-2 [&_td]:py-[5.5px] [&_thead]:text-[11px] [&_tbody]:text-[11px]" data-testid="products-table-shell">
          <div className="matrix-scroll h-0 min-h-0 flex-1 overflow-auto overscroll-contain [&>div]:rounded-none [&>div]:border-0 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[1]">
            <DataTable
          columnWidths={[42, 370, 94, 110, 93, 100, 99, 111, 60, 86, 62]}
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
            "Lojas",
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
              <div key={`${product.id}-name`} className="flex min-w-0 items-center gap-2">
              <div className="grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-md border border-matrix-border bg-matrix-panel2/80">
                {product.imageUrl ? (
                  <Image
                    alt={product.name}
                    className="h-full w-full object-cover"
                    height={34}
                    src={product.imageUrl}
                    unoptimized
                    width={34}
                  />
                ) : (
                  <ImageIcon className="h-4 w-4 text-matrix-muted" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">{product.name}</span>
                  <ProductCopyButton className="!h-4 !w-4 [&_svg]:!h-2.5 [&_svg]:!w-2.5" label="Copiar titulo" text={product.name} />
                </div>
                {getBlingCatalogStatusMessage(product.blingStatus) ? (
                  <p className="sr-only">
                    {getBlingCatalogStatusMessage(product.blingStatus)}
                  </p>
                ) : null}
              </div>
            </div>,
            <div key={`${product.id}-sku`} className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate">{product.sku || "-"}</span>
              <ProductCopyButton className="!h-4 !w-4 [&_svg]:!h-2.5 [&_svg]:!w-2.5" label="Copiar SKU" text={product.sku} />
            </div>,
            <div key={`${product.id}-ean`} className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate">{product.ean ?? "-"}</span>
              <ProductCopyButton className="!h-4 !w-4 [&_svg]:!h-2.5 [&_svg]:!w-2.5" label="Copiar EAN" text={product.ean} />
            </div>,
            product.unit ?? "-",
            product.category ?? "-",
            formatCurrencyDisplay(product.costPriceDisplay ?? product.displayValue) ?? "-",
            formatCurrencyDisplay(product.salePriceDisplay) ?? "0,00",
            <ProductStoresCell key={`${product.id}-stores`} product={product} />,
            product.stock,
            <Button
              key={`${product.id}-actions`}
              aria-label={`Ver ${product.name}`}
              className="h-8 min-h-8 w-8 px-0 py-0"
              variant="secondary"
              onClick={() => setViewingProduct(product)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          ])}
          emptyMessage={
            loadingProducts
              ? "Carregando produtos..."
              : summary.totalProducts
                ? "Nenhum produto corresponde aos filtros atuais."
                : "Nenhum produto cadastrado ainda."
          }
          footer={<></>}
          />
          </div>
          <div className="grid shrink-0 gap-3 border-t border-matrix-border px-3 pb-7 pt-4 text-xs text-matrix-muted lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            <span>Mostrando {pageStart} a {pageEnd} de {pagination.total} produtos</span>
            <div className="flex items-center justify-center gap-1.5">
              <Button className="h-9 min-h-9 px-3" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)} type="button" variant="secondary">
                Anterior
              </Button>
              {getProductPaginationItems(currentPage, totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="grid h-9 w-9 place-items-center">...</span>
                ) : (
                  <Button
                    key={item}
                    aria-current={item === currentPage ? "page" : undefined}
                    className="h-9 min-h-9 w-9 px-0"
                    onClick={() => changePage(item)}
                    type="button"
                    variant={item === currentPage ? "primary" : "secondary"}
                  >
                    {item}
                  </Button>
                )
              )}
              <Button className="h-9 min-h-9 px-3" disabled={currentPage >= totalPages} onClick={() => changePage(currentPage + 1)} type="button" variant="secondary">
                Proxima
              </Button>
            </div>
            <label className="flex items-center gap-2 lg:justify-end">
              <select
                aria-label="Produtos por pagina"
                className="h-9 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 text-xs font-semibold text-matrix-fg outline-none"
                onChange={(event) => changePageSize(Number(event.target.value))}
                value={pageSize}
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>{option} produtos por pagina</option>
                ))}
              </select>
            </label>
          </div>
        </div>
          </Card>
        </div>

        <button
          aria-controls="product-filter-panel"
          aria-expanded={isFilterPanelOpen}
          aria-label={isFilterPanelOpen ? "Recolher filtros" : "Mostrar filtros"}
          className={`z-[80] grid h-11 w-11 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted shadow-glow transition-[right,border-color,color] hover:border-matrix-gold/50 hover:text-matrix-goldDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold/70 lg:absolute lg:top-1/2 lg:z-20 lg:-translate-y-1/2 lg:translate-x-1/2 ${
            isFilterPanelOpen
              ? "fixed right-4 top-4 lg:right-[18rem]"
              : "fixed bottom-4 right-4 lg:bottom-auto lg:right-[1.375rem]"
          }`}
          onClick={() => setIsFilterPanelOpen((current) => !current)}
          data-testid="product-filter-toggle"
          title={isFilterPanelOpen ? "Recolher filtros" : "Mostrar filtros"}
          type="button"
        >
          {isFilterPanelOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        <div
          aria-hidden={!isFilterPanelOpen}
          className={`fixed inset-0 z-[70] min-w-0 transition-[visibility,opacity] duration-200 lg:relative lg:inset-auto lg:z-auto lg:h-full lg:self-stretch lg:transition-[width,opacity] ${
            isFilterPanelOpen
              ? "visible opacity-100 lg:w-[17.25rem]"
              : "pointer-events-none invisible overflow-hidden opacity-0 lg:hidden lg:w-0"
          }`}
          data-testid="product-filter-panel-wrap"
        >
          <button
            aria-label="Fechar filtros"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm lg:hidden"
            onClick={() => setIsFilterPanelOpen(false)}
            tabIndex={-1}
            type="button"
          />
          <aside
            id="product-filter-panel"
            className={`absolute inset-y-0 right-0 flex w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden border-l border-matrix-border bg-matrix-panel shadow-glow transition-transform duration-200 lg:relative lg:inset-auto lg:h-full lg:w-[17.25rem] lg:translate-x-0 lg:rounded-r-md lg:border-y lg:border-r ${
              isFilterPanelOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="border-b border-matrix-border px-4 pb-0 pt-4">
              <div className="flex items-center justify-between gap-3 pr-12 lg:pr-0">
                <button
                  className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={clearFilters}
                  title="Limpar filtros"
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                  Limpar filtros
                </button>
              </div>
              <h2 className="mt-3 text-base font-semibold text-matrix-fg lg:mt-2">Filtros</h2>
            </div>
            <div className="matrix-scroll flex-1 overflow-y-auto pb-3 pl-[17px] pr-[22px] pt-1">
              <div className="grid gap-4">
                <ProductFilterSelect
                  hint="Marketplace"
                  label="Origem"
                  onChange={(value) => updatePendingFilter("origin", value as ProductListFilters["origin"])}
                  value={pendingFilters.origin}
                >
                  <option value="all">Todos</option>
                  {filterOptions.origins.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </ProductFilterSelect>

                <ProductFilterSelect label="GTIN" onChange={(value) => updatePendingFilter("gtin", value as ProductListFilters["gtin"])} value={pendingFilters.gtin}>
                  <option value="all">Todos</option>
                  <option value="with">Com GTIN</option>
                  <option value="without">Sem GTIN</option>
                </ProductFilterSelect>

                <ProductFilterSelect label="Imagens" onChange={(value) => updatePendingFilter("images", value as ProductListFilters["images"])} value={pendingFilters.images}>
                  <option value="all">Todos</option>
                  <option value="with">Com imagens</option>
                  <option value="without">Sem imagens</option>
                </ProductFilterSelect>

                <ProductFilterSelect label="Estoque" onChange={(value) => updatePendingFilter("stock", value as ProductListFilters["stock"])} value={pendingFilters.stock}>
                  <option value="all">Todos</option>
                  <option value="with">Com estoque</option>
                  <option value="without">Sem estoque</option>
                  <option value="negative">Estoque negativo</option>
                </ProductFilterSelect>

                <ProductFilterSelect label="Status no Bling" onChange={(value) => updatePendingFilter("blingStatus", value as ProductListFilters["blingStatus"])} value={pendingFilters.blingStatus}>
                  <option value="all">Todos</option>
                  <option value="active">Ativos</option>
                  <option value="inactive">Inativos</option>
                  <option value="deleted">Excluidos</option>
                  <option value="unknown">Pendentes</option>
                </ProductFilterSelect>

                <ProductFilterSelect label="Vinculo Bling" onChange={(value) => updatePendingFilter("blingLink", value as ProductListFilters["blingLink"])} value={pendingFilters.blingLink}>
                  <option value="all">Todos</option>
                  <option value="with">Vinculados</option>
                  <option value="without">Sem vinculo</option>
                </ProductFilterSelect>

                <ProductFilterSelect label="Categoria" onChange={(value) => updatePendingFilter("category", value)} value={pendingFilters.category}>
                  <option value="all">Todas</option>
                  {filterOptions.categories.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </ProductFilterSelect>
                {filterOptions.categoriesTruncated ? <p className="-mt-3 text-xs text-amber-300">Lista limitada às primeiras 500 categorias.</p> : null}

                <ProductFilterSelect label="Marca" onChange={(value) => updatePendingFilter("brand", value)} value={pendingFilters.brand}>
                  <option value="all">Todas</option>
                  {filterOptions.brands.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </ProductFilterSelect>
                {filterOptions.brandsTruncated ? <p className="-mt-3 text-xs text-amber-300">Lista limitada às primeiras 500 marcas.</p> : null}
              </div>
            </div>
            <div className="border-t border-matrix-border bg-matrix-panel pb-[18px] pl-[17px] pr-[22px] pt-[7px]">
              <Button className="w-full" onClick={applyFilters} type="button">
                <SlidersHorizontal className="h-4 w-4" />
                Aplicar filtros
              </Button>
            </div>
          </aside>
        </div>
      </div>
      {viewingProduct ? (
        <ProductDetailsModal
          product={viewingProduct}
          onClose={() => setViewingProduct(null)}
          onProductUpdated={handleProductUpdated}
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
      {blingUpdateOpen ? (
        <BlingProductUpdateModal
          busy={blingUpdateBusy}
          message={blingUpdateMessage}
          onClose={closeBlingUpdateModal}
          onConfirm={(fields) => void confirmBlingProductUpdate(fields)}
          onConfirmIncidentReview={() => void confirmBlingProductIncidentReview()}
          onConfirmLinkMismatch={() => void confirmBlingProductLinkMismatch()}
          preview={blingUpdatePreview}
          result={blingUpdateResult}
        />
      ) : null}
      {blingImportOpen ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={() => !blingImportBusy && setBlingImportOpen(false)}>
          <section aria-modal="true" className="matrix-scroll max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-matrix-gold/35 bg-matrix-panel p-5" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-matrix-fg">Produtos da conta Bling</h3>
                <p className="mt-1 text-sm text-matrix-muted">Revise a consulta antes de iniciar qualquer atualização local.</p>
              </div>
              <button aria-label="Fechar consulta Bling" className="grid h-9 w-9 place-items-center rounded-md border border-matrix-border text-matrix-muted" disabled={blingImportBusy} onClick={() => setBlingImportOpen(false)} type="button"><X className="h-4 w-4" /></button>
            </div>

            {blingImportBusy && !blingSyncJob ? <p className="mt-5 rounded-md border border-matrix-border bg-matrix-panel2 p-4 text-sm text-matrix-muted">Consultando todas as páginas com segurança...</p> : null}
            {blingImportPreview ? (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard label="Encontrados" value={String(blingImportPreview.totalFound)} hint={`${blingImportPreview.pagesFound} paginas`} />
                  <KpiCard label="Importáveis" value={String(blingImportPreview.importable)} hint="Por identidade externa" tone="success" />
                  <KpiCard label="Já existentes" value={String(blingImportPreview.existing)} hint="Seriam atualizados" tone="purple" />
                  <KpiCard label="Novos" value={String(blingImportPreview.new)} hint="Seriam criados" tone="info" />
                  <KpiCard label="Ativos" value={String(blingImportPreview.active)} hint="Na conta consultada" />
                  <KpiCard label="Inativos" value={String(blingImportPreview.inactive)} hint="Mantidos sem exclusão" tone="warning" />
                  <KpiCard label="Sem SKU" value={String(blingImportPreview.withoutSku)} hint="Identificados pelo Bling" tone="warning" />
                  <KpiCard label="Precisam de revisão" value={String(blingImportPreview.ignored)} hint="Conflitos ou dados inválidos" tone="danger" />
                </div>
                <dl className="mt-4 grid gap-x-6 gap-y-2 rounded-md border border-matrix-border bg-matrix-panel2 p-4 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">Total informado pelo Bling</dt><dd className="font-semibold text-matrix-fg">{blingImportPreview.totalReportedByBling ?? "Não informado"}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">Produtos simples</dt><dd className="font-semibold text-matrix-fg">{blingImportPreview.simpleProducts}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">Variações</dt><dd className="font-semibold text-matrix-fg">{blingImportPreview.variations}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">Seriam atualizados</dt><dd className="font-semibold text-matrix-fg">{blingImportPreview.wouldUpdate}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">Dados inválidos</dt><dd className="font-semibold text-matrix-fg">{blingImportPreview.errors}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">IDs repetidos</dt><dd className="font-semibold text-matrix-fg">{blingImportPreview.duplicateExternalIds}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">Conflitos de SKU</dt><dd className="font-semibold text-matrix-fg">{blingImportPreview.skuConflicts}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-matrix-muted">Alterações realizadas</dt><dd className="font-semibold text-matrix-fg">Nenhuma</dd></div>
                </dl>
              </>
            ) : null}

            {blingSyncJob ? (
              <section className="mt-5 rounded-md border border-matrix-border bg-matrix-panel2 p-4 text-sm text-matrix-muted">
                <div className="flex items-center justify-between gap-3"><span>Próxima página</span><strong className="text-matrix-fg">{blingSyncJob.currentPage}</strong></div>
                <div className="mt-2 flex items-center justify-between gap-3"><span>Registros processados</span><strong className="text-matrix-fg">{blingSyncJob.totalFetched}</strong></div>
                <div className="mt-2 flex items-center justify-between gap-3"><span>Status</span><Badge tone={blingSyncJob.status === "COMPLETED" ? "success" : blingSyncJob.status === "FAILED" ? "danger" : "warning"}>{blingSyncJob.status === "COMPLETED" ? "Concluído" : blingSyncJob.status === "FAILED" ? "Interrompido" : "Em andamento"}</Badge></div>
              </section>
            ) : null}

            {blingImportMessage ? <p className="mt-5 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm text-matrix-muted">{blingImportMessage}</p> : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button disabled={blingImportBusy} onClick={() => setBlingImportOpen(false)} type="button" variant="secondary">Fechar</Button>
              {blingImportPreview ? <Button disabled={blingImportBusy || !blingImportPreview.completed} onClick={() => void startBlingSync()} type="button">{blingImportBusy ? "Sincronizando..." : "Confirmar sincronização"}</Button> : null}
            </div>
          </section>
        </div>
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
  ean: string;
  unit: string;
  category: string;
  costPrice: string;
  salePrice: string;
  weight: string;
  grossWeight: string;
  height: string;
  width: string;
  depth: string;
  condition: string;
  description: string;
};

const productConditionAliases = ["condition", "item_condition", "ITEM_CONDITION", "condicao"];
const productGrossWeightAliases = ["grossWeight", "gross_weight", "grossWeightKg", "pesoBruto", "peso_bruto"];

function toFormText(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function getProductCondition(product: ProductListItem) {
  return productAttributeValue(product.attributes, productConditionAliases);
}

function getProductGrossWeight(product: ProductListItem) {
  return productAttributeValue(product.attributes, productGrossWeightAliases);
}

function productFormFromProduct(product: ProductListItem): ProductEditForm {
  return {
    name: product.name,
    ean: toFormText(product.ean),
    unit: toFormText(product.unit),
    category: toFormText(product.category),
    costPrice: toFormText(product.costPriceDisplay ?? product.displayValue),
    salePrice: toFormText(product.salePriceDisplay ?? product.price),
    weight: toFormText(product.weight),
    grossWeight: toFormText(getProductGrossWeight(product)),
    height: toFormText(product.height),
    width: toFormText(product.width),
    depth: toFormText(product.depth),
    condition: toFormText(getProductCondition(product)),
    description: cleanProductDescription(product.description)
  };
}

function parseOptionalFormDecimal(value: string, field: string) {
  const text = value.trim();
  if (!text) return { value: null };

  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) return { error: `${field} deve ser numerico.` };
  if (parsed < 0) return { error: `${field} nao pode ser negativo.` };

  return { value: parsed };
}

function ProductDetailsModal({
  product,
  onClose,
  onProductUpdated
}: {
  product: ProductListItem;
  onClose: () => void;
  onProductUpdated: (product: ProductListItem) => void;
}) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProductEditForm>(() => productFormFromProduct(product));
  const [canEditProduct, setCanEditProduct] = useState(false);
  const [permissionChecked, setPermissionChecked] = useState(false);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (confirmingSave) {
        setConfirmingSave(false);
        return;
      }
      onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmingSave, onClose]);

  useEffect(() => {
    let active = true;

    async function loadPermission() {
      try {
        const response = await fetch("/api/auth/session");
        if (!response.ok) return;
        const payload = (await response.json()) as { user?: { role?: string } };
        if (!active) return;
        setCanEditProduct(payload.user?.role === "OWNER" || payload.user?.role === "ADMIN");
      } finally {
        if (active) setPermissionChecked(true);
      }
    }

    void loadPermission();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setForm(productFormFromProduct(product));
    setDescriptionExpanded(false);
    setEditing(false);
    setConfirmingSave(false);
    setSaving(false);
    setFeedback(null);
    setError(null);
  }, [product]);

  const statusText = statusLabel[product.status] ?? displayText(product.status);
  const originText = displayText(product.origin ?? product.source ?? (getBlingDisplayName(product) ? "BLING" : null));
  const description = editing ? form.description : cleanProductDescription(product.description);
  const descriptionLineCount = description.split(/\r?\n/).filter(Boolean).length;
  const canToggleDescription = !editing && (description.length > 360 || descriptionLineCount > 4);
  const descriptionIsCollapsed = canToggleDescription && !descriptionExpanded;
  const cardClass = "rounded-lg border border-matrix-border bg-matrix-panel2/70 p-3";
  const inputClass =
    "mt-2 h-10 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm font-semibold text-matrix-fg outline-none transition placeholder:text-matrix-muted focus:border-matrix-gold/70 focus:ring-2 focus:ring-matrix-gold/20";
  const textareaClass =
    "mt-3 min-h-40 w-full resize-y rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm leading-6 text-matrix-fg outline-none transition placeholder:text-matrix-muted focus:border-matrix-gold/70 focus:ring-2 focus:ring-matrix-gold/20";
  const readOnlyDetails = [
    { label: "Nome do produto", value: product.name, Icon: Package, className: "sm:col-span-2 xl:col-span-1" },
    { label: "Marca", value: product.brand ?? "Sem marca", Icon: Factory },
    { label: "SKU", value: product.sku, Icon: Tag },
    { label: "EAN", value: product.ean, Icon: Barcode },
    { label: "Unidade", value: product.unit, Icon: ClipboardList },
    { label: "Categoria", value: product.category, Icon: Folder },
    { label: "Origem", value: originText, Icon: Globe2 },
    { label: "Status no Bling", value: getBlingCatalogStatusLabel(product.blingStatus), Icon: ShieldCheck },
    { label: "Custo", value: formatCurrencyDisplay(product.costPriceDisplay ?? product.displayValue), Icon: DollarSign },
    { label: "Preco de venda", value: formatCurrencyDisplay(product.salePriceDisplay), Icon: Tag },
    { label: "Estoque", value: product.stock, Icon: Box },
    { label: "Peso liquido", value: formatMeasurement(product.weight, "kg"), Icon: Scale },
    { label: "Peso bruto", value: formatMeasurement(getProductGrossWeight(product), "kg"), Icon: Scale },
    { label: "Condicao", value: getProductCondition(product), Icon: ShieldCheck },
    { label: "Altura", value: formatMeasurement(product.height, "cm"), Icon: Ruler },
    { label: "Largura", value: formatMeasurement(product.width, "cm"), Icon: Ruler },
    { label: "Profundidade", value: formatMeasurement(product.depth, "cm"), Icon: Ruler },
    { label: "Data de atualizacao", value: formatDate(product.updatedAt), Icon: CalendarDays, className: "sm:col-span-2 xl:col-span-3" }
  ];
  const editFields: Array<{
    key: keyof ProductEditForm;
    label: string;
    Icon: typeof Package;
    className?: string;
    inputMode?: "decimal" | "text";
  }> = [
    { key: "name", label: "Nome do produto", Icon: Package, className: "sm:col-span-2 xl:col-span-1" },
    { key: "ean", label: "EAN", Icon: Barcode },
    { key: "unit", label: "Unidade", Icon: ClipboardList },
    { key: "category", label: "Categoria", Icon: Folder },
    { key: "costPrice", label: "Custo", Icon: DollarSign, inputMode: "decimal" },
    { key: "salePrice", label: "Preco de venda", Icon: Tag, inputMode: "decimal" },
    { key: "weight", label: "Peso liquido (kg)", Icon: Scale, inputMode: "decimal" },
    { key: "grossWeight", label: "Peso bruto (kg)", Icon: Scale, inputMode: "decimal" },
    { key: "condition", label: "Condicao", Icon: ShieldCheck },
    { key: "height", label: "Altura (cm)", Icon: Ruler, inputMode: "decimal" },
    { key: "width", label: "Largura (cm)", Icon: Ruler, inputMode: "decimal" },
    { key: "depth", label: "Profundidade (cm)", Icon: Ruler, inputMode: "decimal" }
  ];
  const aiActions = [
    { label: "Melhorar titulo", Icon: Wand2 },
    { label: "Gerar descricao", Icon: FileText },
    { label: "Ficha tecnica", Icon: ClipboardList },
    { label: "Corrigir categoria", Icon: Folder },
    { label: "Revisar dimensoes", Icon: Ruler },
    { label: "Sugerir atributos", Icon: Sparkles }
  ];
  const blockedExternalActions = [
    { label: "Enviar para Mercado Livre", Icon: Globe2 },
    { label: "Atualizar no Bling", Icon: FileUp },
    { label: "Sincronizar alteracoes", Icon: RefreshCw }
  ];

  function updateField(key: keyof ProductEditForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setFeedback(null);
  }

  function buildPayload() {
    if (form.name.trim().length < 2) return { error: "Nome do produto deve ter ao menos 2 caracteres." };

    const decimalFields: Array<[keyof ProductEditForm, string]> = [
      ["costPrice", "Custo"],
      ["salePrice", "Preco de venda"],
      ["weight", "Peso liquido"],
      ["grossWeight", "Peso bruto"],
      ["height", "Altura"],
      ["width", "Largura"],
      ["depth", "Profundidade"]
    ];
    const decimals: Partial<Record<keyof ProductEditForm, number | null>> = {};

    for (const [key, label] of decimalFields) {
      const parsed = parseOptionalFormDecimal(form[key], label);
      if ("error" in parsed) return { error: parsed.error };
      decimals[key] = parsed.value;
    }

    return {
      payload: {
        name: form.name.trim(),
        ean: form.ean.trim() || null,
        unit: form.unit.trim() || null,
        category: form.category.trim() || null,
        displayValue: form.costPrice.trim() || null,
        salePriceDisplay: form.salePrice.trim() || null,
        weight: decimals.weight ?? null,
        height: decimals.height ?? null,
        width: decimals.width ?? null,
        depth: decimals.depth ?? null,
        description: form.description,
        attributes: {
          condition: form.condition.trim() || null,
          grossWeight: decimals.grossWeight === null || decimals.grossWeight === undefined ? null : String(decimals.grossWeight)
        }
      }
    };
  }

  function requestSave() {
    const result = buildPayload();
    if ("error" in result) {
      setError(result.error ?? "Dados invalidos.");
      return;
    }
    setConfirmingSave(true);
  }

  async function confirmSave() {
    const result = buildPayload();
    if ("error" in result) {
      setError(result.error ?? "Dados invalidos.");
      setConfirmingSave(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.payload)
      });
      const payload = (await response.json()) as { data?: ProductListItem; error?: string };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Nao foi possivel salvar o produto.");
      }

      onProductUpdated(payload.data);
      setForm(productFormFromProduct(payload.data));
      setEditing(false);
      setConfirmingSave(false);
      setFeedback("Produto atualizado com sucesso.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Nao foi possivel salvar o produto.");
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setForm(productFormFromProduct(product));
    setEditing(false);
    setConfirmingSave(false);
    setError(null);
    setFeedback(null);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-3 py-5 backdrop-blur-md" onClick={onClose}>
      <section
        aria-modal="true"
        className="matrix-scroll max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-matrix-gold/35 bg-matrix-panel/95 p-5 text-matrix-fg shadow-glow sm:p-7"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-matrix-goldDark">Produto</p>
            <h3 className="mt-1 text-2xl font-bold tracking-normal text-matrix-fg">
              {editing ? "Editando produto" : "Detalhes do produto"}
            </h3>
            <p className="mt-1 text-sm text-matrix-muted">
              {editing ? "Ajuste local do cadastro do Matrix, sem envio automatico para integracoes." : "Visualizacao do cadastro atual do produto."}
            </p>
          </div>
          <button
            aria-label="Fechar detalhes do produto"
            className="grid h-11 w-11 place-items-center rounded-lg border border-matrix-border bg-matrix-panel2/80 text-matrix-muted transition hover:border-matrix-gold/70 hover:bg-matrix-goldSoft/35 hover:text-matrix-goldDark"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 grid gap-5 rounded-xl border border-matrix-border bg-matrix-panel2/60 p-4 lg:grid-cols-[320px_1fr]">
          <div className="grid min-h-56 place-items-center overflow-hidden rounded-lg border border-matrix-border bg-white text-matrix-muted">
            {product.imageUrl ? (
              <Image
                alt={product.name}
                className="h-full max-h-[300px] w-full object-contain"
                height={300}
                src={product.imageUrl}
                unoptimized
                width={420}
              />
            ) : (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-xl bg-matrix-goldSoft/60 text-matrix-goldDark">
                  <ImageIcon className="h-7 w-7" />
                </div>
                <p className="mt-3 text-sm font-semibold text-matrix-muted">Sem imagem</p>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center">
            <h4 className="text-2xl font-bold leading-tight text-matrix-fg sm:text-3xl">{editing ? form.name || product.name : product.name}</h4>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-matrix-gold/30 bg-matrix-goldSoft/35 px-3 py-2 text-sm font-semibold text-matrix-goldDark">
                <span className="h-2 w-2 rounded-full bg-matrix-gold" />
                {statusText}
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-matrix-border bg-matrix-panel/70 px-3 py-2 text-sm font-semibold text-matrix-fg">
                Origem: <span className="text-matrix-goldDark">{originText}</span>
              </span>
              {getBlingDisplayName(product) ? (
                <span className="inline-flex items-center gap-2 rounded-lg border border-matrix-border bg-matrix-panel/70 px-3 py-2 text-sm text-matrix-muted">
                  Conta: <span className="font-semibold text-matrix-fg">{getBlingDisplayName(product)}</span>
                </span>
              ) : null}
              {editing ? (
                <span className="inline-flex items-center gap-2 rounded-lg border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-sm font-semibold text-orange-700">
                  <AlertTriangle className="h-4 w-4" />
                  Edicao local
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {getBlingCatalogStatusMessage(product.blingStatus) ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{getBlingCatalogStatusMessage(product.blingStatus)}</span>
          </div>
        ) : null}

        {feedback ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            {feedback}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {editing
            ? editFields.map(({ key, label, Icon, className, inputMode }) => (
                <label key={key} className={`${cardClass} ${className ?? ""}`}>
                  <span className="flex items-center gap-2 text-xs text-matrix-muted">
                    <Icon className="h-4 w-4 shrink-0 text-matrix-goldDark" />
                    {label}
                  </span>
                  <input
                    className={inputClass}
                    inputMode={inputMode}
                    onChange={(event) => updateField(key, event.target.value)}
                    value={form[key]}
                  />
                </label>
              ))
            : readOnlyDetails.map(({ label, value, Icon, className }) => (
                <div key={label} className={`${cardClass} ${className ?? ""}`}>
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-matrix-goldDark" />
                    <div className="min-w-0">
                      <p className="text-xs text-matrix-muted">{label}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-matrix-fg">{displayText(value)}</p>
                    </div>
                  </div>
                </div>
              ))}
        </div>

        <div className="mt-3 rounded-lg border border-matrix-border bg-matrix-panel2/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-matrix-fg">
              <FileText className="h-4 w-4 text-matrix-goldDark" />
              Descricao
            </div>
            {canToggleDescription ? (
              <button
                aria-expanded={descriptionExpanded}
                className="inline-flex items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel px-2.5 py-1.5 text-xs font-semibold text-matrix-goldDark transition hover:border-matrix-gold/60 hover:bg-matrix-goldSoft/25"
                onClick={() => setDescriptionExpanded((current) => !current)}
                title={descriptionExpanded ? "Recolher descricao" : "Expandir descricao"}
                type="button"
              >
                {descriptionExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {descriptionExpanded ? "Recolher" : "Expandir"}
              </button>
            ) : null}
          </div>
          {editing ? (
            <textarea
              className={textareaClass}
              onChange={(event) => updateField("description", event.target.value)}
              value={form.description}
            />
          ) : (
            <div
              className={`relative mt-3 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 ${
                descriptionIsCollapsed ? "max-h-28 overflow-hidden" : canToggleDescription ? "max-h-[46vh] overflow-y-auto pr-2" : ""
              }`}
            >
              <p className="whitespace-pre-line text-sm leading-6 text-matrix-fg">
                {description || "Sem descricao cadastrada."}
              </p>
              {descriptionIsCollapsed ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-matrix-panel to-transparent" />
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-3 rounded-lg border border-matrix-border bg-matrix-panel2/70 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-matrix-fg">
            <Sparkles className="h-4 w-4 text-matrix-goldDark" />
            Acoes rapidas de IA
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {aiActions.map(({ label, Icon }) => (
              <Button key={label} disabled title="Em breve" variant="secondary">
                <Icon className="h-4 w-4" />
                {label}
                <span className="rounded-full bg-matrix-muted/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-matrix-muted">
                  Em breve
                </span>
              </Button>
            ))}
          </div>
          <div className="mt-4 border-t border-matrix-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-matrix-muted">Envios externos bloqueados nesta etapa</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {blockedExternalActions.map(({ label, Icon }) => (
                <Button key={label} disabled title="Bloqueado ate revisao" variant="secondary">
                  <Icon className="h-4 w-4" />
                  {label}
                  <Lock className="h-3.5 w-3.5" />
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-matrix-muted">
            {canEditProduct
              ? "Alteracoes salvas aqui ficam apenas no cadastro local ate uma etapa separada de envio."
              : permissionChecked
                ? "Seu usuario pode visualizar este cadastro, mas nao editar produtos."
                : "Verificando permissoes..."}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {editing ? (
              <>
                <Button disabled={saving} onClick={cancelEdit} type="button" variant="secondary">
                  Cancelar
                </Button>
                <Button disabled={saving} onClick={requestSave} type="button">
                  Salvar alteracoes
                </Button>
              </>
            ) : (
              <>
                {canEditProduct ? (
                  <Button
                    onClick={() => {
                      setForm(productFormFromProduct(product));
                      setEditing(true);
                      setFeedback(null);
                      setError(null);
                    }}
                    type="button"
                  >
                    <Edit3 className="h-4 w-4" />
                    Editar
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={onClose} type="button">Fechar</Button>
              </>
            )}
          </div>
        </div>
      </section>

      {confirmingSave ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 px-4 py-6 backdrop-blur-sm" onClick={() => setConfirmingSave(false)}>
          <div
            className="w-full max-w-lg rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 text-matrix-fg shadow-glow"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-matrix-goldSoft/50 text-matrix-goldDark">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-lg font-bold">Salvar alteracoes do produto?</h4>
                <p className="mt-2 text-sm leading-6 text-matrix-muted">
                  As alteracoes serao salvas no cadastro local do Matrix. O envio para Bling ou Mercado Livre deve ser feito em uma etapa separada com confirmacao.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button disabled={saving} onClick={() => setConfirmingSave(false)} type="button" variant="secondary">
                Voltar
              </Button>
              <Button disabled={saving} onClick={() => void confirmSave()} type="button">
                {saving ? "Salvando..." : "Confirmar salvamento local"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
