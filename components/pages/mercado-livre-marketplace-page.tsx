"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Factory,
  FileText,
  ImageIcon,
  MessageSquare,
  MoreVertical,
  PackageSearch,
  RefreshCw,
  Ruler,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Trash2,
  X
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProductCopyButton } from "@/components/product-copy-button";
import { Badge, Button, Card, KpiCard } from "@/components/ui";

type MercadoLivreClientAccount = {
  connected: boolean;
  marketplace: "MERCADOLIVRE";
  accountName: string | null;
  status: string;
  sellerId: string | null;
  externalAccountId: string | null;
  siteId: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
};

type MercadoLivreClientListing = {
  externalId: string;
  itemId: string;
  title: string;
  thumbnail: string | null;
  pictures: Array<{
    id: string | null;
    url: string;
  }>;
  sellerSku: string | null;
  sku: string | null;
  gtin: string | null;
  status: string | null;
  listingTypeId: string | null;
  listingTypeLabel: string;
  price: number | null;
  currencyId: string | null;
  availableQuantity: number | null;
  health: number | null;
  permalink: string | null;
  soldQuantity: number | null;
  visits: number | null;
  categoryId: string | null;
  attributes: Array<{
    id: string | null;
    name: string;
    value: string;
  }>;
  dimensions: string | null;
  shipping: {
    mode: string | null;
    logisticType: string | null;
    freeShipping: boolean | null;
  } | null;
  dateCreated: string | null;
  updatedAt: string | null;
  lastSyncAt: string;
};

type MercadoLivreListingsPayload = {
  connected: boolean;
  account: MercadoLivreClientAccount;
  listings: MercadoLivreClientListing[];
  kpis: {
    active: number;
    paused: number;
    errors: number;
    withoutStock: number;
    sales: number;
    visits: number;
  };
  foundItemIds?: number;
  detailsFetched?: number;
  totalAvailable: number | null;
  paging?: {
    limit: number;
    offset: number;
    page: number;
    pageSize: number;
    total: number | null;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  lastSyncedAt: string | null;
  warnings: string[];
  readOnly: boolean;
  externalWrite: boolean;
};

type QuickFilterValue = "all" | "active" | "paused" | "under_review" | "error" | "without_stock" | "premium" | "classico";

const quickFilters: Array<{ value: QuickFilterValue; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "paused", label: "Pausados" },
  { value: "under_review", label: "Em revisao" },
  { value: "error", label: "Com erro" },
  { value: "without_stock", label: "Sem estoque" },
  { value: "premium", label: "Premium" },
  { value: "classico", label: "Classico" }
];

const statusOptions = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "paused", label: "Pausados" },
  { value: "closed", label: "Finalizados" },
  { value: "under_review", label: "Em revisao" },
  { value: "error", label: "Com erro" }
];

const typeOptions = [
  { value: "all", label: "Todos" },
  { value: "premium", label: "Premium" },
  { value: "classico", label: "Classico" },
  { value: "other", label: "Outros" }
];

const stockOptions = [
  { value: "all", label: "Todos" },
  { value: "with_stock", label: "Com estoque" },
  { value: "without_stock", label: "Sem estoque" }
];

const pageSizeOptions = [25, 50, 100];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}

function formatPrice(value: number | null, currencyId: string | null) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyId || "BRL"
  }).format(value);
}

function statusLabel(value: string | null) {
  if (value === "active") return "Ativo";
  if (value === "paused") return "Pausado";
  if (value === "closed") return "Finalizado";
  if (value === "under_review") return "Em revisao";
  if (value === "inactive") return "Inativo";
  return value || "-";
}

function statusTone(value: string | null) {
  if (value === "active") return "success" as const;
  if (value === "paused" || value === "under_review") return "warning" as const;
  if (value === "closed" || value === "inactive") return "danger" as const;
  return "muted" as const;
}

function qualityLabel(value: number | null) {
  if (typeof value !== "number") return "-";
  return `${Math.round(value * 100)}%`;
}

