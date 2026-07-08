"use client";

/* eslint-disable @next/next/no-img-element */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  categoryName?: string | null;
  categoryPath?: string | null;
  attributes: Array<{
    id: string | null;
    name: string;
    value: string;
  }>;
  dimensions: string | null;
  dimensionInfo?: {
    raw: string | null;
    heightCm: string | null;
    widthCm: string | null;
    lengthCm: string | null;
    weightG: string | null;
    hasDimensions: boolean;
  };
  shipping: {
    mode: string | null;
    logisticType: string | null;
    freeShipping: boolean | null;
    localPickUp?: boolean | null;
    tags?: string[];
    costAmount?: number | null;
    currencyId?: string | null;
    costSource?: string | null;
    costUnavailableReason?: string | null;
  } | null;
  fees?: {
    sellingFeeAmount: number | null;
    listingFeeAmount: number | null;
    saleFeeAmount: number | null;
    commissionPercent: number | null;
    currencyId: string | null;
    source: string | null;
    unavailableReason?: string | null;
  };
  localProduct?: {
    found: boolean;
    name: string | null;
    sku: string | null;
    ean: string | null;
    costPrice: number | null;
    salePrice: number | null;
    availableQuantity: number | null;
    matchBy: "sku" | "gtin" | null;
  };
  estimatedMargin?: {
    status: "not_calculated" | "partial";
    label: string;
    price: number | null;
    costPrice: number | null;
    feeAmount: number | null;
    taxStatus: string;
    estimatedProfit: number | null;
    estimatedMarginPercent: number | null;
    missingData: string[];
  };
  quality?: {
    health: number | null;
    statusDetail: string | null;
    subStatus: string[];
    tags: string[];
    warnings: string[];
  };
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
  search?: {
    mode: "global_identifier";
    query: string;
    scannedItemIds: number;
    maxListings: number;
    uniqueKey: "externalId";
  };
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
// Visual-only tax rate for Bling - 262 Moto until account-level fiscal config exists.
const profitMarginTaxRate = 0.085;

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
  const parts = [freightLabel(listing), logisticsLabel(listing)].filter((part) => part && part !== "-");
  return parts.length ? parts.join(" - ") : "-";
}

function freightLabel(listing: MercadoLivreClientListing) {
  if (!listing.shipping) return "-";
  if (listing.shipping.freeShipping === true) return "Frete grátis";
  if (listing.shipping.freeShipping === false) return "Frete pago";
  return "Frete não informado";
}

function logisticsLabel(listing: MercadoLivreClientListing) {
  if (!listing.shipping) return "-";
  const values = [listing.shipping.mode, listing.shipping.logisticType].filter(Boolean).map((value) => String(value).toLowerCase());
  if (values.includes("fulfillment")) return "Full";
  if (values.includes("self_service")) return "Flex";
  if (values.includes("me2")) return "Mercado Envios";
  if (values.includes("cross_docking")) return "Coleta Mercado Envios";
  if (values.includes("drop_off") || values.includes("xd_drop_off")) return "Ponto de postagem";
  if (values.includes("custom")) return "Frete personalizado";
  if (values.includes("not_specified")) return "Frete não informado";
  return values.length ? "Frete não informado" : "-";
}

function technicalLogisticsCode(listing: MercadoLivreClientListing) {
  if (!listing.shipping) return "-";
  return [listing.shipping.mode, listing.shipping.logisticType].filter(Boolean).join(" / ") || "-";
}

function listingsCounterLabel(current: number, total: number | null | undefined) {
  return `${current}/${typeof total === "number" ? total : current} anúncios`;
}

function normalizedSearchQuery(value: string) {
  return value.trim().toLowerCase();
}

function isIdentifierSearchQuery(value: string) {
  const query = value.trim();
  if (!query) return false;
  if (/^ml[a-z]\d+$/i.test(query)) return true;
  if (/^\d{8,14}$/.test(query)) return true;
  if (/^[a-z0-9]+(?:[-_./][a-z0-9]+)+$/i.test(query)) return true;
  if (/^\d{3,}$/.test(query)) return true;
  if (/^[a-z0-9]+$/i.test(query) && /\d/.test(query)) return true;
  return false;
}

