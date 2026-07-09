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
    size?: string | null;
    maxSize?: string | null;
    quality?: string | null;
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
    paidBy?: "seller" | "buyer" | "unknown";
    displayMode?: "free_shipping" | "paid_shipping" | "unknown";
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

type ListingGalleryPicture = {
  id: string | null;
  url: string;
  size?: string | null;
  maxSize?: string | null;
  quality?: string | null;
  isThumbnailFallback?: boolean;
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
    mode: "global_identifier" | "filtered_before_pagination";
    query: string;
    scannedItemIds: number;
    matchedItemIds?: number;
    maxListings: number;
    sourceTotalAvailable?: number | null;
    uniqueKey: "externalId";
    filters?: {
      status: string;
      listingType: string;
      stock: string;
    };
  };
  readOnly: boolean;
  externalWrite: boolean;
};

type TechnicalSheetAttributeStatus = "filled" | "missing_required" | "optional" | "not_applicable_allowed";

type TechnicalSheetAttribute = {
  id: string;
  name: string;
  section: "Caracteristicas principais" | "Registros de produtos" | "Legal" | "Precos" | "Outros";
  groupId: string | null;
  groupName: string | null;
  valueType: string | null;
  currentValue: string | null;
  status: TechnicalSheetAttributeStatus;
  filled: boolean;
  required: boolean;
  allowsNotApplicable: boolean;
  tags: string[];
  allowedValues: Array<{
    id: string | null;
    name: string;
  }>;
};

type TechnicalSheetPayload = {
  readOnly: true;
  externalWrite: false;
  listing: Pick<
    MercadoLivreClientListing,
    | "externalId"
    | "itemId"
    | "title"
    | "thumbnail"
    | "pictures"
    | "sku"
    | "gtin"
    | "price"
    | "currencyId"
    | "categoryId"
    | "categoryName"
    | "categoryPath"
    | "attributes"
    | "dimensions"
    | "dimensionInfo"
  >;
  category: {
    id: string | null;
    name: string | null;
    path: string | null;
  };
  attributes: TechnicalSheetAttribute[];
  filledAttributes: TechnicalSheetAttribute[];
  missingRequiredAttributes: TechnicalSheetAttribute[];
  optionalAttributes: TechnicalSheetAttribute[];
  allowedValues: Array<{
    attributeId: string;
    attributeName: string;
    values: Array<{
      id: string | null;
      name: string;
    }>;
  }>;
  sections: Array<{
    name: TechnicalSheetAttribute["section"];
    attributes: TechnicalSheetAttribute[];
  }>;
  warnings: string[];
};

type TechnicalSheetSection = TechnicalSheetPayload["sections"][number];
type TechnicalSheetDisplayAttribute = TechnicalSheetAttribute & {
  originalSection?: string;
  sortIndex?: number;
  suspectedSkuValue?: boolean;
};
type TechnicalSheetDisplaySection = {
  name: string;
  attributes: TechnicalSheetDisplayAttribute[];
};
type TechnicalSheetMainField = {
  key: string;
  label: string;
  value: string;
  attribute?: TechnicalSheetDisplayAttribute;
  attributeIds: string[];
};

type MercadoLivreDimensionsPayload = {
  externalWrite: boolean;
  canEdit: boolean;
  message?: string;
  changedFields?: string[];
  listing: {
    externalId: string;
    itemId: string;
    title: string;
    thumbnail: string | null;
    sellerSku: string | null;
    sku: string | null;
    price: number | null;
    currencyId: string | null;
    categoryId: string | null;
    shipping: {
      mode: string | null;
      logisticType: string | null;
      freeShipping: boolean | null;
      localPickUp?: boolean | null;
      tags?: string[];
    } | null;
  };
  dimensions: {
    raw: string | null;
    widthCm: number | null;
    heightCm: number | null;
    lengthCm: number | null;
    weightGrams: number | null;
    hasDimensions: boolean;
    packageMode: "manufacturer" | "custom";
  };
  packaging?: {
    mode: "manufacturer" | "custom";
    label: string;
  };
  warning: string;
};