function connectMercadoLivreClient() {
  window.location.assign("/api/marketplaces/mercado-livre/client/connect");
}

function openExternalListing(permalink: string | null) {
  if (!permalink) return;
  window.open(permalink, "_blank", "noopener,noreferrer");
}

function isPremium(listing: MercadoLivreClientListing) {
  return listing.listingTypeLabel.toLowerCase().includes("premium");
}

function isClassic(listing: MercadoLivreClientListing) {
  return listing.listingTypeLabel.toLowerCase().includes("classico");
}

function isErrorStatus(listing: MercadoLivreClientListing) {
  return listing.status === "under_review" || listing.status === "inactive";
}

function matchesQuickFilter(listing: MercadoLivreClientListing, filter: QuickFilterValue) {
  if (filter === "all") return true;
  if (filter === "active") return listing.status === "active";
  if (filter === "paused") return listing.status === "paused";
  if (filter === "under_review") return listing.status === "under_review";
  if (filter === "error") return isErrorStatus(listing);
  if (filter === "without_stock") return (listing.availableQuantity ?? 0) <= 0;
  if (filter === "premium") return isPremium(listing);
  if (filter === "classico") return isClassic(listing);
  return true;
}

function fieldValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function listingMainImage(listing: MercadoLivreClientListing, index = 0) {
  return listing.pictures?.[index]?.url ?? listing.thumbnail;
}

function shippingLabel(listing: MercadoLivreClientListing) {
  if (!listing.shipping) return "-";
  const parts = [
    listing.shipping.mode,
    listing.shipping.logisticType,
    listing.shipping.freeShipping === true ? "Frete gratis" : listing.shipping.freeShipping === false ? "Frete pago" : null
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "-";
}

function listingPicturesCount(listing: MercadoLivreClientListing) {
  return listing.pictures?.length ?? (listing.thumbnail ? 1 : 0);
}

function ListingMetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">{label}</dt>
      <dd className={`mt-1 truncate text-xs text-matrix-fg ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function ListingInfoChip({
  icon: Icon,
  label,
  muted = false
}: {
  icon: typeof FileText;
  label: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${
        muted
          ? "border-matrix-border bg-matrix-panel2/55 text-matrix-muted"
          : "border-matrix-gold/20 bg-matrix-goldSoft/18 text-matrix-fg"
      }`}
      title="Indicador visual read-only"
    >
      <Icon className="h-3.5 w-3.5 text-matrix-goldDark" />
      {label}
    </span>
  );
}

function MetricBox({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 border-r border-matrix-border/70 pr-3 last:border-r-0 last:pr-0">
      <p className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">{label}</p>
      <p className={strong ? "mt-1 truncate text-lg font-bold text-matrix-fg" : "mt-1 truncate text-sm font-semibold text-matrix-fg"}>{value}</p>
    </div>
  );
}

function ReadOnlyActionButton({
  children,
  icon: Icon,
  chevron = false
}: {
  children: string;
  icon?: typeof FileText;
  chevron?: boolean;
}) {
  return (
    <Button className="min-h-8 justify-between px-2 py-1 text-xs" disabled title="Em breve" type="button" variant="secondary">
      <span className="inline-flex items-center gap-1.5">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {children}
      </span>
      {chevron ? <ChevronDown className="h-3.5 w-3.5" /> : <Badge tone="muted">Em breve</Badge>}
    </Button>
  );
}