function localPickupLabel(listing: MercadoLivreClientListing) {
  if (!listing.shipping || listing.shipping.localPickUp === null || listing.shipping.localPickUp === undefined) return "-";
  return listing.shipping.localPickUp ? "Sim" : "Nao";
}

function categoryLabel(listing: MercadoLivreClientListing) {
  return listing.categoryPath || listing.categoryName || listing.categoryId || "-";
}

function shortCategoryLabel(listing: MercadoLivreClientListing) {
  return listing.categoryName || listing.categoryId || "-";
}

function feeAmount(listing: MercadoLivreClientListing) {
  return listing.fees?.sellingFeeAmount ?? listing.fees?.saleFeeAmount ?? listing.fees?.listingFeeAmount ?? null;
}

function feeLabel(listing: MercadoLivreClientListing) {
  const amount = feeAmount(listing);
  const percentage = listing.fees?.commissionPercent;
  if (typeof amount === "number" && typeof percentage === "number") {
    return `${formatPrice(amount, listing.fees?.currencyId ?? listing.currencyId)} / ${percentage.toFixed(2)}%`;
  }
  if (typeof amount === "number") return formatPrice(amount, listing.fees?.currencyId ?? listing.currencyId);
  if (typeof percentage === "number") return `${percentage.toFixed(2)}%`;
  return "-";
}

function feePercentLabel(listing: MercadoLivreClientListing) {
  return typeof listing.fees?.commissionPercent === "number" ? `${listing.fees.commissionPercent.toFixed(2)}%` : "-";
}

function feeSourceLabel(listing: MercadoLivreClientListing) {
  if (listing.fees?.source === "mercado_livre_listing_prices") return "Mercado Livre listing_prices";
  if (listing.fees?.source) return listing.fees.source;
  return "Nao retornada nesta fase";
}

function feeObservationLabel(listing: MercadoLivreClientListing) {
  if (listing.fees?.unavailableReason) return listing.fees.unavailableReason;
  if (listing.fees?.source === "mercado_livre_listing_prices") return "Tarifa estimada por consulta oficial do Mercado Livre.";
  return "Tarifa nao retornada pela API nesta consulta.";
}

function shippingCostAmount(listing: MercadoLivreClientListing) {
  return typeof listing.shipping?.costAmount === "number" ? listing.shipping.costAmount : null;
}

function shippingCostLabel(listing: MercadoLivreClientListing) {
  const amount = shippingCostAmount(listing);
  if (typeof amount === "number") return formatPrice(amount, listing.shipping?.currencyId ?? listing.currencyId);
  return listing.shipping?.costUnavailableReason ?? "Frete nao retornado";
}

function shippingCostCardLabel(listing: MercadoLivreClientListing) {
  const amount = shippingCostAmount(listing);
  if (typeof amount === "number") {
    const suffix = listing.shipping?.costSource === "buyer_paid_shipping" ? " / nao aplicavel" : "";
    return `Custo vendedor: ${formatPrice(amount, listing.shipping?.currencyId ?? listing.currencyId)}${suffix}`;
  }
  return "Custo nao retornado";
}

function shippingCostSourceLabel(listing: MercadoLivreClientListing) {
  if (listing.shipping?.costSource === "item_shipping") return "Detalhe do anuncio Mercado Livre";
  if (listing.shipping?.costSource === "mercado_livre_shipping_options_free") return "Mercado Livre shipping_options/free";
  if (listing.shipping?.costSource === "buyer_paid_shipping") return "Frete pago pelo comprador";
  return "Nao retornada nesta consulta";
}

function profitMarginTaxLabel() {
  return `${(profitMarginTaxRate * 100).toFixed(1).replace(".", ",")}%`;
}