type DimensionsFormState = {
  widthCm: string;
  heightCm: string;
  lengthCm: string;
  weightGrams: string;
  packageMode: "manufacturer" | "custom";
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

const mercadoLivreLocalReadOnlyActions = new Set([
  "technicalSheet",
  "description",
  "pictures",
  "dimensions",
  "details",
  "filters",
  "pagination",
  "search"
]);

const mercadoLivreExternalWriteActions = new Set([
  "levelPrice",
  "levelStock",
  "levelPictures",
  "levelDimensions",
  "pause",
  "reactivate",
  "publish",
  "clone",
  "addPicture",
  "deletePicture",
  "saveDimensions"
]);

const mercadoLivreTechnicalFields = new Set([
  "readOnly",
  "sellerId",
  "technicalStatus",
  "siteId",
  "connectedAt",
  "expiresAt",
  "lastSyncAt",
  "listingPricesSource",
  "logisticCode",
  "technicalTags",
  "shippingSource",
  "securityBlock",
  "listingDiagnostics"
]);

function isWriteAction(action: string) {
  return mercadoLivreExternalWriteActions.has(action);
}

function isLocalReadOnlyAction(action: string) {
  return mercadoLivreLocalReadOnlyActions.has(action);
}

function shouldShowTechnicalField(field: string, showTechnicalDetails: boolean) {
  return showTechnicalDetails && mercadoLivreTechnicalFields.has(field);
}

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

function filteredCounterSubject(input: { status: string; type: string; stock: string; query: string }) {
  const activeStructuredFilters = [input.status !== "all", input.type !== "all", input.stock !== "all"].filter(Boolean).length;
  if (activeStructuredFilters > 1) return "anúncios filtrados";
  if (input.status === "active") return "anúncios ativos";
  if (input.status === "paused") return "anúncios pausados";
  if (input.status === "closed") return "anúncios finalizados";
  if (input.status === "under_review") return "anúncios em revisão";
  if (input.status === "error") return "anúncios com erro";
  if (input.stock === "with_stock") return "anúncios com estoque";
  if (input.stock === "without_stock") return "anúncios sem estoque";
  if (input.type === "premium") return "anúncios Premium";
  if (input.type === "classico") return "anúncios Clássico";
  if (input.type === "other") return "anúncios de outros tipos";
  if (input.query.trim()) return "anúncios encontrados";
  return "anúncios";
}

function listingsCounterLabel(input: { current: number; total: number | null | undefined; filtered: boolean; subject: string }) {
  const total = typeof input.total === "number" ? input.total : input.current;
  if (!input.filtered) return `${input.current}/${total} anúncios`;
  if (total <= input.current) return `${total} ${input.subject}`;
  return `${input.current}/${total} ${input.subject}`;
}

function normalizedSearchQuery(value: string) {
  return value.trim().toLowerCase();
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
  if (typeof amount === "number") return `Frete ML: ${formatPrice(amount, listing.shipping?.currencyId ?? listing.currencyId)}`;
  return "Frete nao retornado";
}

function shippingPayerLabel(listing: MercadoLivreClientListing) {
  if (listing.shipping?.paidBy === "seller") return "Vendedor";
  if (listing.shipping?.paidBy === "buyer") return "Comprador";
  return "Nao informado";
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

function numberFromDimensionValue(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDimensionFormValue(value: number | string | null | undefined) {
  const parsed = numberFromDimensionValue(value);
  if (parsed === null) return "";
  return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace(".", ",");
}

function localDimensionsPayloadFromListing(listing: MercadoLivreClientListing): MercadoLivreDimensionsPayload {
  return {
    externalWrite: false,
    canEdit: false,
    listing: {
      externalId: listing.externalId,
      itemId: listing.itemId,
      title: listing.title,
      thumbnail: listing.thumbnail,
      sellerSku: listing.sellerSku,
      sku: listing.sku,
      price: listing.price,
      currencyId: listing.currencyId,
      categoryId: listing.categoryId,
      shipping: listing.shipping
    },
    dimensions: {
      raw: listing.dimensionInfo?.raw ?? listing.dimensions ?? null,
      widthCm: numberFromDimensionValue(listing.dimensionInfo?.widthCm),
      heightCm: numberFromDimensionValue(listing.dimensionInfo?.heightCm),
      lengthCm: numberFromDimensionValue(listing.dimensionInfo?.lengthCm),
      weightGrams: numberFromDimensionValue(listing.dimensionInfo?.weightG),
      hasDimensions: Boolean(listing.dimensionInfo?.hasDimensions),
      packageMode: "manufacturer"
    },
    packaging: {
      mode: "manufacturer",
      label: "Usar embalagem do fabricante"
    },
    warning: "Dimensoes impactam frete, logistica e possiveis divergencias de cobranca."
  };
}

function dimensionsFormFromPayload(payload: MercadoLivreDimensionsPayload): DimensionsFormState {
  return {
    widthCm: formatDimensionFormValue(payload.dimensions.widthCm),
    heightCm: formatDimensionFormValue(payload.dimensions.heightCm),
    lengthCm: formatDimensionFormValue(payload.dimensions.lengthCm),
    weightGrams: formatDimensionFormValue(payload.dimensions.weightGrams),
    packageMode: payload.dimensions.packageMode
  };
}

function validateDimensionsForm(form: DimensionsFormState) {
  const fields = [
    { key: "widthCm", label: "Largura", max: 300, integer: false },
    { key: "heightCm", label: "Altura", max: 300, integer: false },
    { key: "lengthCm", label: "Comprimento", max: 300, integer: false },
    { key: "weightGrams", label: "Peso", max: 30000, integer: true }
  ] as const;

  for (const field of fields) {
    const value = numberFromDimensionValue(form[field.key]);
    if (value === null) return `${field.label} precisa ser preenchido.`;
    if (value <= 0) return `${field.label} precisa ser maior que zero.`;
    if (value > field.max) return `${field.label} precisa ser no maximo ${field.max}.`;
    if (field.integer && !Number.isInteger(value)) return `${field.label} precisa ser informado em gramas inteiros.`;
  }

  return "";
}

function dimensionInfoFromPayload(payload: MercadoLivreDimensionsPayload): MercadoLivreClientListing["dimensionInfo"] {
  return {
    raw: payload.dimensions.raw,
    widthCm: payload.dimensions.widthCm === null ? null : formatDimensionFormValue(payload.dimensions.widthCm),
    heightCm: payload.dimensions.heightCm === null ? null : formatDimensionFormValue(payload.dimensions.heightCm),
    lengthCm: payload.dimensions.lengthCm === null ? null : formatDimensionFormValue(payload.dimensions.lengthCm),
    weightG: payload.dimensions.weightGrams === null ? null : formatDimensionFormValue(payload.dimensions.weightGrams),
    hasDimensions: payload.dimensions.hasDimensions
  };
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

function listingGalleryPictures(listing: MercadoLivreClientListing): ListingGalleryPicture[] {
  const seen = new Set<string>();
  const pictures: ListingGalleryPicture[] = [];

  for (const picture of listing.pictures ?? []) {
    const url = picture.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    pictures.push({
      id: picture.id ?? null,
      url,
      size: picture.size ?? null,
      maxSize: picture.maxSize ?? null,
      quality: picture.quality ?? null
    });
  }

  const thumbnail = listing.thumbnail?.trim();
  if (thumbnail && !seen.has(thumbnail)) {
    pictures.push({
      id: null,
      url: thumbnail,
      isThumbnailFallback: true
    });
  }

  return pictures;
}

function technicalSheetStatusLabel(attribute: TechnicalSheetAttribute) {
  if (attribute.status === "filled") return "Preenchido";
  if (attribute.status === "missing_required") return "Faltando";
  if (attribute.status === "not_applicable_allowed") return "N/A permitido";
  return "Opcional";
}

function technicalSheetStatusTone(attribute: TechnicalSheetAttribute): "success" | "info" | "warning" | "danger" | "muted" {
  if (attribute.status === "filled") return "success";
  if (attribute.status === "missing_required") return "danger";
  if (attribute.status === "not_applicable_allowed") return "info";
  return "muted";
}

function technicalSheetTabHasMeasures(payload: TechnicalSheetPayload | null) {
  if (!payload) return false;
  if (payload.listing.dimensionInfo?.hasDimensions) return true;
  return payload.attributes.some((attribute) => {
    const name = attribute.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return name.includes("medida") || name.includes("tamanho") || name.includes("altura") || name.includes("largura") || name.includes("comprimento") || name.includes("peso");
  });
}

function localTechnicalSheetSection(attribute: MercadoLivreClientListing["attributes"][number]): TechnicalSheetAttribute["section"] {
  const id = attribute.id?.trim().toUpperCase() ?? "";
  const name = attribute.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (["GTIN", "EAN", "UPC", "UNIVERSAL_PRODUCT_CODE", "EMPTY_GTIN_REASON"].includes(id) || name.includes("gtin") || name.includes("ean")) {
    return "Registros de produtos";
  }
  if (id.includes("WARRANTY") || id.includes("INMETRO") || name.includes("garantia") || name.includes("inmetro")) {
    return "Legal";
  }
  if (id.includes("PRICE") || name.includes("preco")) {
    return "Precos";
  }
  return "Caracteristicas principais";
}

function buildLocalTechnicalSheetPayload(listing: MercadoLivreClientListing): TechnicalSheetPayload {
  const attributes: TechnicalSheetAttribute[] = listing.attributes.map((attribute, index) => {
    const currentValue = attribute.value?.trim() || null;
    return {
      id: attribute.id?.trim() || `LOCAL_ATTRIBUTE_${index + 1}`,
      name: attribute.name?.trim() || attribute.id?.trim() || `Atributo ${index + 1}`,
      section: localTechnicalSheetSection(attribute),
      groupId: null,
      groupName: null,
      valueType: null,
      currentValue,
      status: currentValue ? "filled" : "optional",
      filled: Boolean(currentValue),
      required: false,
      allowsNotApplicable: false,
      tags: [],
      allowedValues: []
    };
  });

  const sectionOrder: TechnicalSheetAttribute["section"][] = ["Caracteristicas principais", "Registros de produtos", "Legal", "Precos", "Outros"];
  const sections = sectionOrder
    .map((sectionName) => ({
      name: sectionName,
      attributes: attributes.filter((attribute) => attribute.section === sectionName)
    }))
    .filter((section) => section.attributes.length > 0);

  return {
    readOnly: true,
    externalWrite: false,
    listing: {
      externalId: listing.externalId,
      itemId: listing.itemId,
      title: listing.title,
      thumbnail: listing.thumbnail,
      pictures: listing.pictures,
      sku: listing.sku,
      gtin: listing.gtin,
      price: listing.price,
      currencyId: listing.currencyId,
      categoryId: listing.categoryId,
      categoryName: listing.categoryName,
      categoryPath: listing.categoryPath,
      attributes: listing.attributes,
      dimensions: listing.dimensions,
      dimensionInfo: listing.dimensionInfo
    },
    category: {
      id: listing.categoryId,
      name: listing.categoryName ?? null,
      path: listing.categoryPath ?? listing.categoryName ?? null
    },
    attributes,
    filledAttributes: attributes.filter((attribute) => attribute.filled),
    missingRequiredAttributes: [],
    optionalAttributes: attributes.filter((attribute) => !attribute.filled),
    allowedValues: [],
    sections,
    warnings: attributes.length ? [] : ["Ficha tecnica nao disponivel nos dados carregados."]
  };
}

function isTechnicalSheetPayload(value: unknown): value is TechnicalSheetPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<TechnicalSheetPayload>;
  return payload.readOnly === true && payload.externalWrite === false && Array.isArray(payload.attributes) && Array.isArray(payload.sections);
}

function isDimensionsPayload(value: unknown): value is MercadoLivreDimensionsPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<MercadoLivreDimensionsPayload>;
  return Boolean(payload.dimensions && typeof payload.dimensions === "object" && payload.listing && typeof payload.listing === "object");
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
  muted = false,
  onClick,
  title
}: {
  icon: typeof FileText;
  label: string;
  muted?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const className = `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
    muted
      ? "border-matrix-border bg-matrix-panel2/55 text-matrix-muted"
      : "border-matrix-gold/20 bg-matrix-goldSoft/18 text-matrix-fg"
  } ${onClick ? "hover:border-matrix-gold/60 hover:bg-matrix-goldSoft/35" : ""}`;

  const content = (
    <>
      <Icon className="h-3.5 w-3.5 text-matrix-goldDark" />
      {label}
    </>
  );

  if (onClick) {
    return (
      <button aria-label={title ?? label} className={className} onClick={onClick} title={title ?? label} type="button">
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={title ?? "Indicador visual"}>
      {content}
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

function technicalSheetValue(attribute: TechnicalSheetAttribute) {
  if (!attribute.currentValue) return "-";
  const normalizedValue = attribute.currentValue.trim().toLowerCase();

  if (attribute.valueType === "boolean" || normalizedValue === "true" || normalizedValue === "false") {
    if (["true", "sim", "yes"].includes(normalizedValue)) return "Sim";
    if (["false", "nao", "não", "no"].includes(normalizedValue)) return "Nao";
  }

  return attribute.currentValue;
}

const TECHNICAL_ATTRIBUTE_LABELS: Record<string, string> = {
  BATTERIES_FEATURES: "Caracteristicas das baterias",
  BRAND: "Marca",
  EAN: "EAN",
  EMPTY_GTIN_REASON: "Motivo de GTIN vazio",
  EXTENDED_LENGTH: "Comprimento estendido",
  GTIN: "GTIN",
  HEIGHT: "Altura",
  INMETRO_CERTIFICATION_REGISTRATION_NUMBER: "Numero de registro/certificacao INMETRO",
  ITEM_CONDITION: "Condicao do item",
  ITEM_MATERIAL: "Material",
  ITEM_PART_NUMBER: "Numero de peca",
  LENGTH: "Comprimento",
  MODEL: "Modelo",
  MPN: "Numero de peca",
  OEM: "Codigo OEM",
  PACKAGE_HEIGHT: "Altura da embalagem",
  PACKAGE_LENGTH: "Comprimento da embalagem",
  PACKAGE_WEIGHT: "Peso da embalagem",
  PACKAGE_WIDTH: "Largura da embalagem",
  PART_NUMBER: "Numero de peca",
  PRODUCT_CHEMICAL_FEATURES: "Caracteristicas quimicas do produto",
  PRODUCT_FEATURES: "Caracteristicas do produto",
  PRODUCT_ORIGIN: "Origem do produto",
  SELLER_SKU: "SKU do vendedor",
  SELLER_PACKAGE_HEIGHT: "Altura da embalagem do vendedor",
  SELLER_PACKAGE_LENGTH: "Comprimento da embalagem do vendedor",
  SELLER_PACKAGE_WEIGHT: "Peso da embalagem do vendedor",
  SELLER_PACKAGE_WIDTH: "Largura da embalagem do vendedor",
  UNIVERSAL_PRODUCT_CODE: "Codigo universal do produto",
  UPC: "UPC",
  WARRANTY_TYPE: "Tipo de garantia",
  WARRANTY_TIME: "Tempo de garantia",
  WEIGHT: "Peso",
  WIDTH: "Largura"
};

const TECHNICAL_SHEET_HIDDEN_ATTRIBUTE_IDS = new Set(["SELLER_SKU", "SELLER_CUSTOM_FIELD"]);
const TECHNICAL_SHEET_PART_NUMBER_IDS = new Set(["PART_NUMBER", "ITEM_PART_NUMBER", "OEM", "MPN"]);
const TECHNICAL_SHEET_GTIN_IDS = new Set(["GTIN", "EAN", "UPC", "UNIVERSAL_PRODUCT_CODE"]);
const TECHNICAL_SHEET_DIMENSION_IDS = new Set([
  "WIDTH",
  "HEIGHT",
  "LENGTH",
  "PACKAGE_WIDTH",
  "PACKAGE_HEIGHT",
  "PACKAGE_LENGTH",
  "SELLER_PACKAGE_WIDTH",
  "SELLER_PACKAGE_HEIGHT",
  "SELLER_PACKAGE_LENGTH"
]);
const TECHNICAL_SHEET_WEIGHT_IDS = new Set(["WEIGHT", "PACKAGE_WEIGHT", "SELLER_PACKAGE_WEIGHT"]);

function looksLikeTechnicalCode(value: string | null | undefined) {
  if (!value) return false;
  return /^[A-Z0-9_]+$/.test(value.trim());
}

function friendlyAttributeName(attribute: TechnicalSheetAttribute) {
  const name = attribute.name?.trim();
  if (name && !looksLikeTechnicalCode(name)) return name;

  const code = (attribute.id || name || "").trim();
  if (code && TECHNICAL_ATTRIBUTE_LABELS[code]) return TECHNICAL_ATTRIBUTE_LABELS[code];

  const fallback = code || name || "Atributo";
  return fallback
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeIdentifier(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function isHiddenTechnicalSheetAttribute(attribute: TechnicalSheetAttribute) {
  return TECHNICAL_SHEET_HIDDEN_ATTRIBUTE_IDS.has(attribute.id.trim().toUpperCase());
}

function isPartNumberAttribute(attribute: TechnicalSheetAttribute) {
  return TECHNICAL_SHEET_PART_NUMBER_IDS.has(attribute.id.trim().toUpperCase());
}

function identifiersLookRelated(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function isSuspectedSkuPartNumber(attribute: TechnicalSheetAttribute, skuCandidates: string[]) {
  if (!isPartNumberAttribute(attribute) || !attribute.currentValue) return false;
  const normalizedValue = normalizeIdentifier(attribute.currentValue);
  return skuCandidates.some((sku) => identifiersLookRelated(normalizedValue, normalizeIdentifier(sku)));
}

function technicalSheetAttributeId(attribute: TechnicalSheetAttribute) {
  return attribute.id.trim().toUpperCase();
}

function technicalSheetAttributeDisplayValue(attribute: TechnicalSheetAttribute | null | undefined) {
  if (!attribute) return null;
  const value = technicalSheetValue(attribute);
  return value === "-" ? null : value;
}

function findTechnicalSheetAttribute(input: {
  payload: TechnicalSheetPayload | null;
  ids?: Iterable<string>;
  names?: string[];
  skuCandidates?: string[];
  skipSuspectedSkuPartNumber?: boolean;
}) {
  const ids = new Set(Array.from(input.ids ?? []).map((id) => id.toUpperCase()));
  const names = (input.names ?? []).map((name) => normalizeIdentifier(name));

  return (
    input.payload?.attributes.find((attribute) => {
      if (isHiddenTechnicalSheetAttribute(attribute)) return false;
      if (input.skipSuspectedSkuPartNumber && isSuspectedSkuPartNumber(attribute, input.skuCandidates ?? [])) return false;

      const id = technicalSheetAttributeId(attribute);
      if (ids.has(id)) return true;

      const displayName = normalizeIdentifier(friendlyAttributeName(attribute));
      const rawName = normalizeIdentifier(attribute.name);
      return names.some((name) => name && (displayName.includes(name) || rawName.includes(name)));
    }) ?? null
  );
}

function firstTechnicalSheetAttributeValue(payload: TechnicalSheetPayload | null, ids: Iterable<string>) {
  for (const id of ids) {
    const attribute = findTechnicalSheetAttribute({ payload, ids: [id] });
    const value = technicalSheetAttributeDisplayValue(attribute);
    if (value) return { attribute, value };
  }
  return { attribute: null, value: null };
}

function buildDimensionsMainValue(payload: TechnicalSheetPayload | null) {
  const listing = payload?.listing;
  const height = firstTechnicalSheetAttributeValue(payload, ["HEIGHT", "PACKAGE_HEIGHT", "SELLER_PACKAGE_HEIGHT"]).value ?? listing?.dimensionInfo?.heightCm ?? null;
  const width = firstTechnicalSheetAttributeValue(payload, ["WIDTH", "PACKAGE_WIDTH", "SELLER_PACKAGE_WIDTH"]).value ?? listing?.dimensionInfo?.widthCm ?? null;
  const length = firstTechnicalSheetAttributeValue(payload, ["LENGTH", "PACKAGE_LENGTH", "SELLER_PACKAGE_LENGTH"]).value ?? listing?.dimensionInfo?.lengthCm ?? null;

  const parts = [
    height ? `Alt. ${height}` : null,
    width ? `Larg. ${width}` : null,
    length ? `Comp. ${length}` : null
  ].filter(Boolean);

  if (parts.length) return parts.join(" · ");
  if (listing?.dimensions || listing?.dimensionInfo?.hasDimensions) return dimensionsLabel(listing as MercadoLivreClientListing);
  return null;
}

function buildTechnicalSheetMainFields(payload: TechnicalSheetPayload | null, listing: MercadoLivreClientListing | null, skuCandidates: string[]): TechnicalSheetMainField[] {
  const brand = findTechnicalSheetAttribute({ payload, ids: ["BRAND"], names: ["Marca"] });
  const model = findTechnicalSheetAttribute({ payload, ids: ["MODEL"], names: ["Modelo"] });
  const gtin = findTechnicalSheetAttribute({ payload, ids: TECHNICAL_SHEET_GTIN_IDS, names: ["GTIN", "EAN", "UPC", "Codigo universal"] });
  const partNumber = findTechnicalSheetAttribute({
    payload,
    ids: TECHNICAL_SHEET_PART_NUMBER_IDS,
    names: ["Numero de peca", "Part number", "Codigo similar", "Referencia"],
    skuCandidates,
    skipSuspectedSkuPartNumber: true
  });
  const weight = firstTechnicalSheetAttributeValue(payload, TECHNICAL_SHEET_WEIGHT_IDS);

  const dimensionsAttributeIds = payload?.attributes
    .filter((attribute) => TECHNICAL_SHEET_DIMENSION_IDS.has(technicalSheetAttributeId(attribute)))
    .map((attribute) => technicalSheetAttributeId(attribute)) ?? [];

  return [
    {
      key: "brand",
      label: "Marca",
      value: technicalSheetAttributeDisplayValue(brand) ?? "-",
      attribute: brand ?? undefined,
      attributeIds: brand ? [technicalSheetAttributeId(brand)] : []
    },
    {
      key: "model",
      label: "Modelo",
      value: technicalSheetAttributeDisplayValue(model) ?? listing?.title ?? payload?.listing.title ?? "-",
      attribute: model ?? undefined,
      attributeIds: model ? [technicalSheetAttributeId(model)] : []
    },
    {
      key: "sku",
      label: "SKU",
      value: listing?.sku ?? payload?.listing.sku ?? "-",
      attributeIds: []
    },
    {
      key: "gtin",
      label: "GTIN",
      value: listing?.gtin ?? payload?.listing.gtin ?? technicalSheetAttributeDisplayValue(gtin) ?? "-",
      attribute: gtin ?? undefined,
      attributeIds: gtin ? [technicalSheetAttributeId(gtin)] : []
    },
    {
      key: "part-number",
      label: "Numero da peca",
      value: technicalSheetAttributeDisplayValue(partNumber) ?? "-",
      attribute: partNumber ?? undefined,
      attributeIds: partNumber ? [technicalSheetAttributeId(partNumber)] : []
    },
    {
      key: "dimensions",
      label: "Dimensoes",
      value: buildDimensionsMainValue(payload) ?? "-",
      attributeIds: Array.from(new Set(dimensionsAttributeIds))
    },
    {
      key: "weight",
      label: "Peso",
      value: weight.value ?? payload?.listing.dimensionInfo?.weightG ?? "-",
      attribute: weight.attribute ?? undefined,
      attributeIds: weight.attribute ? [technicalSheetAttributeId(weight.attribute)] : []
    }
  ];
}

function mainTechnicalSheetAttributeIds(fields: TechnicalSheetMainField[]) {
  return new Set(fields.flatMap((field) => field.attributeIds));
}

function orderTechnicalSheetSections(
  sections: TechnicalSheetSection[],
  skuCandidates: string[] = [],
  excludedAttributeIds: Set<string> = new Set()
): TechnicalSheetDisplaySection[] {
  const visibleAttributes = sections.flatMap((section, sectionIndex) =>
    section.attributes
      .filter((attribute) => !isHiddenTechnicalSheetAttribute(attribute) && !excludedAttributeIds.has(technicalSheetAttributeId(attribute)))
      .map((attribute, attributeIndex) => ({
        ...attribute,
        originalSection: section.name,
        sortIndex: sectionIndex * 1000 + attributeIndex,
        suspectedSkuValue: isSuspectedSkuPartNumber(attribute, skuCandidates)
      }))
  );

  const groupedAttributes = orderTechnicalSheetAttributes(visibleAttributes).reduce(
    (groups, attribute) => {
      const group = technicalSheetAttributeSortGroup(attribute);
      groups[group].push(attribute);
      return groups;
    },
    {
      filled: [] as TechnicalSheetDisplayAttribute[],
      valued: [] as TechnicalSheetDisplayAttribute[],
      required: [] as TechnicalSheetDisplayAttribute[],
      optional: [] as TechnicalSheetDisplayAttribute[]
    }
  );

  return [
    { name: "Atributos preenchidos", attributes: groupedAttributes.filled },
    { name: "Atributos com valor", attributes: groupedAttributes.valued },
    { name: "Pendentes / obrigatorios", attributes: groupedAttributes.required },
    { name: "Opcionais", attributes: groupedAttributes.optional }
  ].filter((section) => section.attributes.length > 0);
}

function technicalSheetAttributeSortGroup(attribute: TechnicalSheetDisplayAttribute): "filled" | "valued" | "required" | "optional" {
  if (attribute.status === "filled") return "filled";
  if (technicalSheetAttributeDisplayValue(attribute)) return "valued";
  if (attribute.status === "missing_required" || attribute.required) return "required";
  return "optional";
}

function technicalSheetAttributeSortRank(attribute: TechnicalSheetDisplayAttribute) {
  const group = technicalSheetAttributeSortGroup(attribute);
  if (group === "filled") return 0;
  if (group === "valued") return 1;
  if (group === "required") return 2;
  return 3;
}

function orderTechnicalSheetAttributes(attributes: TechnicalSheetDisplayAttribute[]) {
  return attributes
    .map((attribute, index) => ({
      attribute,
      index,
      sortRank: technicalSheetAttributeSortRank(attribute)
    }))
    .sort((left, right) => {
      if (left.sortRank !== right.sortRank) return left.sortRank - right.sortRank;
      return (left.attribute.sortIndex ?? left.index) - (right.attribute.sortIndex ?? right.index);
    })
    .map((item) => item.attribute);
}

function technicalSheetSkuCandidates(payload: TechnicalSheetPayload | null) {
  const values = new Set<string>();
  if (payload?.listing.sku) values.add(payload.listing.sku);

  for (const attribute of payload?.listing.attributes ?? []) {
    const id = attribute.id?.trim().toUpperCase();
    if ((id === "SELLER_SKU" || id === "SKU" || id === "SELLER_CUSTOM_FIELD") && attribute.value) {
      values.add(attribute.value);
    }
  }

  return Array.from(values);
}

function TechnicalAttributeField({ attribute }: { attribute: TechnicalSheetDisplayAttribute }) {
  const visibleAllowedValues = attribute.allowedValues.slice(0, 4);
  const hiddenAllowedValues = Math.max(0, attribute.allowedValues.length - visibleAllowedValues.length);
  const displayName = friendlyAttributeName(attribute);

  return (
    <article className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel/65 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h5 className="text-sm font-semibold leading-5 text-matrix-fg">
            {displayName}
            {attribute.required ? <span className="ml-1 text-matrix-goldDark">*</span> : null}
          </h5>
        </div>
        <Badge tone={technicalSheetStatusTone(attribute)}>{technicalSheetStatusLabel(attribute)}</Badge>
      </div>
      <div className="mt-2 rounded-md border border-matrix-border/70 bg-matrix-panel2/55 px-2.5 py-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">Valor atual</p>
        <p className={`mt-1 min-h-5 break-words text-sm font-semibold text-matrix-fg ${attribute.currentValue ? "" : "text-matrix-muted"}`}>
          {technicalSheetValue(attribute)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {attribute.required ? <Badge tone="warning">Obrigatorio</Badge> : null}
        {attribute.allowsNotApplicable ? <Badge tone="info">N/A permitido</Badge> : null}
        {attribute.suspectedSkuValue ? <Badge tone="warning">Possivel SKU usado como numero de peca</Badge> : null}
        {attribute.originalSection ? <Badge tone="muted">{attribute.originalSection}</Badge> : null}
        {attribute.groupName && !looksLikeTechnicalCode(attribute.groupName) ? <Badge tone="muted">{attribute.groupName}</Badge> : null}
      </div>
      {visibleAllowedValues.length ? (
        <div className="mt-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-matrix-muted">Permitidos</p>
          <div className="flex max-h-14 flex-wrap gap-1.5 overflow-hidden">
            {visibleAllowedValues.map((value) => (
              <span key={`${attribute.id}-${value.id ?? value.name}`} className="rounded border border-matrix-border bg-matrix-panel2 px-1.5 py-0.5 text-[11px] text-matrix-muted">
                {value.name}
              </span>
            ))}
            {hiddenAllowedValues ? (
              <span className="rounded border border-matrix-gold/30 bg-matrix-goldSoft/20 px-1.5 py-0.5 text-[11px] font-semibold text-matrix-goldDark" title={`${hiddenAllowedValues} valores permitidos adicionais`}>
                +{hiddenAllowedValues}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TechnicalSheetMainFields({ fields }: { fields: TechnicalSheetMainField[] }) {
  return (
    <DetailSection title="Campos principais">
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {fields.map((field) => (
          <div key={field.key} className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel/65 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-matrix-muted">{field.label}</dt>
              {field.attribute ? <Badge tone={technicalSheetStatusTone(field.attribute)}>{technicalSheetStatusLabel(field.attribute)}</Badge> : null}
            </div>
            <dd className={`mt-2 min-h-5 break-words text-sm font-semibold text-matrix-fg ${field.value === "-" ? "text-matrix-muted" : ""}`}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </DetailSection>
  );
}

export function MercadoLivreMarketplacePage() {
  const [account, setAccount] = useState<MercadoLivreClientAccount | null>(null);
  const [listingsPayload, setListingsPayload] = useState<MercadoLivreListingsPayload | null>(null);
  const [filteredListingsPayload, setFilteredListingsPayload] = useState<MercadoLivreListingsPayload | null>(null);
  const [filteredListingsLoading, setFilteredListingsLoading] = useState(false);
  const [filteredListingsError, setFilteredListingsError] = useState("");
  const filteredListingsCacheRef = useRef(new Map<string, MercadoLivreListingsPayload>());
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
  const [pictureGalleryListing, setPictureGalleryListing] = useState<MercadoLivreClientListing | null>(null);
  const [pictureGalleryIndex, setPictureGalleryIndex] = useState(0);
  const [dimensionsListing, setDimensionsListing] = useState<MercadoLivreClientListing | null>(null);
  const [dimensionsPayload, setDimensionsPayload] = useState<MercadoLivreDimensionsPayload | null>(null);
  const [dimensionsForm, setDimensionsForm] = useState<DimensionsFormState>({
    widthCm: "",
    heightCm: "",
    lengthCm: "",
    weightGrams: "",
    packageMode: "manufacturer"
  });
  const [dimensionsLoading, setDimensionsLoading] = useState(false);
  const [dimensionsSaving, setDimensionsSaving] = useState(false);
  const [dimensionsError, setDimensionsError] = useState("");
  const [dimensionsSuccess, setDimensionsSuccess] = useState("");
  const [technicalSheetListing, setTechnicalSheetListing] = useState<MercadoLivreClientListing | null>(null);
  const [technicalSheetPayload, setTechnicalSheetPayload] = useState<TechnicalSheetPayload | null>(null);
  const [technicalSheetError, setTechnicalSheetError] = useState("");
  const [technicalSheetLoading, setTechnicalSheetLoading] = useState(false);
  const [technicalSheetTab, setTechnicalSheetTab] = useState<"attributes" | "measures">("attributes");
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

  useEffect(() => {
    setPictureGalleryIndex(0);
  }, [pictureGalleryListing?.externalId]);

  const hasClientConnection = Boolean(account?.connected && account.status === "ACTIVE");
  const normalizedQuery = normalizedSearchQuery(query);
  const hasActiveFilters =
    query.trim() !== "" ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    stockFilter !== "all";
  const filteredModeActive = hasActiveFilters;
  const activeListingsPayload = filteredModeActive ? filteredListingsPayload : listingsPayload;
  const listings = useMemo(() => activeListingsPayload?.listings ?? [], [activeListingsPayload?.listings]);
  const kpis = activeListingsPayload?.kpis ?? { active: 0, paused: 0, errors: 0, withoutStock: 0, sales: 0, visits: 0 };
  const paging = activeListingsPayload?.paging;
  const totalAvailable = filteredModeActive
    ? (paging?.total ?? activeListingsPayload?.totalAvailable ?? null)
    : (activeListingsPayload?.totalAvailable ?? paging?.total ?? listingsPayload?.totalAvailable ?? null);
  const currentPage = paging?.page ?? Math.floor(pageOffset / pageSize) + 1;
  const totalPages = typeof totalAvailable === "number" ? Math.max(1, Math.ceil(totalAvailable / pageSize)) : currentPage;
  const hasPreviousPage = paging?.hasPrevious ?? pageOffset > 0;
  const hasNextPage = paging?.hasNext ?? (typeof totalAvailable === "number" ? pageOffset + pageSize < totalAvailable : false);
  const counterSubject = filteredCounterSubject({ status: statusFilter, type: typeFilter, stock: stockFilter, query });
  const kpiScopeHint = filteredModeActive ? "No filtro atual" : "Na pagina carregada";

  useEffect(() => {
    if (!filteredModeActive || !hasClientConnection) {
      setFilteredListingsPayload(null);
      setFilteredListingsLoading(false);
      setFilteredListingsError("");
      return;
    }

    const cacheKey = JSON.stringify({
      query: normalizedQuery,
      status: statusFilter,
      listingType: typeFilter,
      stock: stockFilter,
      offset: pageOffset,
      limit: pageSize
    });
    const cachedPayload = filteredListingsCacheRef.current.get(cacheKey);
    if (cachedPayload) {
      setFilteredListingsPayload(cachedPayload);
      setFilteredListingsLoading(false);
      setFilteredListingsError("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setFilteredListingsLoading(true);
      setFilteredListingsError("");
      try {
        const params = new URLSearchParams();
        if (normalizedQuery) params.set("query", normalizedQuery);
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (typeFilter !== "all") params.set("listingType", typeFilter);
        if (stockFilter !== "all") params.set("stock", stockFilter);
        params.set("offset", String(pageOffset));
        params.set("limit", String(pageSize));
        params.set("maxListings", "500");
        const response = await fetch(`/api/marketplaces/mercado-livre/client/listings?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Nao foi possivel buscar anuncios Mercado Livre.");
        }
        const typedPayload = payload as MercadoLivreListingsPayload;
        filteredListingsCacheRef.current.set(cacheKey, typedPayload);
        setFilteredListingsPayload(typedPayload);
        setFilteredListingsError("");
        setSelectedIds(new Set());
      } catch (error) {
        if (controller.signal.aborted) return;
        setFilteredListingsPayload(null);
        setFilteredListingsError(error instanceof Error ? error.message : "Nao foi possivel buscar anuncios Mercado Livre.");
      } finally {
        if (!controller.signal.aborted) setFilteredListingsLoading(false);
      }
    }, normalizedQuery ? 450 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [filteredModeActive, hasClientConnection, normalizedQuery, pageOffset, pageSize, statusFilter, stockFilter, typeFilter]);

  const filteredListings = listings;

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
      filteredListingsCacheRef.current.clear();
      setSelectedIds(new Set());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nao foi possivel sincronizar anuncios Mercado Livre.");
    } finally {
      setSyncing(false);
    }
  }

  async function openTechnicalSheet(listing: MercadoLivreClientListing) {
    const localPayload = buildLocalTechnicalSheetPayload(listing);
    setTechnicalSheetListing(listing);
    setTechnicalSheetPayload(localPayload);
    setTechnicalSheetError("");
    setTechnicalSheetLoading(true);
    setTechnicalSheetTab("attributes");

    try {
      const response = await fetch(`/api/marketplaces/mercado-livre/client/listings/${encodeURIComponent(listing.externalId)}/technical-sheet`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok || !isTechnicalSheetPayload(payload)) {
        const errorMessage =
          payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Nao foi possivel carregar a ficha tecnica completa.";
        throw new Error(errorMessage);
      }

      setTechnicalSheetPayload(payload);
      setTechnicalSheetError("");
    } catch {
      setTechnicalSheetPayload((current) => current ?? localPayload);
      setTechnicalSheetError("Nao foi possivel carregar a ficha tecnica completa. Exibindo dados carregados da listagem.");
    } finally {
      setTechnicalSheetLoading(false);
    }
  }

  function closeTechnicalSheet() {
    setTechnicalSheetListing(null);
    setTechnicalSheetPayload(null);
    setTechnicalSheetError("");
    setTechnicalSheetLoading(false);
    setTechnicalSheetTab("attributes");
  }

  function openPictureGallery(listing: MercadoLivreClientListing) {
    setPictureGalleryListing(listing);
    setPictureGalleryIndex(0);
  }

  function closePictureGallery() {
    setPictureGalleryListing(null);
    setPictureGalleryIndex(0);
  }

  function updateListingDimensionsFromPayload(listing: MercadoLivreClientListing, payload: MercadoLivreDimensionsPayload): MercadoLivreClientListing {
    return {
      ...listing,
      dimensions: payload.dimensions.raw,
      dimensionInfo: dimensionInfoFromPayload(payload)
    };
  }

  function replaceListingDimensions(payload: MercadoLivreDimensionsPayload) {
    const apply = (current: MercadoLivreListingsPayload | null): MercadoLivreListingsPayload | null => {
      if (!current) return current;
      return {
        ...current,
        listings: current.listings.map((listing) =>
          listing.externalId === payload.listing.externalId ? updateListingDimensionsFromPayload(listing, payload) : listing
        )
      };
    };

    setListingsPayload(apply);
    setFilteredListingsPayload(apply);
    setDimensionsListing((current) => (current ? updateListingDimensionsFromPayload(current, payload) : current));
  }

  async function openDimensionsEditor(listing: MercadoLivreClientListing) {
    const fallbackPayload = localDimensionsPayloadFromListing(listing);
    setDimensionsListing(listing);
    setDimensionsPayload(fallbackPayload);
    setDimensionsForm(dimensionsFormFromPayload(fallbackPayload));
    setDimensionsError("");
    setDimensionsSuccess("");
    setDimensionsLoading(true);

    try {
      const response = await fetch(`/api/marketplaces/mercado-livre/client/listings/${encodeURIComponent(listing.externalId)}/dimensions`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok || !isDimensionsPayload(payload)) {
        const errorMessage =
          payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Nao foi possivel carregar dimensoes atuais.";
        throw new Error(errorMessage);
      }

      setDimensionsPayload(payload);
      setDimensionsForm(dimensionsFormFromPayload(payload));
      setDimensionsError("");
      setDimensionsListing((current) => (current ? updateListingDimensionsFromPayload(current, payload) : current));
    } catch {
      setDimensionsPayload((current) => current ?? fallbackPayload);
      setDimensionsError("Nao foi possivel carregar dimensoes atuais. Exibindo dados carregados da listagem.");
    } finally {
      setDimensionsLoading(false);
    }
  }

  function closeDimensionsEditor() {
    setDimensionsListing(null);
    setDimensionsPayload(null);
    setDimensionsForm({
      widthCm: "",
      heightCm: "",
      lengthCm: "",
      weightGrams: "",
      packageMode: "manufacturer"
    });
    setDimensionsLoading(false);
    setDimensionsSaving(false);
    setDimensionsError("");
    setDimensionsSuccess("");
  }

  async function saveDimensions() {
    if (!dimensionsListing || !dimensionsPayload?.externalWrite || !dimensionsPayload.canEdit) return;

    const validationError = validateDimensionsForm(dimensionsForm);
    if (validationError) {
      setDimensionsError(validationError);
      return;
    }

    const confirmed = window.confirm("Confirmar alteracao real das dimensoes no Mercado Livre?");
    if (!confirmed) return;

    setDimensionsSaving(true);
    setDimensionsError("");
    setDimensionsSuccess("");

    try {
      const response = await fetch(`/api/marketplaces/mercado-livre/client/listings/${encodeURIComponent(dimensionsListing.externalId)}/dimensions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widthCm: numberFromDimensionValue(dimensionsForm.widthCm),
          heightCm: numberFromDimensionValue(dimensionsForm.heightCm),
          lengthCm: numberFromDimensionValue(dimensionsForm.lengthCm),
          weightGrams: numberFromDimensionValue(dimensionsForm.weightGrams)
        })
      });
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok || !isDimensionsPayload(payload)) {
        const errorMessage =
          payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Nao foi possivel salvar dimensoes.";
        throw new Error(errorMessage);
      }

      setDimensionsPayload(payload);
      setDimensionsForm(dimensionsFormFromPayload(payload));
      replaceListingDimensions(payload);
      setDimensionsSuccess(payload.message ?? "Dimensoes atualizadas com sucesso.");
    } catch (error) {
      setDimensionsError(error instanceof Error ? error.message : "Nao foi possivel salvar dimensoes.");
    } finally {
      setDimensionsSaving(false);
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
    if (!hasActiveFilters) {
      void syncListings({ offset: 0, limit: nextPageSize });
    }
  }

  function changeQuickFilter(nextFilter: QuickFilterValue) {
    setQuickFilter(nextFilter);
    setPageOffset(0);
    if (nextFilter === "all") {
      setStatusFilter("all");
      setTypeFilter("all");
      setStockFilter("all");
      return;
    }
    if (nextFilter === "active" || nextFilter === "paused" || nextFilter === "under_review" || nextFilter === "error") {
      setStatusFilter(nextFilter);
      setTypeFilter("all");
      setStockFilter("all");
      return;
    }
    if (nextFilter === "without_stock") {
      setStatusFilter("all");
      setTypeFilter("all");
      setStockFilter("without_stock");
      return;
    }
    if (nextFilter === "premium" || nextFilter === "classico") {
      setStatusFilter("all");
      setTypeFilter(nextFilter);
      setStockFilter("all");
    }
  }

  function changeStatusFilter(nextStatus: string) {
    setStatusFilter(nextStatus);
    setPageOffset(0);
    if (nextStatus === "all") setQuickFilter(typeFilter === "premium" || typeFilter === "classico" ? typeFilter : stockFilter === "without_stock" ? "without_stock" : "all");
    else if ((nextStatus === "active" || nextStatus === "paused" || nextStatus === "under_review" || nextStatus === "error") && typeFilter === "all" && stockFilter === "all") setQuickFilter(nextStatus);
    else setQuickFilter("all");
  }

  function changeTypeFilter(nextType: string) {
    setTypeFilter(nextType);
    setPageOffset(0);
    setQuickFilter(nextType !== "all" && statusFilter === "all" && stockFilter === "all" && (nextType === "premium" || nextType === "classico") ? nextType : "all");
  }

  function changeStockFilter(nextStock: string) {
    setStockFilter(nextStock);
    setPageOffset(0);
    setQuickFilter(nextStock === "without_stock" && statusFilter === "all" && typeFilter === "all" ? "without_stock" : "all");
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setPageOffset(0);
  }

  function goToPreviousPage() {
    const nextOffset = Math.max(0, pageOffset - pageSize);
    if (hasActiveFilters) {
      setPageOffset(nextOffset);
      return;
    }
    void syncListings({ offset: nextOffset, limit: pageSize });
  }

  function goToNextPage() {
    const nextOffset = pageOffset + pageSize;
    if (hasActiveFilters) {
      setPageOffset(nextOffset);
      return;
    }
    void syncListings({ offset: nextOffset, limit: pageSize });
  }

  const pictureGalleryPictures = useMemo(() => (pictureGalleryListing ? listingGalleryPictures(pictureGalleryListing) : []), [pictureGalleryListing]);
  const selectedGalleryPicture = pictureGalleryPictures[pictureGalleryIndex] ?? null;

  useEffect(() => {
    if (!pictureGalleryListing) return;

    function handleGalleryKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPictureGalleryListing(null);
        setPictureGalleryIndex(0);
        return;
      }

      if (pictureGalleryPictures.length <= 1) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPictureGalleryIndex((current) => Math.max(0, current - 1));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPictureGalleryIndex((current) => Math.min(pictureGalleryPictures.length - 1, current + 1));
      }
    }

    window.addEventListener("keydown", handleGalleryKeyDown);
    return () => window.removeEventListener("keydown", handleGalleryKeyDown);
  }, [pictureGalleryListing, pictureGalleryPictures.length]);

  const selectedListingIds = selectedIds.size;
  const showClientSafeUi = true;
  const showTechnicalDetails = false;
  const canViewLocalDetails = showClientSafeUi;
  const userCanManageMercadoLivre = false;
  const externalWriteAvailable = Boolean((activeListingsPayload ?? listingsPayload)?.externalWrite);
  const canWriteMercadoLivre = externalWriteAvailable && userCanManageMercadoLivre;
  const canUseExternalWriteActions = canWriteMercadoLivre;
  const canUseFilters = canViewLocalDetails && isLocalReadOnlyAction("filters");
  const canUsePagination = canViewLocalDetails && isLocalReadOnlyAction("pagination");
  const canUseSearch = canViewLocalDetails && isLocalReadOnlyAction("search");
  const canOpenTechnicalSheet = canViewLocalDetails && isLocalReadOnlyAction("technicalSheet");
  const canOpenDescription = canViewLocalDetails && isLocalReadOnlyAction("description");
  const canOpenPictures = canViewLocalDetails && isLocalReadOnlyAction("pictures");
  const canOpenDimensions = canViewLocalDetails && isLocalReadOnlyAction("dimensions");
  const canOpenDetails = canViewLocalDetails && isLocalReadOnlyAction("details");
  const dimensionsCanEdit = Boolean(dimensionsPayload?.externalWrite && dimensionsPayload.canEdit);
  const dimensionsValidationError = validateDimensionsForm(dimensionsForm);
  const technicalSheetHasMeasures = technicalSheetTabHasMeasures(technicalSheetPayload);
  const technicalSheetSkuValues = useMemo(() => technicalSheetSkuCandidates(technicalSheetPayload), [technicalSheetPayload]);
  const technicalSheetMainFields = useMemo(
    () => buildTechnicalSheetMainFields(technicalSheetPayload, technicalSheetListing, technicalSheetSkuValues),
    [technicalSheetPayload, technicalSheetListing, technicalSheetSkuValues]
  );
  const technicalSheetMainAttributeIds = useMemo(() => mainTechnicalSheetAttributeIds(technicalSheetMainFields), [technicalSheetMainFields]);
  const orderedTechnicalSheetSections = useMemo(
    () => orderTechnicalSheetSections(technicalSheetPayload?.sections ?? [], technicalSheetSkuValues, technicalSheetMainAttributeIds),
    [technicalSheetPayload?.sections, technicalSheetSkuValues, technicalSheetMainAttributeIds]
  );

  function clearListingFilters() {
    setQuery("");
    setQuickFilter("all");
    setStatusFilter("all");
    setTypeFilter("all");
    setStockFilter("all");
    setPageOffset(0);
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
            <KpiCard label="Ativos" value={String(kpis.active)} hint={kpiScopeHint} tone="success" />
            <KpiCard label="Pausados" value={String(kpis.paused)} hint={kpiScopeHint} tone="warning" />
            <KpiCard label="Com erro" value={String(kpis.errors)} hint={filteredModeActive ? "Pendencias no filtro" : "Pendencias na pagina"} tone="danger" />
            <KpiCard label="Sem estoque" value={String(kpis.withoutStock)} hint={kpiScopeHint} tone="warning" />
            <KpiCard label="Vendas" value={String(kpis.sales)} hint={filteredModeActive ? "sold_quantity do filtro" : "sold_quantity da pagina"} tone="info" />
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
                    disabled={!canUseFilters}
                    onClick={() => changeQuickFilter(filter.value)}
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
                      disabled={!canUseSearch}
                      onChange={(event) => changeQuery(event.target.value)}
                      placeholder="Digite titulo, SKU, ID ML ou GTIN"
                      value={query}
                    />
                  </span>
                </label>
                <label className="text-sm text-matrix-muted">
                  Status
                  <select className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" disabled={!canUseFilters} onChange={(event) => changeStatusFilter(event.target.value)} value={statusFilter}>
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-matrix-muted">
                  Tipo
                  <select className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" disabled={!canUseFilters} onChange={(event) => changeTypeFilter(event.target.value)} value={typeFilter}>
                    {typeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-matrix-muted">
                  Estoque
                  <select className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" disabled={!canUseFilters} onChange={(event) => changeStockFilter(event.target.value)} value={stockFilter}>
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
                    disabled={!canUseFilters || !hasActiveFilters}
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
                {[
                  { id: "levelPrice", label: "Nivelar preco" },
                  { id: "levelStock", label: "Nivelar estoque" },
                  { id: "levelPictures", label: "Nivelar imagens" },
                  { id: "levelDimensions", label: "Nivelar dimensoes" },
                  { id: "pause", label: "Pausar" },
                  { id: "reactivate", label: "Reativar" }
                ].map((action) => {
                  const isExternalWrite = isWriteAction(action.id);
                  return (
                    <Button
                      key={action.id}
                      className="min-h-9 justify-between px-3 py-2 text-xs"
                      disabled={isExternalWrite || !canUseExternalWriteActions}
                      title={isExternalWrite && !canUseExternalWriteActions ? "Acao externa bloqueada" : "Em breve"}
                      type="button"
                      variant="secondary"
                    >
                      {action.label}
                      <Badge tone="muted">Em breve</Badge>
                    </Button>
                  );
                })}
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
                    {listingsCounterLabel({
                      current: filteredListings.length,
                      total: totalAvailable ?? filteredListings.length,
                      filtered: filteredModeActive,
                      subject: counterSubject
                    })}
                  </p>
                  {filteredModeActive ? (
                    <p className="text-xs text-matrix-gold">
                      {filteredListingsLoading
                        ? "Filtrando anuncios antes da paginacao..."
                        : `${totalAvailable ?? filteredListings.length} ${counterSubject}. Chave unica: ID ML.`}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-matrix-muted">
                <span>{`Pagina ${currentPage} de ${totalPages}`}</span>
                <select
                  className="rounded-md border border-matrix-border bg-matrix-panel px-2 py-1.5 text-matrix-fg outline-none"
                  disabled={!canUsePagination || syncing || filteredListingsLoading}
                  onChange={(event) => changePageSize(Number(event.target.value))}
                  value={pageSize}
                >
                  {pageSizeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} por pagina
                    </option>
                  ))}
                </select>
                <Button className="min-h-8 px-2 py-1 text-xs" disabled={!canUsePagination || syncing || filteredListingsLoading || !hasPreviousPage} onClick={goToPreviousPage} type="button" variant="secondary">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </Button>
                <Button className="min-h-8 px-2 py-1 text-xs" disabled={!canUsePagination || syncing || filteredListingsLoading || !hasNextPage} onClick={goToNextPage} type="button" variant="secondary">
                  Proxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {filteredListingsError ? (
              <div className="mb-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {filteredListingsError}
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
                        <ListingInfoChip icon={SlidersHorizontal} label="F. Tecnica" muted={!listing.categoryId} onClick={canOpenTechnicalSheet ? () => void openTechnicalSheet(listing) : undefined} title="Abrir ficha tecnica" />
                        <ListingInfoChip icon={FileText} label="Descricao" onClick={canOpenDescription ? () => setSelectedListing(listing) : undefined} title="Abrir detalhes do anuncio" />
                        <ListingInfoChip
                          icon={Ruler}
                          label={dimensionsChipLabel(listing)}
                          muted={!listing.dimensionInfo?.hasDimensions}
                          onClick={canOpenDimensions ? () => void openDimensionsEditor(listing) : undefined}
                          title="Abrir dimensoes do anuncio"
                        />
                        <ListingInfoChip
                          icon={ImageIcon}
                          label={`Fotos (${listingPicturesCount(listing)})`}
                          muted={listingPicturesCount(listing) === 0}
                          onClick={canOpenPictures ? () => openPictureGallery(listing) : undefined}
                          title={`Ver fotos do anuncio ${listing.externalId}`}
                        />
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
                        <Button type="button" variant="secondary" className="min-h-8 justify-center whitespace-nowrap px-2 py-1 text-xs" disabled={!canOpenDetails} onClick={() => setSelectedListing(listing)}>
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
                      {filteredListingsLoading
                        ? "Filtrando anuncios na conta Mercado Livre..."
                        : listings.length
                          ? "Nenhum anuncio corresponde aos filtros."
                          : "Sincronize os anuncios reais da conta conectada."}
                    </h4>
                    <p className="mt-2 text-sm text-matrix-muted">
                      {filteredListingsLoading
                        ? "Os filtros sao aplicados antes da paginacao e preservam itens diferentes pelo ID ML."
                        : listings.length
                        ? "Ajuste busca, abas ou filtros avancados para visualizar outros anuncios filtrados."
                        : "Clique em Sincronizar anuncios para carregar a conta conectada."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {shouldShowTechnicalField("listingDiagnostics", showTechnicalDetails) ? (
              <div className="hidden">
              <span>Ultima sincronizacao: {formatDate(listingsPayload?.lastSyncedAt ?? account?.lastSyncAt ?? null)}</span>
              {filteredModeActive ? (
                <span>
                  {totalAvailable ?? filteredListings.length} resultado(s) filtrados · {activeListingsPayload?.search?.scannedItemIds ?? 0} ID(s) analisado(s) · chave unica ID ML
                </span>
              ) : (
                <span>
                  {filteredListings.length} visiveis nesta pagina · offset {paging?.offset ?? pageOffset} · {pageSize} por pagina
                </span>
              )}
              </div>
            ) : null}
          </Card>
        </div>
      )}

      {loading ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-matrix-muted">
          <CheckCircle2 className="h-4 w-4 text-matrix-goldDark" />
          Verificando conexao Mercado Livre do cliente...
        </p>
      ) : null}

      {technicalSheetListing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 md:items-center">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-md border border-matrix-border bg-matrix-panel p-3 shadow-glow md:p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-matrix-fg">Ficha Tecnica do Anuncio</h3>
                <p className="mt-1 text-sm text-matrix-muted">Atributos da categoria e valores ja preenchidos no anuncio.</p>
              </div>
              <Button type="button" variant="ghost" onClick={closeTechnicalSheet}>
                <X className="h-4 w-4" />
                Fechar
              </Button>
            </div>

            <div className="mb-3 rounded-md border border-matrix-gold/20 bg-matrix-panel2/45 p-2.5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                {listingMainImage(technicalSheetListing) ? (
                  <img
                    alt={technicalSheetListing.title}
                    className="h-20 w-full rounded-md border border-matrix-border bg-white object-contain md:h-24 md:w-24"
                    src={listingMainImage(technicalSheetListing) ?? undefined}
                  />
                ) : (
                  <div className="grid h-20 w-full place-items-center rounded-md border border-dashed border-matrix-border text-xs text-matrix-muted md:h-24 md:w-24">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">Anuncio</p>
                  <h4 className="mt-1 line-clamp-2 text-base font-bold leading-5 text-matrix-fg">
                    {technicalSheetListing.title}
                  </h4>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-[minmax(70px,0.55fr)_minmax(120px,0.8fr)_minmax(95px,0.65fr)_minmax(220px,2fr)]">
                    <div className="min-w-0 border-matrix-border/70 sm:border-r sm:pr-3">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">SKU</dt>
                      <dd className="mt-1 truncate font-semibold text-matrix-fg">{fieldValue(technicalSheetListing.sku)}</dd>
                    </div>
                    <div className="min-w-0 border-matrix-border/70 sm:border-r sm:pr-3">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">ID ML</dt>
                      <dd className="mt-1 truncate font-mono font-semibold text-matrix-fg">{technicalSheetListing.externalId}</dd>
                    </div>
                    <div className="min-w-0 border-matrix-border/70 lg:border-r lg:pr-3">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">Preco atual</dt>
                      <dd className="mt-1 whitespace-nowrap font-semibold text-matrix-fg">{formatPrice(technicalSheetListing.price, technicalSheetListing.currencyId)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-matrix-muted">Categoria</dt>
                      <dd className="mt-1 line-clamp-2 text-matrix-fg">
                        {fieldValue(technicalSheetPayload?.category.path ?? technicalSheetPayload?.category.name ?? technicalSheetListing.categoryPath ?? technicalSheetListing.categoryName)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>

            <div className="min-w-0">
                {technicalSheetLoading ? (
                  <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-matrix-gold/25 bg-matrix-gold/10 px-3 py-2 text-sm text-matrix-fg">
                    <RefreshCw className="h-4 w-4 animate-spin text-matrix-gold" />
                    Carregando ficha tecnica completa...
                  </div>
                ) : null}

                {technicalSheetError ? (
                  <div className="mb-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {technicalSheetError}
                  </div>
                ) : null}

                {technicalSheetPayload ? (
                  <div className="grid gap-3">
                    {technicalSheetPayload.warnings.length ? (
                      <div className="rounded-md border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
                        {technicalSheetPayload.warnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2 border-b border-matrix-border pb-2">
                      <button
                        className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                          technicalSheetTab === "attributes"
                            ? "border-matrix-gold bg-matrix-gold text-black"
                            : "border-matrix-border bg-matrix-panel2/70 text-matrix-muted"
                        }`}
                        onClick={() => setTechnicalSheetTab("attributes")}
                        type="button"
                      >
                        Atributos do Anuncio
                      </button>
                      {technicalSheetHasMeasures ? (
                        <button
                          className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                            technicalSheetTab === "measures"
                              ? "border-matrix-gold bg-matrix-gold text-black"
                              : "border-matrix-border bg-matrix-panel2/70 text-matrix-muted"
                          }`}
                          onClick={() => setTechnicalSheetTab("measures")}
                          type="button"
                        >
                          Tabela de Medidas
                        </button>
                      ) : null}
                    </div>

                    <TechnicalSheetMainFields fields={technicalSheetMainFields} />

                    {technicalSheetTab === "attributes" ? (
                      <div className="grid gap-3">
                        {orderedTechnicalSheetSections.length ? (
                          orderedTechnicalSheetSections.map((section) => (
                            <DetailSection key={section.name} title={section.name}>
                              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                                {section.attributes.map((attribute) => (
                                  <TechnicalAttributeField key={attribute.id} attribute={attribute} />
                                ))}
                              </div>
                            </DetailSection>
                          ))
                        ) : (
                          <div className="rounded-md border border-dashed border-matrix-border bg-matrix-panel2/45 px-4 py-8 text-center text-sm text-matrix-muted">
                            Ficha tecnica nao disponivel nos dados carregados.
                          </div>
                        )}
                      </div>
                    ) : (
                      <DetailSection title="Tabela de Medidas">
                        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                          <DetailItem label="Dimensoes brutas" value={dimensionsLabel(technicalSheetPayload.listing as MercadoLivreClientListing)} />
                          <DetailItem label="Altura" value={fieldValue(technicalSheetPayload.listing.dimensionInfo?.heightCm)} />
                          <DetailItem label="Largura" value={fieldValue(technicalSheetPayload.listing.dimensionInfo?.widthCm)} />
                          <DetailItem label="Comprimento" value={fieldValue(technicalSheetPayload.listing.dimensionInfo?.lengthCm)} />
                          <DetailItem label="Peso" value={fieldValue(technicalSheetPayload.listing.dimensionInfo?.weightG)} />
                        </dl>
                        <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                          {technicalSheetPayload.attributes
                            .filter((attribute) => !isHiddenTechnicalSheetAttribute(attribute))
                            .filter((attribute) => {
                              const name = attribute.name
                                .normalize("NFD")
                                .replace(/[\u0300-\u036f]/g, "")
                                .toLowerCase();
                              return name.includes("medida") || name.includes("tamanho") || name.includes("altura") || name.includes("largura") || name.includes("comprimento") || name.includes("peso");
                            })
                            .map((attribute) => (
                              <TechnicalAttributeField key={attribute.id} attribute={attribute} />
                            ))}
                        </div>
                      </DetailSection>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-matrix-border bg-matrix-panel2/45 px-4 py-8 text-center text-sm text-matrix-muted">
                    Ficha tecnica nao disponivel nos dados carregados.
                  </div>
                )}
            </div>
          </div>
        </div>
      ) : null}

      {dimensionsListing ? (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/75 p-3 md:items-center">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-md border border-matrix-border bg-matrix-panel p-4 shadow-glow">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-matrix-fg">Dimensoes do Anuncio</h3>
                <p className="mt-1 text-sm text-matrix-muted">Consulta das medidas atuais do anuncio e impacto em frete/logistica.</p>
              </div>
              <Button aria-label="Fechar dimensoes do anuncio" type="button" variant="ghost" onClick={closeDimensionsEditor}>
                <X className="h-4 w-4" />
                Fechar
              </Button>
            </div>

            <div className="mb-4 flex flex-col gap-3 rounded-md border border-matrix-border bg-matrix-panel2/55 p-3 md:flex-row md:items-center">
              {listingMainImage(dimensionsListing) ? (
                <img
                  alt={dimensionsListing.title}
                  className="h-20 w-20 shrink-0 rounded-md border border-matrix-border bg-white object-contain"
                  src={listingMainImage(dimensionsListing) ?? undefined}
                />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md border border-dashed border-matrix-border text-matrix-muted">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.14em] text-matrix-muted">Anuncio</p>
                <h4 className="mt-1 text-base font-semibold leading-6 text-matrix-fg">{dimensionsListing.title}</h4>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="SKU" value={fieldValue(dimensionsListing.sku)} />
                  <DetailItem label="ID ML" value={dimensionsListing.externalId} mono />
                  <DetailItem label="Preco atual" value={formatPrice(dimensionsListing.price, dimensionsListing.currencyId)} />
                  <DetailItem label="Categoria" value={categoryLabel(dimensionsListing)} />
                </dl>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-matrix-border bg-matrix-panel2/45 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-matrix-fg">
                    {dimensionsPayload?.dimensions.hasDimensions ? "Dimensoes disponiveis" : "Dimensoes pendentes"}
                  </p>
                  <p className="mt-1 text-xs text-matrix-muted">
                    Dimensoes impactam frete, logistica e possiveis divergencias de cobranca.
                  </p>
                </div>
                <Badge tone={dimensionsPayload?.dimensions.hasDimensions ? "success" : "warning"}>
                  {dimensionsPayload?.dimensions.hasDimensions ? "Com dimensoes" : "Pendente"}
                </Badge>
              </div>

              {dimensionsLoading ? (
                <div className="inline-flex items-center gap-2 rounded-md border border-matrix-gold/25 bg-matrix-gold/10 px-3 py-2 text-sm text-matrix-fg">
                  <RefreshCw className="h-4 w-4 animate-spin text-matrix-gold" />
                  Carregando dimensoes atuais...
                </div>
              ) : null}

              {dimensionsError ? (
                <div className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {dimensionsError}
                </div>
              ) : null}

              {dimensionsSuccess ? (
                <div className="rounded-md border border-green-500/25 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                  {dimensionsSuccess}
                </div>
              ) : null}

              {!dimensionsLoading && !dimensionsPayload?.dimensions.hasDimensions ? (
                <div className="rounded-md border border-dashed border-matrix-border bg-matrix-panel2/45 px-4 py-8 text-center text-sm text-matrix-muted">
                  Dimensoes pendentes ou nao disponiveis nos dados carregados.
                </div>
              ) : null}

              <DetailSection title="Dimensoes carregadas">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { key: "widthCm", label: "Largura (cm)" },
                    { key: "heightCm", label: "Altura (cm)" },
                    { key: "lengthCm", label: "Profundidade / comprimento (cm)" },
                    { key: "weightGrams", label: "Peso (g)" }
                  ].map((field) => (
                    <label key={field.key} className="text-sm text-matrix-muted">
                      {field.label}
                      <input
                        className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none read-only:text-matrix-muted"
                        inputMode="decimal"
                        onChange={(event) =>
                          setDimensionsForm((current) => ({
                            ...current,
                            [field.key]: event.target.value
                          }))
                        }
                        readOnly={!dimensionsCanEdit || dimensionsSaving}
                        value={dimensionsForm[field.key as keyof Omit<DimensionsFormState, "packageMode">]}
                      />
                    </label>
                  ))}
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <DetailItem label="Dimensoes brutas" value={fieldValue(dimensionsPayload?.dimensions.raw)} />
                  <DetailItem label="Fonte" value={dimensionsPayload?.dimensions.hasDimensions ? "Mercado Livre" : "Dados carregados"} />
                  <DetailItem label="Frete" value={freightLabel(dimensionsListing)} />
                  <DetailItem label="Logistica" value={logisticsLabel(dimensionsListing)} />
                </dl>
              </DetailSection>

              <DetailSection title="Embalagem">
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    { value: "manufacturer", label: "Usar embalagem do fabricante" },
                    { value: "custom", label: "Usar embalagem propria" }
                  ].map((option) => (
                    <label key={option.value} className="flex items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2/45 px-3 py-2 text-sm text-matrix-fg">
                      <input
                        checked={dimensionsForm.packageMode === option.value}
                        disabled={!dimensionsCanEdit || dimensionsSaving}
                        onChange={() =>
                          setDimensionsForm((current) => ({
                            ...current,
                            packageMode: option.value as DimensionsFormState["packageMode"]
                          }))
                        }
                        type="radio"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-matrix-muted">
                  A opcao de embalagem fica local/visual nesta etapa; o envio ao Mercado Livre usa somente largura, altura, comprimento e peso.
                </p>
              </DetailSection>

              {!dimensionsCanEdit ? (
                <div className="rounded-md border border-matrix-border bg-matrix-panel2/45 px-3 py-2 text-sm text-matrix-muted">
                  Edicao de dimensoes esta bloqueada nesta fase. Os dados sao somente leitura.
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 border-t border-matrix-border pt-4">
                <Button onClick={closeDimensionsEditor} type="button" variant="secondary">
                  Fechar
                </Button>
                {dimensionsPayload?.externalWrite ? (
                  <Button
                    disabled={!dimensionsCanEdit || Boolean(dimensionsValidationError) || dimensionsSaving}
                    onClick={() => void saveDimensions()}
                    title={dimensionsValidationError || "Salvar dimensoes no Mercado Livre"}
                    type="button"
                  >
                    {dimensionsSaving ? "Salvando..." : "Salvar"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pictureGalleryListing ? (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/75 p-3 md:items-center">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-md border border-matrix-border bg-matrix-panel p-4 shadow-glow">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-matrix-fg">Fotos do Anuncio</h3>
                <p className="mt-1 text-sm text-matrix-muted">Imagens disponiveis nos dados carregados da listagem.</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button aria-label="Fechar galeria de fotos" type="button" variant="ghost" onClick={closePictureGallery}>
                  <X className="h-4 w-4" />
                  Fechar
                </Button>
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-3 rounded-md border border-matrix-border bg-matrix-panel2/55 p-3 md:flex-row md:items-center">
              {listingMainImage(pictureGalleryListing) ? (
                <img
                  alt={pictureGalleryListing.title}
                  className="h-20 w-20 shrink-0 rounded-md border border-matrix-border bg-white object-contain"
                  src={listingMainImage(pictureGalleryListing) ?? undefined}
                />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md border border-dashed border-matrix-border text-matrix-muted">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.14em] text-matrix-muted">Anuncio</p>
                <h4 className="mt-1 text-base font-semibold leading-6 text-matrix-fg">{pictureGalleryListing.title}</h4>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="SKU" value={fieldValue(pictureGalleryListing.sku)} />
                  <DetailItem label="ID ML" value={pictureGalleryListing.externalId} mono />
                  <DetailItem label="Preco atual" value={formatPrice(pictureGalleryListing.price, pictureGalleryListing.currencyId)} />
                  <DetailItem label="Fotos" value={`${pictureGalleryPictures.length} imagem(ns)`} />
                </dl>
              </div>
            </div>

            {pictureGalleryPictures.length ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px]">
                <div className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-md border border-matrix-gold/30 bg-matrix-goldSoft/18 px-2.5 py-1 text-xs font-semibold text-matrix-fg">
                      {pictureGalleryIndex + 1} de {pictureGalleryPictures.length}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        aria-label="Imagem anterior"
                        className="min-h-8 px-2 py-1 text-xs"
                        disabled={pictureGalleryPictures.length <= 1 || pictureGalleryIndex === 0}
                        onClick={() => setPictureGalleryIndex((current) => Math.max(0, current - 1))}
                        type="button"
                        variant="secondary"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Anterior
                      </Button>
                      <Button
                        aria-label="Proxima imagem"
                        className="min-h-8 px-2 py-1 text-xs"
                        disabled={pictureGalleryPictures.length <= 1 || pictureGalleryIndex >= pictureGalleryPictures.length - 1}
                        onClick={() => setPictureGalleryIndex((current) => Math.min(pictureGalleryPictures.length - 1, current + 1))}
                        type="button"
                        variant="secondary"
                      >
                        Proxima
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {selectedGalleryPicture ? (
                    <img
                      alt={`${pictureGalleryListing.title} - foto ${pictureGalleryIndex + 1}`}
                      className="h-[52vh] max-h-[620px] min-h-72 w-full rounded-md border border-matrix-border bg-white object-contain"
                      src={selectedGalleryPicture.url}
                    />
                  ) : null}
                </div>

                <div className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-3">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-matrix-muted">Miniaturas</p>
                  <div className="grid max-h-[58vh] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6 lg:grid-cols-1">
                    {pictureGalleryPictures.map((picture, index) => (
                      <button
                        key={`${picture.url}-${index}`}
                        aria-label={`Selecionar foto ${index + 1}`}
                        className={`rounded-md border bg-white p-1 transition focus:outline-none focus:ring-2 focus:ring-matrix-gold ${
                          pictureGalleryIndex === index ? "border-matrix-gold shadow-gold" : "border-matrix-border hover:border-matrix-gold/70"
                        }`}
                        onClick={() => setPictureGalleryIndex(index)}
                        type="button"
                      >
                        <img alt="" className="h-16 w-full object-contain lg:h-20" src={picture.url} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center rounded-md border border-dashed border-matrix-border bg-matrix-panel2/45 px-4 py-8 text-center">
                <div>
                  <ImageIcon className="mx-auto h-9 w-9 text-matrix-goldDark" />
                  <h4 className="mt-3 font-semibold text-matrix-fg">Fotos nao disponiveis nos dados carregados</h4>
                  <p className="mt-2 max-w-md text-sm text-matrix-muted">Sincronize a listagem para atualizar os dados locais deste item.</p>
                </div>
              </div>
            )}
          </div>
        </div>
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
                  </dl>
                </DetailSection>

                <DetailSection title="Frete e logistica">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <DetailItem label="Resumo" value={shippingLabel(selectedListing)} />
                    <DetailItem label="Frete" value={freightLabel(selectedListing)} />
                    <DetailItem label="Logistica" value={logisticsLabel(selectedListing)} />
                    <DetailItem label="Frete informado pelo ML" value={shippingCostLabel(selectedListing)} />
                    <DetailItem label="Quem paga" value={shippingPayerLabel(selectedListing)} />
                    <DetailItem label="Retirada local" value={localPickupLabel(selectedListing)} />
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
                  </dl>
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