export function MercadoLivreMarketplacePage() {
  const [account, setAccount] = useState<MercadoLivreClientAccount | null>(null);
  const [listingsPayload, setListingsPayload] = useState<MercadoLivreListingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilterValue>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [pageSize, setPageSize] = useState(50);
  const [pageOffset, setPageOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedListing, setSelectedListing] = useState<MercadoLivreClientListing | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      try {
        const accountResponse = await fetch("/api/marketplaces/mercado-livre/client/accounts", { cache: "no-store" });
        const accountPayload = accountResponse.ok ? ((await accountResponse.json()) as MercadoLivreClientAccount) : null;
        if (!mounted) return;
        setAccount(accountPayload);
        setLoadError("");

        if (accountPayload?.connected) {
          const listingsResponse = await fetch("/api/marketplaces/mercado-livre/client/listings", { cache: "no-store" });
          const payload = listingsResponse.ok ? ((await listingsResponse.json()) as MercadoLivreListingsPayload) : null;
          if (!mounted) return;
          if (payload) {
            setListingsPayload(payload);
            setAccount(payload.account);
            setPageSize(payload.paging?.pageSize ?? 50);
            setPageOffset(payload.paging?.offset ?? 0);
          }
        }
      } catch {
        if (!mounted) return;
        setAccount(null);
        setLoadError("Nao foi possivel verificar a conexao Mercado Livre.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setSelectedImageIndex(0);
  }, [selectedListing?.externalId]);

  const hasClientConnection = Boolean(account?.connected && account.status === "ACTIVE");
  const listings = useMemo(() => listingsPayload?.listings ?? [], [listingsPayload?.listings]);
  const kpis = listingsPayload?.kpis ?? { active: 0, paused: 0, errors: 0, withoutStock: 0, sales: 0, visits: 0 };
  const paging = listingsPayload?.paging;
  const totalAvailable = listingsPayload?.totalAvailable ?? paging?.total ?? null;
  const currentPage = paging?.page ?? Math.floor(pageOffset / pageSize) + 1;
  const totalPages = typeof totalAvailable === "number" ? Math.max(1, Math.ceil(totalAvailable / pageSize)) : currentPage;
  const hasPreviousPage = paging?.hasPrevious ?? pageOffset > 0;
  const hasNextPage = paging?.hasNext ?? (typeof totalAvailable === "number" ? pageOffset + pageSize < totalAvailable : false);

  const filteredListings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return listings.filter((listing) => {
      const textMatches =
        !normalizedQuery ||
        listing.title.toLowerCase().includes(normalizedQuery) ||
        listing.externalId.toLowerCase().includes(normalizedQuery) ||
        (listing.sku ?? "").toLowerCase().includes(normalizedQuery) ||
        (listing.gtin ?? "").toLowerCase().includes(normalizedQuery);
      const statusMatches =
        statusFilter === "all" ||
        listing.status === statusFilter ||
        (statusFilter === "error" && isErrorStatus(listing));
      const typeMatches =
        typeFilter === "all" ||
        (typeFilter === "premium" && isPremium(listing)) ||
        (typeFilter === "classico" && isClassic(listing)) ||
        (typeFilter === "other" && !isPremium(listing) && !isClassic(listing));
      const stockMatches =
        stockFilter === "all" ||
        (stockFilter === "with_stock" && (listing.availableQuantity ?? 0) > 0) ||
        (stockFilter === "without_stock" && (listing.availableQuantity ?? 0) <= 0);

      return textMatches && statusMatches && typeMatches && stockMatches && matchesQuickFilter(listing, quickFilter);
    });
  }, [listings, query, quickFilter, statusFilter, stockFilter, typeFilter]);

  async function syncListings(options?: { offset?: number; limit?: number }) {
    const targetLimit = options?.limit ?? pageSize;
    const targetOffset = options?.offset ?? pageOffset;
    setSyncing(true);
    setLoadError("");
    try {
      const response = await fetch("/api/marketplaces/mercado-livre/client/listings/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: targetLimit, offset: targetOffset })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel sincronizar anuncios Mercado Livre.");
      }
      const typedPayload = payload as MercadoLivreListingsPayload;
      setListingsPayload(typedPayload);
      setAccount(typedPayload.account);
      setPageSize(typedPayload.paging?.pageSize ?? targetLimit);
      setPageOffset(typedPayload.paging?.offset ?? targetOffset);
      setSelectedIds(new Set());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nao foi possivel sincronizar anuncios Mercado Livre.");
    } finally {
      setSyncing(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changePageSize(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPageOffset(0);
    void syncListings({ offset: 0, limit: nextPageSize });
  }

  const selectedListingIds = selectedIds.size;
  const hasActiveFilters =
    query.trim() !== "" ||
    quickFilter !== "all" ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    stockFilter !== "all";

  function clearListingFilters() {
    setQuery("");
    setQuickFilter("all");
    setStatusFilter("all");
    setTypeFilter("all");
    setStockFilter("all");
  }

  return (
    <AppShell>
      <div className="mb-5 flex flex-col gap-3 rounded-md border border-matrix-border bg-matrix-panel/74 px-4 py-4 shadow-glow lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-normal text-matrix-fg sm:text-4xl">Mercado Livre</h1>
            <Badge tone={hasClientConnection ? "success" : "muted"}>{hasClientConnection ? "Conta conectada" : "Configuracao ausente"}</Badge>
            <Badge tone="muted">Read-only</Badge>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-matrix-muted">
            Gestao de anuncios, precos, estoque e pedidos do Mercado Livre.
          </p>
        </div>
        <Button type="button" onClick={connectMercadoLivreClient}>
          <ExternalLink className="h-4 w-4" />
          Conectar conta Mercado Livre
        </Button>
      </div>

      {loadError ? <p className="mb-4 rounded-md border border-red-500/25 bg-red-950/20 px-3 py-2 text-sm text-red-200">{loadError}</p> : null}

      {!hasClientConnection ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="border-matrix-gold/40 bg-matrix-panel/82 p-5">
            <div className="grid gap-5 md:grid-cols-[56px_1fr]">
              <div className="grid h-14 w-14 place-items-center rounded-md bg-matrix-goldSoft/55 text-matrix-goldDark">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Conta Mercado Livre ainda nao conectada</p>
                <h2 className="mt-2 text-2xl font-bold text-matrix-fg">Conecte uma conta do cliente para gerenciar anuncios reais.</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-matrix-muted">
                  Esta area gerencia anuncios reais do cliente. O Cadastro Inteligente usa uma busca read-only separada do sistema.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" onClick={connectMercadoLivreClient}>
                    Conectar conta Mercado Livre
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => window.location.assign("/products/cadastro-inteligente")}>
                    Abrir Cadastro Inteligente
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="bg-matrix-panel/82 p-5">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-matrix-goldDark" />
              <h3 className="font-semibold text-matrix-fg">Separacao de seguranca</h3>
            </div>
            <div className="mt-4 grid gap-3 text-sm leading-6 text-matrix-muted">
              <p>Cadastro Inteligente: consulta catalogos e sugestoes com o app read-only do sistema.</p>
              <p>Marketplace Mercado Livre: usa somente MarketplaceConnection do cliente.</p>
              <p>Nenhum anuncio sera publicado ou alterado sem preview e confirmacao.</p>
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid gap-5">
          <Card className="border-matrix-gold/35 bg-matrix-panel/80 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Conta Mercado Livre conectada</p>
                <h2 className="mt-1 text-xl font-bold text-matrix-fg">{account?.accountName ?? "Mercado Livre"}</h2>
                <div className="mt-2 grid gap-1 text-sm text-matrix-muted sm:grid-cols-2 xl:grid-cols-4">
                  <span>Seller ID: {account?.sellerId ?? "-"}</span>
                  <span>Status: {account?.status ?? "-"}</span>
                  <span>Site: {account?.siteId ?? "MLB"}</span>
                  <span>Conectado em: {formatDate(account?.connectedAt ?? null)}</span>
                  <span>Expira em: {formatDate(account?.expiresAt ?? null)}</span>
                  <span>Ultima sincronizacao: {formatDate(listingsPayload?.lastSyncedAt ?? account?.lastSyncAt ?? null)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">Integrado</Badge>
                <Button type="button" variant="secondary" onClick={() => void syncListings({ offset: 0, limit: pageSize })} disabled={syncing}>
                  <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Sincronizando..." : "Sincronizar anuncios"}
                </Button>
              </div>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard label="Ativos" value={String(kpis.active)} hint="Na pagina carregada" tone="success" />
            <KpiCard label="Pausados" value={String(kpis.paused)} hint="Na pagina carregada" tone="warning" />
            <KpiCard label="Com erro" value={String(kpis.errors)} hint="Pendencias na pagina" tone="danger" />
            <KpiCard label="Sem estoque" value={String(kpis.withoutStock)} hint="Na pagina carregada" tone="warning" />
            <KpiCard label="Vendas" value={String(kpis.sales)} hint="sold_quantity da pagina" tone="info" />
            <KpiCard label="Visitas" value={String(kpis.visits)} hint="Nao sincronizado nesta fase" tone="purple" />
          </div>

          <Card className="bg-matrix-panel/82 p-3 md:p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {quickFilters.map((filter) => (
                  <button
                    key={filter.value}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      quickFilter === filter.value
                        ? "border-matrix-gold bg-matrix-gold text-black shadow-gold"
                        : "border-matrix-border bg-matrix-panel2/70 text-matrix-muted hover:border-matrix-gold/55 hover:text-matrix-fg"
                    }`}
                    onClick={() => setQuickFilter(filter.value)}
                    type="button"
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_160px_160px_160px_160px]">
                <label className="min-w-0 text-sm text-matrix-muted">
                  Buscar por titulo, SKU, ID ML ou GTIN
                  <span className="mt-2 flex w-full items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 focus-within:border-matrix-gold/60">
                    <Search className="h-4 w-4 shrink-0 text-matrix-goldDark" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-matrix-fg outline-none"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Digite titulo, SKU, ID ML ou GTIN"
                      value={query}
                    />
                  </span>
                </label>
                <label className="text-sm text-matrix-muted">
                  Status
                  <select className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-matrix-muted">
                  Tipo
                  <select className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
                    {typeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-matrix-muted">
                  Estoque
                  <select className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" onChange={(event) => setStockFilter(event.target.value)} value={stockFilter}>
                    {stockOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <Button
                    className="min-h-10 w-full justify-center px-3 py-2 text-sm"
                    disabled={!hasActiveFilters}
                    onClick={clearListingFilters}
                    type="button"
                    variant="secondary"
                  >
                    <Trash2 className="h-4 w-4" />
                    Limpar filtros
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="bg-matrix-panel/72 p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-matrix-muted">{selectedListingIds} selecionado(s)</span>
              <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {["Nivelar preco", "Nivelar estoque", "Nivelar imagens", "Nivelar dimensoes", "Pausar", "Reativar"].map((action) => (
                  <Button key={action} className="min-h-9 justify-between px-3 py-2 text-xs" disabled title="Em breve" type="button" variant="secondary">
                    {action}
                    <Badge tone="muted">Em breve</Badge>
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="bg-matrix-panel/82 p-4">
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-2">
                <PackageSearch className="h-5 w-5 text-matrix-goldDark" />
                <div>
                  <h3 className="font-semibold text-matrix-fg">Anuncios Mercado Livre</h3>
                  <p className="text-xs text-matrix-muted">
                    {filteredListings.length} de {listings.length} anuncio(s) na pagina {currentPage}
                    {typeof totalAvailable === "number" ? ` · total informado pela API: ${totalAvailable}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-matrix-muted">
                <Badge tone="muted">Read-only</Badge>
                <span>Pagina {currentPage} de {totalPages}</span>
                <select
                  className="rounded-md border border-matrix-border bg-matrix-panel px-2 py-1.5 text-matrix-fg outline-none"
                  disabled={syncing}
                  onChange={(event) => changePageSize(Number(event.target.value))}
                  value={pageSize}
                >
                  {pageSizeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} por pagina
                    </option>
                  ))}
                </select>
                <Button className="min-h-8 px-2 py-1 text-xs" disabled={syncing || !hasPreviousPage} onClick={() => void syncListings({ offset: Math.max(0, pageOffset - pageSize), limit: pageSize })} type="button" variant="secondary">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </Button>
                <Button className="min-h-8 px-2 py-1 text-xs" disabled={syncing || !hasNextPage} onClick={() => void syncListings({ offset: pageOffset + pageSize, limit: pageSize })} type="button" variant="secondary">
                  Proxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {listingsPayload?.warnings?.length ? (
              <div className="mb-3 rounded-md border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
                {listingsPayload.warnings.slice(0, 3).map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3">
              {filteredListings.length ? (
                filteredListings.map((listing) => (
                  <article
                    key={listing.externalId}
                    className="grid gap-3 rounded-md border border-matrix-border bg-matrix-panel/78 p-3 transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/12 xl:grid-cols-[112px_minmax(0,1fr)_minmax(250px,360px)_240px]"
                  >
                    <div className="flex items-start gap-3 xl:gap-2">
                      <label className="pt-1" title="Selecao visual sem acao em massa nesta fase">
                        <input
                          aria-label={`Selecionar anuncio ${listing.externalId}`}
                          checked={selectedIds.has(listing.externalId)}
                          className="h-4 w-4 accent-matrix-gold"
                          onChange={() => toggleSelected(listing.externalId)}
                          type="checkbox"
                        />
                      </label>
                      <div className="shrink-0">
                        {listingMainImage(listing) ? (
                          <img
                            alt={listing.title}
                            className="h-20 w-20 rounded-md border border-matrix-border bg-white object-contain"
                            src={listingMainImage(listing) ?? undefined}
                          />
                        ) : (
                          <div className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-matrix-border text-xs text-matrix-muted">
                            <ImageIcon className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start gap-2 xl:flex-nowrap">
                        <h4 className="min-w-0 flex-1 text-base font-semibold leading-6 text-matrix-fg">{listing.title}</h4>
                        <ProductCopyButton label="Copiar ID ML" text={listing.externalId} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone={statusTone(listing.status)}>{statusLabel(listing.status)}</Badge>
                        <Badge tone={isPremium(listing) ? "success" : isClassic(listing) ? "info" : "muted"}>{listing.listingTypeLabel}</Badge>
                        {(listing.availableQuantity ?? 0) <= 0 ? <Badge tone="warning">Sem estoque</Badge> : null}
                        {!listing.sku ? <Badge tone="warning">Sem SKU</Badge> : null}
                        {!listing.gtin ? <Badge tone="muted">Sem GTIN</Badge> : null}
                        {typeof listing.health !== "number" ? <Badge tone="muted">Qualidade pendente</Badge> : null}
                      </div>
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <ListingMetaItem label="ID ML" value={listing.externalId} mono />
                        <ListingMetaItem label="SKU" value={fieldValue(listing.sku)} />
                        <ListingMetaItem label="GTIN" value={fieldValue(listing.gtin)} />
                        <ListingMetaItem label="Atualizado" value={formatDate(listing.updatedAt)} />
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ListingInfoChip icon={SlidersHorizontal} label="F. Tecnica" muted={!listing.attributes.length} />
                        <ListingInfoChip icon={FileText} label="Descricao" muted />
                        <ListingInfoChip icon={Ruler} label="Dimensoes" muted={!listing.dimensions} />
                        <ListingInfoChip icon={ImageIcon} label={`Fotos (${listingPicturesCount(listing)})`} muted={listingPicturesCount(listing) === 0} />
                        <ListingInfoChip icon={Boxes} label="Preco Atacado" muted />
                        <ListingInfoChip icon={Factory} label="Fabricacao" muted />
                      </div>
                    </div>

                    <div className="grid gap-3 border-matrix-border xl:border-l xl:px-4">
                      <div className="grid grid-cols-3 gap-3">
                        <MetricBox label="Preco" value={formatPrice(listing.price, listing.currencyId)} strong />
                        <MetricBox label="Estoque" value={fieldValue(listing.availableQuantity)} strong />
                        <MetricBox label="Vendidos" value={fieldValue(listing.soldQuantity)} />
                      </div>
                      <div className="rounded-md border border-matrix-border bg-matrix-panel2/55 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">Frete</p>
                        <p className="mt-1 text-xs font-semibold text-matrix-fg">{shippingLabel(listing)}</p>
                      </div>
                    </div>

                    <div className="grid gap-2 border-matrix-border xl:border-l xl:pl-4">
                      <div className="grid grid-cols-2 gap-2">
                        <ReadOnlyActionButton chevron icon={SlidersHorizontal}>
                          Acoes
                        </ReadOnlyActionButton>
                        <ReadOnlyActionButton chevron icon={Copy}>
                          Duplicar
                        </ReadOnlyActionButton>
                        <ReadOnlyActionButton chevron icon={Store}>
                          Lojas
                        </ReadOnlyActionButton>
                        <ReadOnlyActionButton chevron icon={MessageSquare}>
                          Perguntas
                        </ReadOnlyActionButton>
                      </div>
                      <div className="grid grid-cols-[1fr_1fr_36px] gap-2">
                        <Button type="button" variant="secondary" className="min-h-8 px-2 py-1 text-xs" onClick={() => setSelectedListing(listing)}>
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-8 px-2 py-1 text-xs"
                          disabled={!listing.permalink}
                          onClick={() => openExternalListing(listing.permalink)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir anuncio
                        </Button>
                        <Button className="min-h-8 px-2 py-1 text-xs" disabled title="Em breve" type="button" variant="ghost">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-matrix-border bg-matrix-panel2/45 px-4 py-8 text-center">
                  <div className="max-w-lg">
                    <PackageSearch className="mx-auto h-8 w-8 text-matrix-goldDark" />
                    <h4 className="mt-3 font-semibold text-matrix-fg">{listings.length ? "Nenhum anuncio corresponde aos filtros." : "Sincronize os anuncios reais da conta conectada."}</h4>
                    <p className="mt-2 text-sm text-matrix-muted">
                      {listings.length
                        ? "Ajuste busca, abas ou filtros avancados para visualizar outros anuncios carregados."
                        : "A sincronizacao usa apenas endpoints oficiais read-only do Mercado Livre."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t border-matrix-border pt-3 text-xs text-matrix-muted md:flex-row md:items-center md:justify-between">
              <span>Ultima sincronizacao: {formatDate(listingsPayload?.lastSyncedAt ?? account?.lastSyncAt ?? null)}</span>
              <span>
                {filteredListings.length} visiveis nesta pagina · offset {paging?.offset ?? pageOffset} · {pageSize} por pagina
              </span>
            </div>
          </Card>

          <Card className="border-matrix-gold/30 bg-matrix-goldSoft/18 p-4">
            <div className="flex gap-3">
              <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-matrix-goldDark" />
              <p className="text-sm leading-6 text-matrix-muted">
                Esta fase sincroniza anuncios reais em modo read-only usando somente a MarketplaceConnection do cliente. Edicoes de preco, estoque, imagens, dimensoes e status continuam bloqueadas.
              </p>
            </div>
          </Card>
        </div>
      )}

      {loading ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-matrix-muted">
          <CheckCircle2 className="h-4 w-4 text-matrix-goldDark" />
          Verificando conexao Mercado Livre do cliente...
        </p>
      ) : null}

      {selectedListing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 md:items-center">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-md border border-matrix-border bg-matrix-panel p-4 shadow-glow">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Anuncio Mercado Livre read-only</p>
                <h3 className="mt-1 text-xl font-bold text-matrix-fg">{selectedListing.title}</h3>
              </div>
              <Button type="button" variant="ghost" onClick={() => setSelectedListing(null)}>
                <X className="h-4 w-4" />
                Fechar
              </Button>
            </div>

            <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
              <div>
                {listingMainImage(selectedListing, selectedImageIndex) ? (
                  <img
                    alt={selectedListing.title}
                    className="h-72 w-full rounded-md border border-matrix-border bg-white object-contain"
                    src={listingMainImage(selectedListing, selectedImageIndex) ?? undefined}
                  />
                ) : (
                  <div className="grid h-72 place-items-center rounded-md border border-dashed border-matrix-border text-sm text-matrix-muted">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
                {(selectedListing.pictures ?? []).length > 1 ? (
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {(selectedListing.pictures ?? []).slice(0, 10).map((picture, index) => (
                      <button
                        key={`${picture.url}-${index}`}
                        className={`rounded-md border bg-white p-1 ${selectedImageIndex === index ? "border-matrix-gold shadow-gold" : "border-matrix-border"}`}
                        onClick={() => setSelectedImageIndex(index)}
                        type="button"
                      >
                        <img alt="" className="h-12 w-full object-contain" src={picture.url} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone(selectedListing.status)}>{statusLabel(selectedListing.status)}</Badge>
                  <Badge tone={isPremium(selectedListing) ? "success" : isClassic(selectedListing) ? "info" : "muted"}>{selectedListing.listingTypeLabel}</Badge>
                  <Badge tone="muted">Sem edicao nesta fase</Badge>
                </div>

                <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                  <DetailItem label="ID ML" value={selectedListing.externalId} mono />
                  <DetailItem label="SKU" value={fieldValue(selectedListing.sku)} />
                  <DetailItem label="GTIN" value={fieldValue(selectedListing.gtin)} />
                  <DetailItem label="Status" value={statusLabel(selectedListing.status)} />
                  <DetailItem label="Tipo" value={selectedListing.listingTypeLabel} />
                  <DetailItem label="Preco" value={formatPrice(selectedListing.price, selectedListing.currencyId)} />
                  <DetailItem label="Estoque" value={fieldValue(selectedListing.availableQuantity)} />
                  <DetailItem label="Vendidos" value={fieldValue(selectedListing.soldQuantity)} />
                  <DetailItem label="Visitas" value={fieldValue(selectedListing.visits)} />
                  <DetailItem label="Categoria" value={fieldValue(selectedListing.categoryId)} />
                  <DetailItem label="Qualidade" value={qualityLabel(selectedListing.health)} />
                  <DetailItem label="Frete" value={shippingLabel(selectedListing)} />
                  <DetailItem label="Dimensoes" value={fieldValue(selectedListing.dimensions)} />
                  <DetailItem label="Criado em" value={formatDate(selectedListing.dateCreated)} />
                  <DetailItem label="Atualizado no ML" value={formatDate(selectedListing.updatedAt)} />
                  <DetailItem label="Sincronizado em" value={formatDate(selectedListing.lastSyncAt)} />
                </dl>

                <div className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-matrix-goldDark" />
                    <h4 className="font-semibold text-matrix-fg">Atributos principais</h4>
                  </div>
                  {selectedListing.attributes.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedListing.attributes.slice(0, 18).map((attribute) => (
                        <span key={`${attribute.id ?? attribute.name}-${attribute.value}`} className="rounded-md border border-matrix-border bg-matrix-panel px-2 py-1 text-xs text-matrix-muted">
                          <strong className="text-matrix-fg">{attribute.name}:</strong> {attribute.value}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-matrix-muted">A API nao retornou atributos detalhados para este anuncio.</p>
                  )}
                </div>

                <div className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-matrix-goldDark" />
                    <h4 className="font-semibold text-matrix-fg">Operacao segura</h4>
                  </div>
                  <p className="text-sm leading-6 text-matrix-muted">
                    Este detalhe e somente leitura. Edicao de preco, estoque, imagens, dimensoes, atributos, pausa, reativacao e publicacao continuam bloqueadas nesta fase.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-matrix-border pt-4">
              <Button type="button" variant="secondary" disabled={!selectedListing.permalink} onClick={() => openExternalListing(selectedListing.permalink)}>
                <ExternalLink className="h-4 w-4" />
                Abrir no Mercado Livre
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelectedListing(null)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-matrix-muted">{label}</dt>
      <dd className={mono ? "font-mono text-matrix-fg" : "text-matrix-fg"}>{value}</dd>
    </div>
  );
}