function buildProfitMargin(listing: MercadoLivreClientListing, priceOverride?: number | null) {
  const price = typeof priceOverride === "number" && Number.isFinite(priceOverride) ? priceOverride : listing.price;
  const costPrice = listing.localProduct?.costPrice ?? null;
  const mlFee = feeAmount(listing);
  const shippingCost = shippingCostAmount(listing);
  const taxAmount = typeof price === "number" ? price * profitMarginTaxRate : null;
  const missingData: string[] = [];

  if (typeof price !== "number") missingData.push("Preco");
  if (typeof costPrice !== "number") missingData.push("Custo local");
  if (typeof mlFee !== "number") missingData.push("Tarifa ML");
  if (typeof shippingCost !== "number") missingData.push("Frete nao retornado");
  if (typeof taxAmount !== "number") missingData.push("Imposto");

  const profit =
    typeof price === "number"
      ? price - (costPrice ?? 0) - (mlFee ?? 0) - (shippingCost ?? 0) - (taxAmount ?? 0)
      : null;
  const percent = typeof profit === "number" && typeof price === "number" && price > 0 ? (profit / price) * 100 : null;

  return {
    status: missingData.length ? "partial" : "complete",
    price,
    costPrice,
    mlFee,
    shippingCost,
    taxRate: profitMarginTaxRate,
    taxAmount,
    profit,
    percent,
    missingData
  };
}

function profitMarginStatusLabel(listing: MercadoLivreClientListing) {
  return buildProfitMargin(listing).status === "complete" ? "Completa" : "Parcial";
}

function profitMarginLabel(listing: MercadoLivreClientListing) {
  const margin = buildProfitMargin(listing);
  if (typeof margin.profit !== "number") return margin.status === "complete" ? "Completa" : "Parcial";
  if (margin.status === "complete" && typeof margin.percent === "number") {
    return `Completa ${formatPrice(margin.profit, listing.currencyId)} (${margin.percent.toFixed(2)}%)`;
  }
  return `Parcial ${formatPrice(margin.profit, listing.currencyId)}`;
}

function profitMarginPercentLabel(listing: MercadoLivreClientListing) {
  const percent = buildProfitMargin(listing).percent;
  return typeof percent === "number" ? `${percent.toFixed(2)}%` : "-";
}

function profitMarginResultLabel(listing: MercadoLivreClientListing) {
  return formatPrice(buildProfitMargin(listing).profit, listing.currencyId);
}

function profitMarginMissingDataLabel(listing: MercadoLivreClientListing) {
  const missingData = buildProfitMargin(listing).missingData;
  return missingData.length ? missingData.join(", ") : "-";
}

function profitMarginTaxAmountLabel(listing: MercadoLivreClientListing) {
  return formatPrice(buildProfitMargin(listing).taxAmount, listing.currencyId);
}

function dimensionsLabel(listing: MercadoLivreClientListing) {
  if (listing.dimensionInfo?.hasDimensions) return listing.dimensionInfo.raw || listing.dimensions || "OK";
  return "-";
}

function dimensionsChipLabel(listing: MercadoLivreClientListing) {
  return listing.dimensionInfo?.hasDimensions ? "Dimensoes OK" : "Dimensoes pendente";
}

function localProductLabel(listing: MercadoLivreClientListing) {
  if (!listing.localProduct?.found) return "Sem vinculo local";
  return listing.localProduct.matchBy === "gtin" ? "Vinculo por GTIN" : "Vinculo por SKU";
}

function qualitySummary(listing: MercadoLivreClientListing) {
  const quality = listing.quality;
  if (quality?.warnings?.length) return quality.warnings.join(" | ");
  if (quality?.statusDetail) return quality.statusDetail;
  if (quality?.subStatus?.length) return quality.subStatus.join(", ");
  if (typeof listing.health === "number") return qualityLabel(listing.health);
  return "Sem dados de pendencia nesta fase.";
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
      title="Indicador visual"
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
      <p className={strong ? "mt-1 whitespace-nowrap text-lg font-bold text-matrix-fg" : "mt-1 whitespace-nowrap text-sm font-semibold text-matrix-fg"}>{value}</p>
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
    <Button className="min-h-8 w-full justify-between px-2 py-1 text-xs" disabled title="Em breve" type="button" variant="secondary">
      <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {children}
      </span>
      {chevron ? <ChevronDown className="h-3.5 w-3.5" /> : <Badge tone="muted">Em breve</Badge>}
    </Button>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-3">
      <h4 className="mb-3 font-semibold text-matrix-fg">{title}</h4>
      {children}
    </section>
  );
}

export function MercadoLivreMarketplacePage() {
  const [account, setAccount] = useState<MercadoLivreClientAccount | null>(null);
  const [listingsPayload, setListingsPayload] = useState<MercadoLivreListingsPayload | null>(null);
  const [globalSearchPayload, setGlobalSearchPayload] = useState<MercadoLivreListingsPayload | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState("");
  const globalSearchCacheRef = useRef(new Map<string, MercadoLivreListingsPayload>());
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
  const [calculatorListing, setCalculatorListing] = useState<MercadoLivreClientListing | null>(null);
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
  const normalizedQuery = normalizedSearchQuery(query);
  const globalIdentifierSearchActive = isIdentifierSearchQuery(query);
  const activeListingsPayload = globalIdentifierSearchActive ? globalSearchPayload : listingsPayload;
  const listings = useMemo(() => activeListingsPayload?.listings ?? [], [activeListingsPayload?.listings]);
  const kpis = activeListingsPayload?.kpis ?? { active: 0, paused: 0, errors: 0, withoutStock: 0, sales: 0, visits: 0 };
  const paging = activeListingsPayload?.paging;
  const totalAvailable = activeListingsPayload?.totalAvailable ?? paging?.total ?? listingsPayload?.totalAvailable ?? null;
  const currentPage = paging?.page ?? Math.floor(pageOffset / pageSize) + 1;
  const totalPages = typeof totalAvailable === "number" ? Math.max(1, Math.ceil(totalAvailable / pageSize)) : currentPage;
  const hasPreviousPage = globalIdentifierSearchActive ? false : (paging?.hasPrevious ?? pageOffset > 0);
  const hasNextPage = globalIdentifierSearchActive ? false : (paging?.hasNext ?? (typeof totalAvailable === "number" ? pageOffset + pageSize < totalAvailable : false));

  useEffect(() => {
    if (!globalIdentifierSearchActive || !hasClientConnection || !normalizedQuery) {
      setGlobalSearchPayload(null);
      setGlobalSearchLoading(false);
      setGlobalSearchError("");
      return;
    }

    const cachedPayload = globalSearchCacheRef.current.get(normalizedQuery);
    if (cachedPayload) {
      setGlobalSearchPayload(cachedPayload);
      setGlobalSearchLoading(false);
      setGlobalSearchError("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGlobalSearchLoading(true);
      setGlobalSearchError("");
      try {
        const response = await fetch(`/api/marketplaces/mercado-livre/client/listings?query=${encodeURIComponent(normalizedQuery)}&maxListings=500`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Nao foi possivel buscar anuncios Mercado Livre.");
        }
        const typedPayload = payload as MercadoLivreListingsPayload;
        globalSearchCacheRef.current.set(normalizedQuery, typedPayload);
        setGlobalSearchPayload(typedPayload);
        setGlobalSearchError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setGlobalSearchPayload(null);
        setGlobalSearchError(error instanceof Error ? error.message : "Nao foi possivel buscar anuncios Mercado Livre.");
      } finally {
        if (!controller.signal.aborted) setGlobalSearchLoading(false);
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [globalIdentifierSearchActive, hasClientConnection, normalizedQuery]);

  const filteredListings = useMemo(() => {
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
  }, [listings, normalizedQuery, quickFilter, statusFilter, stockFilter, typeFilter]);

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
      globalSearchCacheRef.current.clear();
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
                  Esta area gerencia anuncios reais do cliente. O Cadastro Inteligente usa uma busca separada do sistema.
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
              <p>Cadastro Inteligente: consulta catalogos e sugestoes com o app separado do sistema.</p>
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
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">Conta conectada</Badge>
                  <Badge tone="success">Integrado</Badge>
                </div>
                <h2 className="mt-2 text-xl font-bold text-matrix-fg">{account?.accountName ?? "Mercado Livre"}</h2>
                <p className="mt-2 max-w-2xl text-sm text-matrix-muted">
                  Conta pronta para sincronizar e visualizar anuncios do Mercado Livre.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
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
                    {listingsCounterLabel(filteredListings.length, totalAvailable ?? listings.length)}
                  </p>
                  {globalIdentifierSearchActive ? (
                    <p className="text-xs text-matrix-gold">
                      {globalSearchLoading
                        ? `Buscando ${query.trim()} em todos os anuncios da conta...`
                        : `${filteredListings.length} anuncio(s) encontrado(s) para ${query.trim()}. Chave unica: ID ML.`}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-matrix-muted">
                <span>{globalIdentifierSearchActive ? "Busca global" : `Pagina ${currentPage} de ${totalPages}`}</span>
                <select
                  className="rounded-md border border-matrix-border bg-matrix-panel px-2 py-1.5 text-matrix-fg outline-none"
                  disabled={syncing || globalIdentifierSearchActive}
                  onChange={(event) => changePageSize(Number(event.target.value))}
                  value={pageSize}
                >
                  {pageSizeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} por pagina
                    </option>
                  ))}
                </select>
                <Button className="min-h-8 px-2 py-1 text-xs" disabled={syncing || globalIdentifierSearchActive || !hasPreviousPage} onClick={() => void syncListings({ offset: Math.max(0, pageOffset - pageSize), limit: pageSize })} type="button" variant="secondary">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </Button>
                <Button className="min-h-8 px-2 py-1 text-xs" disabled={syncing || globalIdentifierSearchActive || !hasNextPage} onClick={() => void syncListings({ offset: pageOffset + pageSize, limit: pageSize })} type="button" variant="secondary">
                  Proxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {globalSearchError ? (
              <div className="mb-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {globalSearchError}
              </div>
            ) : null}

            {activeListingsPayload?.warnings?.length ? (
              <div className="mb-3 rounded-md border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
                {activeListingsPayload.warnings.slice(0, 3).map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3">
              {filteredListings.length ? (
                filteredListings.map((listing) => (
                  <article
                    key={listing.externalId}
                    className="grid gap-3 rounded-md border border-matrix-border bg-matrix-panel/78 p-3 transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/12 xl:grid-cols-[112px_minmax(0,0.9fr)_minmax(400px,480px)_260px] 2xl:grid-cols-[112px_minmax(0,1fr)_minmax(460px,540px)_280px]"
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
                        <Badge tone={listing.localProduct?.found ? "success" : "muted"}>{localProductLabel(listing)}</Badge>
                        <Badge tone={buildProfitMargin(listing).status === "complete" ? "success" : "info"}>{profitMarginStatusLabel(listing)}</Badge>
                      </div>
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <ListingMetaItem label="ID ML" value={listing.externalId} mono />
                        <ListingMetaItem label="SKU" value={fieldValue(listing.sku)} />
                        <ListingMetaItem label="GTIN" value={fieldValue(listing.gtin)} />
                        <ListingMetaItem label="Categoria" value={shortCategoryLabel(listing)} />
                        <ListingMetaItem label="Atualizado" value={formatDate(listing.updatedAt)} />
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ListingInfoChip icon={SlidersHorizontal} label="F. Tecnica" muted={!listing.attributes.length} />
                        <ListingInfoChip icon={FileText} label="Descricao" muted />
                        <ListingInfoChip icon={Ruler} label={dimensionsChipLabel(listing)} muted={!listing.dimensionInfo?.hasDimensions} />
                        <ListingInfoChip icon={ImageIcon} label={`Fotos (${listingPicturesCount(listing)})`} muted={listingPicturesCount(listing) === 0} />
                        <ListingInfoChip icon={Boxes} label="Preco Atacado" muted />
                        <ListingInfoChip icon={Factory} label="Fabricacao" muted />
                      </div>
                    </div>

                    <div className="grid min-w-0 gap-3 border-matrix-border xl:border-l xl:px-4">
                      <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                        <MetricBox label="Preco" value={formatPrice(listing.price, listing.currencyId)} strong />
                        <MetricBox label="Tarifa ML" value={feeLabel(listing)} />
                        <MetricBox label="Estoque" value={fieldValue(listing.availableQuantity)} strong />
                        <MetricBox label="Vendidos" value={fieldValue(listing.soldQuantity)} />
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="rounded-md border border-matrix-border bg-matrix-panel2/55 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">Frete / logística</p>
                          <p className="mt-1 break-words text-xs font-semibold leading-5 text-matrix-fg">{shippingLabel(listing)}</p>
                          <p className="mt-1 text-[11px] leading-4 text-matrix-muted">{shippingCostCardLabel(listing)}</p>
                        </div>
                        <div className="rounded-md border border-matrix-border bg-matrix-panel2/55 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">Margem de lucro</p>
                              <p className="mt-1 whitespace-nowrap text-xs font-semibold leading-5 text-matrix-fg">{profitMarginLabel(listing)}</p>
                            </div>
                            <Button
                              className="min-h-7 shrink-0 px-2 py-1 text-[11px]"
                              type="button"
                              variant="ghost"
                              onClick={() => setCalculatorListing(listing)}
                            >
                              <BarChart3 className="h-3.5 w-3.5" />
                              Calculadora
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid min-w-0 gap-2 border-matrix-border xl:border-l xl:pl-4">
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
                      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_36px] gap-2">
                        <Button type="button" variant="secondary" className="min-h-8 justify-center whitespace-nowrap px-2 py-1 text-xs" onClick={() => setSelectedListing(listing)}>
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-8 justify-center whitespace-nowrap px-2 py-1 text-xs"
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
                    <h4 className="mt-3 font-semibold text-matrix-fg">
                      {globalSearchLoading
                        ? "Buscando anuncios na conta Mercado Livre..."
                        : listings.length
                          ? "Nenhum anuncio corresponde aos filtros."
                          : "Sincronize os anuncios reais da conta conectada."}
                    </h4>
                    <p className="mt-2 text-sm text-matrix-muted">
                      {globalSearchLoading
                        ? "A busca por identificador varre os anuncios em leitura e preserva itens diferentes pelo ID ML."
                        : listings.length
                        ? "Ajuste busca, abas ou filtros avancados para visualizar outros anuncios carregados."
                        : "Clique em Sincronizar anuncios para carregar a conta conectada."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden">
              <span>Ultima sincronizacao: {formatDate(listingsPayload?.lastSyncedAt ?? account?.lastSyncAt ?? null)}</span>
              {globalIdentifierSearchActive ? (
                <span>
                  {filteredListings.length} resultado(s) globais · {globalSearchPayload?.search?.scannedItemIds ?? 0} ID(s) analisado(s) · chave unica ID ML
                </span>
              ) : (
                <span>
                  {filteredListings.length} visiveis nesta pagina · offset {paging?.offset ?? pageOffset} · {pageSize} por pagina
                </span>
              )}
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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Anuncio Mercado Livre</p>
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

                <DetailSection title="Resumo">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <DetailItem label="ID ML" value={selectedListing.externalId} mono />
                    <DetailItem label="SKU" value={fieldValue(selectedListing.sku)} />
                    <DetailItem label="GTIN" value={fieldValue(selectedListing.gtin)} />
                    <DetailItem label="Status" value={statusLabel(selectedListing.status)} />
                    <DetailItem label="Tipo" value={selectedListing.listingTypeLabel} />
                    <DetailItem label="Categoria" value={categoryLabel(selectedListing)} />
                    <DetailItem label="Criado em" value={formatDate(selectedListing.dateCreated)} />
                    <DetailItem label="Atualizado no ML" value={formatDate(selectedListing.updatedAt)} />
                    <DetailItem label="Sincronizado em" value={formatDate(selectedListing.lastSyncAt)} />
                  </dl>
                </DetailSection>

                <DetailSection title="Preco e vendas">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <DetailItem label="Preco" value={formatPrice(selectedListing.price, selectedListing.currencyId)} />
                    <DetailItem label="Tarifa ML" value={feeLabel(selectedListing)} />
                    <DetailItem label="Tarifa %" value={feePercentLabel(selectedListing)} />
                    <DetailItem label="Estoque ML" value={fieldValue(selectedListing.availableQuantity)} />
                    <DetailItem label="Vendidos" value={fieldValue(selectedListing.soldQuantity)} />
                    <DetailItem label="Visitas" value={fieldValue(selectedListing.visits)} />
                    <DetailItem label="Moeda" value={fieldValue(selectedListing.currencyId)} />
                    <DetailItem label="Fonte tarifa" value={feeSourceLabel(selectedListing)} />
                    <DetailItem label="Observacao tarifa" value={feeObservationLabel(selectedListing)} />
                  </dl>
                </DetailSection>

                <DetailSection title="Frete e logistica">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <DetailItem label="Resumo" value={shippingLabel(selectedListing)} />
                    <DetailItem label="Frete" value={freightLabel(selectedListing)} />
                    <DetailItem label="Logistica" value={logisticsLabel(selectedListing)} />
                    <DetailItem label="Código logístico" value={technicalLogisticsCode(selectedListing)} />
                    <DetailItem label="Custo frete vendedor" value={shippingCostLabel(selectedListing)} />
                    <DetailItem label="Fonte frete" value={shippingCostSourceLabel(selectedListing)} />
                    <DetailItem label="Retirada local" value={localPickupLabel(selectedListing)} />
                    <DetailItem label="Tags envio" value={selectedListing.shipping?.tags?.length ? selectedListing.shipping.tags.join(", ") : "-"} />
                  </dl>
                </DetailSection>

                <DetailSection title="Dimensoes">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <DetailItem label="Dimensoes brutas" value={dimensionsLabel(selectedListing)} />
                    <DetailItem label="Altura" value={fieldValue(selectedListing.dimensionInfo?.heightCm)} />
                    <DetailItem label="Largura" value={fieldValue(selectedListing.dimensionInfo?.widthCm)} />
                    <DetailItem label="Comprimento" value={fieldValue(selectedListing.dimensionInfo?.lengthCm)} />
                    <DetailItem label="Peso" value={fieldValue(selectedListing.dimensionInfo?.weightG)} />
                  </dl>
                </DetailSection>

                <DetailSection title="Categoria e atributos">
                  <dl className="mb-3 grid gap-3 text-sm sm:grid-cols-2">
                    <DetailItem label="Categoria" value={categoryLabel(selectedListing)} />
                    <DetailItem label="Categoria ID" value={fieldValue(selectedListing.categoryId)} />
                  </dl>
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
                </DetailSection>

                <DetailSection title="Produto local relacionado">
                  {selectedListing.localProduct?.found ? (
                    <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                      <DetailItem label="Produto local" value={fieldValue(selectedListing.localProduct.name)} />
                      <DetailItem label="Match" value={localProductLabel(selectedListing)} />
                      <DetailItem label="SKU local" value={fieldValue(selectedListing.localProduct.sku)} />
                      <DetailItem label="EAN local" value={fieldValue(selectedListing.localProduct.ean)} />
                      <DetailItem label="Custo local" value={formatPrice(selectedListing.localProduct.costPrice, selectedListing.currencyId)} />
                      <DetailItem label="Preco local" value={formatPrice(selectedListing.localProduct.salePrice, selectedListing.currencyId)} />
                      <DetailItem label="Estoque local" value={fieldValue(selectedListing.localProduct.availableQuantity)} />
                    </dl>
                  ) : (
                    <p className="text-sm text-matrix-muted">Sem vinculo local por SKU/GTIN nesta consulta.</p>
                  )}
                </DetailSection>

                <DetailSection title="Margem de lucro">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <DetailItem label="Preco" value={formatPrice(selectedListing.price, selectedListing.currencyId)} />
                    <DetailItem label="Custo local" value={formatPrice(selectedListing.localProduct?.costPrice ?? null, selectedListing.currencyId)} />
                    <DetailItem label="Tarifa ML" value={formatPrice(feeAmount(selectedListing), selectedListing.currencyId)} />
                    <DetailItem label="Frete" value={shippingCostLabel(selectedListing)} />
                    <DetailItem label="Imposto %" value={profitMarginTaxLabel()} />
                    <DetailItem label="Imposto R$" value={profitMarginTaxAmountLabel(selectedListing)} />
                    <DetailItem label="Margem R$" value={profitMarginResultLabel(selectedListing)} />
                    <DetailItem label="Margem %" value={profitMarginPercentLabel(selectedListing)} />
                    <DetailItem label="Status" value={profitMarginStatusLabel(selectedListing)} />
                    <DetailItem label="Dados faltantes" value={profitMarginMissingDataLabel(selectedListing)} />
                  </dl>
                  <div className="mt-3">
                    <Button type="button" variant="secondary" onClick={() => setCalculatorListing(selectedListing)}>
                      <BarChart3 className="h-4 w-4" />
                      Calculadora
                    </Button>
                  </div>
                </DetailSection>

                <DetailSection title="Pendencias / qualidade">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <DetailItem label="Qualidade" value={qualityLabel(selectedListing.health)} />
                    <DetailItem label="Resumo" value={qualitySummary(selectedListing)} />
                    <DetailItem label="Tags" value={selectedListing.quality?.tags?.length ? selectedListing.quality.tags.join(", ") : "-"} />
                  </dl>
                </DetailSection>

                <DetailSection title="Seguranca">
                  <p className="text-sm leading-6 text-matrix-muted">
                    Este detalhe e somente leitura. Edicao de preco, estoque, imagens, dimensoes, atributos, pausa, reativacao, clonagem e publicacao continuam bloqueadas nesta fase.
                  </p>
                </DetailSection>
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

      {calculatorListing ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-3 md:items-center">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md border border-matrix-border bg-matrix-panel p-4 shadow-glow">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-matrix-fg">Calculadora de Margem de Lucro</h3>
                <p className="mt-1 text-sm text-matrix-muted">Simulacao visual local. Nenhum dado e salvo ou enviado ao Mercado Livre.</p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setCalculatorListing(null)}>
                <X className="h-4 w-4" />
                Fechar
              </Button>
            </div>

            <DetailSection title="Anuncio">
              <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <DetailItem label="Anuncio" value={calculatorListing.title} />
                <DetailItem label="ID ML" value={calculatorListing.externalId} mono />
                <DetailItem label="SKU" value={fieldValue(calculatorListing.sku)} />
                <DetailItem label="Tipo" value={calculatorListing.listingTypeLabel} />
                <DetailItem label="Status" value={statusLabel(calculatorListing.status)} />
                <DetailItem label="Moeda" value={fieldValue(calculatorListing.currencyId)} />
              </dl>
            </DetailSection>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <DetailSection title="Entradas">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <DetailItem label="Valor de venda" value={formatPrice(calculatorListing.price, calculatorListing.currencyId)} />
                  <DetailItem label="Frete" value={shippingCostLabel(calculatorListing)} />
                  <DetailItem label="Fonte frete" value={shippingCostSourceLabel(calculatorListing)} />
                  <DetailItem label="Custo" value={formatPrice(calculatorListing.localProduct?.costPrice ?? null, calculatorListing.currencyId)} />
                  <DetailItem label="Imposto" value={profitMarginTaxLabel()} />
                  <DetailItem label="Imposto R$" value={profitMarginTaxAmountLabel(calculatorListing)} />
                  <DetailItem label="Tarifa de venda" value={feeLabel(calculatorListing)} />
                </dl>
              </DetailSection>

              <DetailSection title="Resultado">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <DetailItem label="Margem de lucro" value={profitMarginResultLabel(calculatorListing)} />
                  <DetailItem label="Margem %" value={profitMarginPercentLabel(calculatorListing)} />
                  <DetailItem label="Status" value={profitMarginStatusLabel(calculatorListing)} />
                  <DetailItem label="Dados faltantes" value={profitMarginMissingDataLabel(calculatorListing)} />
                </dl>
                <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-xs leading-5 text-matrix-muted">
                  Formula: preco - custo - Tarifa ML - frete - imposto. Aplicar ao anuncio fica bloqueado nesta fase.
                </p>
              </DetailSection>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-matrix-border pt-4">
              <Button type="button" variant="secondary" disabled title="Em breve">
                Aplicar ao anuncio
                <Badge tone="muted">Em breve</Badge>
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCalculatorListing(null)}>
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
