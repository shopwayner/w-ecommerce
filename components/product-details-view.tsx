"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Box,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Factory,
  FileText,
  Folder,
  Globe2,
  GripVertical,
  ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  Minimize2,
  Package,
  Ruler,
  Save,
  Scale,
  ShieldCheck,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { Button } from "@/components/ui";
import { ProductDescriptionEditor } from "@/components/product-description-editor";
import { INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES } from "@/lib/intelligent-product-preview";
import { normalizeMercadoLivreReferenceImageUrl } from "@/lib/mercado-livre-reference-images";
import { sanitizeProductDescription } from "@/lib/product-description";
import { isOptimizableProductImageUrl } from "@/lib/product-image-optimization";
import {
  applyProductTitleSuggestion,
  buildProductDetailsPatch,
  createProductDetailsEditForm,
  PRODUCT_DETAILS_NAME_MAX_LENGTH,
  productDetailsFieldDefinitions,
  type ProductDetailsEditForm,
  type ProductDetailsFieldId
} from "@/lib/product-details-edit";

const MercadoLivrePhotoSearchModal = dynamic(
  () => import("@/components/mercado-livre-photo-search-modal")
    .then((module) => module.MercadoLivrePhotoSearchModal),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[85] grid place-items-center bg-black/70 p-4 text-sm text-matrix-muted">
        Carregando busca de fotos...
      </div>
    )
  }
);

type ProductDetailsImage = {
  id: string;
  url: string;
  position: number;
  pending?: boolean;
};

export type ProductDetailsProduct = {
  id: string;
  name: string;
  sku: string | null;
  ean: string | null;
  description: string | null;
  category: string | null;
  brand?: string | null;
  origin: string | null;
  unit: string | null;
  status: string;
  source?: string | null;
  displayValue: string | null;
  salePriceDisplay: string | null;
  costPriceDisplay?: string | null;
  imageUrl: string | null;
  images?: ProductDetailsImage[];
  weight?: string | null;
  grossWeight?: string | null;
  height?: string | null;
  width?: string | null;
  depth?: string | null;
  dimensionUnit?: string | null;
  condition?: string | null;
  format?: string | null;
  productType?: string | null;
  commercialStatus?: string | null;
  productionType?: string | null;
  expirationDate?: string | null;
  freeShipping?: boolean | null;
  volumes?: number | null;
  itemsPerBox?: string | null;
  packagingGtin?: string | null;
  attributes?: unknown;
  blingStatus?: string | null;
  blingAccount: {
    blingAccountId?: string;
    blingAccountName: string | null;
    displayName: string | null;
  } | null;
  price: string;
  stock: number;
  updatedAt: string;
};

const statusLabels: Record<string, string> = {
  READY_FOR_TEST: "Pronto para teste",
  DRAFT: "Rascunho"
};

const descriptionAiErrorMessages: Record<string, string> = {
  OPENAI_DESCRIPTION_DISABLED:
    "A geração por IA não está disponível neste ambiente.",
  OPENAI_DESCRIPTION_CONFIGURATION_UNAVAILABLE:
    "A geração por IA não está configurada neste ambiente.",
  OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE:
    "Não há informações suficientes para gerar uma descrição segura deste produto.",
  OPENAI_DESCRIPTION_NUMERIC_FACT_UNSUPPORTED:
    "A IA gerou uma especificação numérica que não pôde ser confirmada pelos dados do produto.",
  OPENAI_DESCRIPTION_PACKAGE_CONTENT_UNSUPPORTED:
    "O conteúdo da embalagem gerado não pôde ser confirmado.",
  OPENAI_DESCRIPTION_INVALID_SCHEMA:
    "A descrição gerada não seguiu o formato exigido pelo sistema.",
  OPENAI_DESCRIPTION_UNKNOWN_SECTION:
    "A resposta gerada incluiu uma seção não permitida.",
  OPENAI_DESCRIPTION_EMPTY_SECTION:
    "A resposta gerada contém uma seção inválida ou vazia.",
  OPENAI_DESCRIPTION_HTML_NOT_ALLOWED:
    "A resposta gerada contém formatação não permitida.",
  OPENAI_DESCRIPTION_MARKDOWN_NOT_ALLOWED:
    "A resposta gerada contém formatação não permitida.",
  OPENAI_DESCRIPTION_HEADING_NOT_ALLOWED:
    "A resposta gerada incluiu um título de seção não permitido.",
  OPENAI_DESCRIPTION_FORBIDDEN_CONTENT:
    "A resposta gerada contém conteúdo que não pode ser aplicado com segurança.",
  OPENAI_DESCRIPTION_LENGTH_INVALID:
    "A resposta gerada possui um tamanho inválido.",
  OPENAI_DESCRIPTION_VALIDATION_FAILED:
    "A resposta gerada não pôde ser validada com segurança.",
  OPENAI_DESCRIPTION_TIMEOUT:
    "A geração demorou mais que o esperado. Tente novamente em alguns instantes.",
  OPENAI_DESCRIPTION_RATE_LIMITED:
    "O limite temporário de gerações foi atingido. Aguarde antes de tentar novamente."
};

function descriptionAiErrorMessage(
  code: string | undefined,
  retryAfterSeconds?: number
) {
  if (
    code === "OPENAI_DESCRIPTION_RATE_LIMITED" &&
    Number.isFinite(retryAfterSeconds) &&
    Number(retryAfterSeconds) > 0
  ) {
    const seconds = Math.ceil(Number(retryAfterSeconds));
    if (seconds < 60) {
      return `O limite temporário de gerações foi atingido. Tente novamente em ${seconds} ${seconds === 1 ? "segundo" : "segundos"}.`;
    }
    const minutes = Math.ceil(seconds / 60);
    return `O limite temporário de gerações foi atingido. Tente novamente em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
  }
  return code
    ? descriptionAiErrorMessages[code] ??
        "Não foi possível gerar a descrição agora. Tente novamente."
    : "Não foi possível gerar a descrição agora. Tente novamente.";
}

class ProductDescriptionAiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductDescriptionAiRequestError";
  }
}

const conditionAliases = ["condition", "item_condition", "ITEM_CONDITION", "condicao"];
const grossWeightAliases = ["grossWeight", "gross_weight", "grossWeightKg", "pesoBruto", "peso_bruto"];

function normalizeAttributeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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

function displayText(value: string | number | null | undefined, emptyLabel = "Nao informado") {
  if (value === null || value === undefined) return emptyLabel;
  const text = String(value).trim();
  return text || emptyLabel;
}

function formatCurrency(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return "Nao informado";
  if (/^R\$/i.test(raw)) return raw;
  const normalized = raw.replace(/[^\d,.-]/g, "");
  const parsed = Number(normalized.includes(",") ? normalized.replace(/\./g, "").replace(",", ".") : normalized);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : raw;
}

function formatMeasurement(value: string | number | null | undefined, unit: string) {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  if (!raw) return "Nao informado";
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  if (!Number.isFinite(parsed)) return `${raw} ${unit}`;
  return `${parsed.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;
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

function dimensionUnitAbbreviation(value: string | null | undefined) {
  if (value === "METER") return "m";
  if (value === "MILLIMETER") return "mm";
  return "cm";
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

const productFormatLabels: Record<string, string> = {
  SIMPLE: "Simples",
  VARIATION: "Com variacoes",
  COMPOSITION: "Com composicao"
};

const productTypeLabels: Record<string, string> = {
  PRODUCT: "Produto",
  SERVICE: "Servico",
  SERVICE_06_21_22: "Servico 06 21 22"
};

const commercialStatusLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo"
};

const productionTypeLabels: Record<string, string> = {
  OWN: "Propria",
  THIRD_PARTY: "Terceiros"
};

const productDetailsCardClass = "rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3";
const productDetailsInputClass = "mt-2 h-10 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 text-sm font-semibold text-matrix-fg outline-none transition focus:border-matrix-gold/70 focus:ring-2 focus:ring-matrix-gold/20";

const productDetailsIcons: Record<ProductDetailsFieldId, typeof Package> = {
  name: Package,
  brand: Factory,
  sku: Tag,
  ean: Barcode,
  unit: ClipboardList,
  category: Folder,
  origin: Globe2,
  blingStatus: ShieldCheck,
  format: Package,
  productType: Tag,
  commercialStatus: ShieldCheck,
  costPrice: DollarSign,
  salePrice: Tag,
  stock: Box,
  weight: Scale,
  grossWeight: Scale,
  condition: ShieldCheck,
  height: Ruler,
  width: Ruler,
  depth: Ruler,
  productionType: Factory,
  expirationDate: CalendarDays,
  freeShipping: Globe2,
  volumes: Box,
  itemsPerBox: Package,
  dimensionUnit: Ruler,
  packagingGtin: Barcode,
  updatedAt: CalendarDays
};

const dimensionUnitLabels: Record<string, string> = {
  METER: "Metro",
  CENTIMETER: "Centimetro",
  MILLIMETER: "Milimetro"
};

function getCondition(product: ProductDetailsProduct) {
  return product.condition ?? productAttributeValue(product.attributes, conditionAliases);
}

function getGrossWeight(product: ProductDetailsProduct) {
  return product.grossWeight ?? productAttributeValue(product.attributes, grossWeightAliases);
}

function formFromProduct(product: ProductDetailsProduct): ProductDetailsEditForm {
  return createProductDetailsEditForm({
    name: product.name,
    brand: product.brand,
    ean: product.ean,
    unit: product.unit,
    category: product.category,
    costPrice: product.costPriceDisplay ?? product.displayValue,
    salePrice: product.salePriceDisplay ?? product.price,
    weight: product.weight,
    grossWeight: getGrossWeight(product),
    height: product.height,
    width: product.width,
    depth: product.depth,
    condition: getCondition(product),
    format: product.format,
    productType: product.productType,
    commercialStatus: product.commercialStatus,
    productionType: product.productionType,
    expirationDate: product.expirationDate,
    freeShipping: product.freeShipping,
    volumes: product.volumes,
    itemsPerBox: product.itemsPerBox,
    dimensionUnit: product.dimensionUnit,
    packagingGtin: product.packagingGtin,
    description: sanitizeProductDescription(product.description)
  });
}

function orderedImages(product: ProductDetailsProduct) {
  if (product.images?.length) {
    return [...product.images]
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((image) => ({ ...image, pending: false }));
  }
  return product.imageUrl ? [{ id: "preview-image", url: product.imageUrl, position: 0, pending: true }] : [];
}

function imageStateKey(image: ProductDetailsImage) {
  return image.pending ? `new:${image.url}` : `existing:${image.id}`;
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getBlingName(product: ProductDetailsProduct) {
  return product.blingAccount?.displayName ?? product.blingAccount?.blingAccountName ?? null;
}

function getBlingStatusLabel(status: string | null | undefined) {
  const normalized = status?.trim().toUpperCase();
  if (normalized === "ACTIVE") return "Ativo no Bling";
  if (normalized === "INACTIVE") return "Inativo no Bling";
  if (normalized === "DELETED") return "Excluido no Bling";
  return "Status do Bling nao confirmado";
}

const ProductNameEditor = memo(forwardRef<HTMLInputElement, {
  disabled: boolean;
  initialValue: string;
  onDraftChange: (value: string) => void;
  resetKey: number;
}>(function ProductNameEditor({
  disabled,
  initialValue,
  onDraftChange,
  resetKey
}, ref) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue, resetKey]);

  return (
    <>
      <input
        className={productDetailsInputClass}
        disabled={disabled}
        id="product-details-name"
        maxLength={PRODUCT_DETAILS_NAME_MAX_LENGTH}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          onDraftChange(nextValue);
        }}
        ref={ref}
        type="text"
        value={value}
      />
      <span className={`mt-1 block text-right text-xs ${value.length >= 55 ? "text-matrix-goldDark" : "text-matrix-muted"}`}>
        {value.length}/{PRODUCT_DETAILS_NAME_MAX_LENGTH}
      </span>
    </>
  );
}));

const ProductTitleAiTrigger = memo(function ProductTitleAiTrigger({
  disabled,
  loading,
  onClick
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <span className="group/title-ai relative inline-flex shrink-0">
      <button
        aria-describedby="product-title-ai-tooltip"
        aria-label="Melhorar título com IA"
        className="inline-flex h-8 min-w-[3.5rem] shrink-0 items-center justify-center rounded-md border border-matrix-gold/35 bg-matrix-goldSoft/25 px-2.5 text-xs font-bold text-matrix-goldDark transition hover:border-matrix-gold/70 hover:bg-matrix-goldSoft/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold disabled:cursor-not-allowed disabled:opacity-55"
        disabled={disabled}
        onClick={onClick}
        title="Melhorar título com IA"
        type="button"
      >
        {loading ? "✦ IA..." : "✦ IA"}
      </button>
      <span
        className="pointer-events-none invisible absolute right-0 top-full z-30 mt-2 w-max max-w-[min(15rem,calc(100vw-2rem))] rounded-md border border-matrix-border bg-matrix-panel px-2.5 py-1.5 text-xs font-medium text-matrix-fg opacity-0 shadow-glow transition group-hover/title-ai:visible group-hover/title-ai:opacity-100 group-focus-within/title-ai:visible group-focus-within/title-ai:opacity-100"
        id="product-title-ai-tooltip"
        role="tooltip"
      >
        Melhorar título com IA
      </span>
    </span>
  );
});

const ProductDescriptionAiTrigger = memo(function ProductDescriptionAiTrigger({
  disabled,
  loading,
  onClick
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <span className="group/description-ai relative inline-flex shrink-0">
      <button
        aria-describedby="product-description-ai-tooltip"
        aria-label="Gerar descrição com IA"
        className="inline-flex h-8 min-w-[3.5rem] shrink-0 items-center justify-center rounded-md border border-matrix-gold/35 bg-matrix-goldSoft/25 px-2.5 text-xs font-bold text-matrix-goldDark transition hover:border-matrix-gold/70 hover:bg-matrix-goldSoft/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold disabled:cursor-not-allowed disabled:opacity-55"
        disabled={disabled}
        onClick={onClick}
        title="Gerar descrição com IA"
        type="button"
      >
        {loading ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" />Gerando...</>
        ) : "✦ IA"}
      </button>
      <span
        className="pointer-events-none invisible absolute right-0 top-full z-30 mt-2 w-max max-w-[min(15rem,calc(100vw-2rem))] rounded-md border border-matrix-border bg-matrix-panel px-2.5 py-1.5 text-xs font-medium text-matrix-fg opacity-0 shadow-glow transition group-hover/description-ai:visible group-hover/description-ai:opacity-100 group-focus-within/description-ai:visible group-focus-within/description-ai:opacity-100"
        id="product-description-ai-tooltip"
        role="tooltip"
      >
        Gerar descrição com IA
      </span>
    </span>
  );
});

const ProductDetailsFieldsGrid = memo(function ProductDetailsFieldsGrid({
  aiDisabled,
  aiError,
  aiLoading,
  canEditProduct,
  detailValues,
  editing,
  form,
  nameInputRef,
  nameResetKey,
  onFieldChange,
  onNameDraftChange,
  onOpenTitleAi
}: {
  aiDisabled: boolean;
  aiError: string | null;
  aiLoading: boolean;
  canEditProduct: boolean;
  detailValues: Record<ProductDetailsFieldId, string | number | null | undefined>;
  editing: boolean;
  form: ProductDetailsEditForm;
  nameInputRef: MutableRefObject<HTMLInputElement | null>;
  nameResetKey: number;
  onFieldChange: (key: keyof ProductDetailsEditForm, value: string) => void;
  onNameDraftChange: (value: string) => void;
  onOpenTitleAi: () => void;
}) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {productDetailsFieldDefinitions.map((field) => {
        const Icon = productDetailsIcons[field.id];
        if (editing && field.editable) {
          const formKey = field.id as keyof ProductDetailsEditForm;
          const inputId = `product-details-${field.id}`;
          return (
            <div key={field.id} className="contents">
              {field.sectionTitle ? <h3 className="mt-2 text-xs font-semibold uppercase text-matrix-goldDark sm:col-span-2 xl:col-span-3">{field.sectionTitle}</h3> : null}
              <div className={productDetailsCardClass}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <label className="flex min-w-0 items-center gap-2 text-xs text-matrix-muted" htmlFor={inputId}><Icon className="h-4 w-4 shrink-0 text-matrix-goldDark" />{field.label}</label>
                  {field.id === "name" ? <ProductTitleAiTrigger disabled={aiDisabled} loading={aiLoading} onClick={onOpenTitleAi} /> : null}
                </div>
                {field.id === "name" ? (
                  <>
                    <ProductNameEditor
                      disabled={false}
                      initialValue={form.name}
                      onDraftChange={onNameDraftChange}
                      ref={nameInputRef}
                      resetKey={nameResetKey}
                    />
                    {aiError ? (
                      <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
                        {aiError}
                      </p>
                    ) : null}
                  </>
                ) : field.id === "condition" ? (
                  <select className={productDetailsInputClass} id={inputId} onChange={(event) => onFieldChange("condition", event.target.value)} value={form.condition}>
                    <option value="">Nao informado</option>
                    <option value="NEW">Novo</option>
                    <option value="USED">Usado</option>
                    <option value="UNSPECIFIED">Nao especificado</option>
                  </select>
                ) : field.options ? (
                  <select
                    className={productDetailsInputClass}
                    id={inputId}
                    onChange={(event) => onFieldChange(formKey, event.target.value)}
                    value={form[formKey]}
                  >
                    {field.options.map((option) => (
                      <option key={option.value || "empty"} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={productDetailsInputClass}
                    id={inputId}
                    inputMode={field.inputMode}
                    maxLength={field.id === "brand"
                      ? 120
                      : field.id === "packagingGtin"
                        ? 13
                        : undefined}
                    min={field.inputType === "number" ? 0 : undefined}
                    onChange={(event) => onFieldChange(formKey, event.target.value)}
                    placeholder={field.placeholder}
                    step={field.id === "volumes" ? 1 : field.inputType === "number" ? "any" : undefined}
                    type={field.inputType ?? "text"}
                    value={form[formKey]}
                  />
                )}
              </div>
            </div>
          );
        }
        return (
          <div key={field.id} className="contents">
            {field.sectionTitle ? <h3 className="mt-2 text-xs font-semibold uppercase text-matrix-goldDark sm:col-span-2 xl:col-span-3">{field.sectionTitle}</h3> : null}
            <div className={productDetailsCardClass}>
              <div className="flex gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-matrix-goldDark" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <p className="min-w-0 text-xs text-matrix-muted">{field.label}</p>
                    {field.id === "name" && canEditProduct ? <ProductTitleAiTrigger disabled={aiDisabled} loading={aiLoading} onClick={onOpenTitleAi} /> : null}
                  </div>
                  <p className="mt-1 break-words text-sm font-semibold">{displayText(detailValues[field.id], field.placeholder)}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

const ProductMainImage = memo(function ProductMainImage({
  image,
  productName
}: {
  image: ProductDetailsImage | null;
  productName: string;
}) {
  return (
    <div className="grid aspect-[4/3] max-h-[52dvh] w-full place-items-center overflow-hidden rounded-lg border border-matrix-border bg-white text-matrix-muted">
      {image ? (
        <Image
          alt={productName}
          className="h-full w-full object-contain"
          decoding="async"
          height={720}
          priority
          src={image.url}
          unoptimized
          width={960}
        />
      ) : (
        <div className="px-6 py-12 text-center"><ImageIcon className="mx-auto h-10 w-10 text-matrix-goldDark" /><p className="mt-3 font-semibold">Produto sem imagem</p></div>
      )}
    </div>
  );
});

const ProductGallery = memo(function ProductGallery({
  dragOverImageId,
  draggedImageId,
  editing,
  images,
  onMakePrimary,
  onMoveImage,
  onOpenPhotoSearch,
  onRemoveImage,
  onReorderImage,
  onSelectImage,
  pointerDragImageId,
  productName,
  selectedImageId,
  setDragOverImageId,
  setDraggedImageId
}: {
  dragOverImageId: string | null;
  draggedImageId: string | null;
  editing: boolean;
  images: ProductDetailsImage[];
  onMakePrimary: (imageId: string) => void;
  onMoveImage: (imageId: string, offset: number) => void;
  onOpenPhotoSearch: () => void;
  onRemoveImage: (imageId: string) => void;
  onReorderImage: (fromId: string, toId: string) => void;
  onSelectImage: (imageId: string) => void;
  pointerDragImageId: MutableRefObject<string | null>;
  productName: string;
  selectedImageId: string | null;
  setDragOverImageId: (imageId: string | null) => void;
  setDraggedImageId: (imageId: string | null) => void;
}) {
  const selectedImage = images.find((image) => image.id === selectedImageId) ?? images[0] ?? null;

  return (
    <section className="order-2 min-w-0 lg:order-1">
      <ProductMainImage image={selectedImage} productName={productName} />

      {images.length ? (
        <div className="matrix-scroll mt-2 flex gap-2 overflow-x-auto pb-2" aria-label="Galeria de imagens">
          {images.map((image, index) => (
            <div
              key={image.id}
              className={`group relative w-[76px] shrink-0 rounded-lg border-2 bg-white p-1 transition ${selectedImageId === image.id ? "border-matrix-gold" : "border-matrix-border"} ${dragOverImageId === image.id ? "ring-2 ring-matrix-gold" : ""} ${draggedImageId === image.id ? "opacity-45" : ""}`}
              draggable={editing}
              onDragEnd={() => {
                pointerDragImageId.current = null;
                setDraggedImageId(null);
                setDragOverImageId(null);
              }}
              onDragOver={(event) => {
                if (!editing) return;
                event.preventDefault();
                setDragOverImageId(image.id);
              }}
              onDragStart={(event) => {
                if (!editing) return;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", image.id);
                pointerDragImageId.current = image.id;
                setDraggedImageId(image.id);
              }}
              onPointerEnter={() => {
                if (pointerDragImageId.current) setDragOverImageId(image.id);
              }}
              onPointerUp={() => {
                const sourceImageId = pointerDragImageId.current;
                if (sourceImageId) onReorderImage(sourceImageId, image.id);
                pointerDragImageId.current = null;
                setDraggedImageId(null);
                setDragOverImageId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceImageId = event.dataTransfer.getData("text/plain") || pointerDragImageId.current || draggedImageId;
                if (sourceImageId) onReorderImage(sourceImageId, image.id);
                pointerDragImageId.current = null;
                setDraggedImageId(null);
                setDragOverImageId(null);
              }}
            >
              <button aria-label={`Visualizar imagem ${index + 1}`} className={`block h-16 w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold ${editing ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`} onClick={() => onSelectImage(image.id)} type="button">
                <Image
                  alt={`Imagem ${index + 1} de ${productName}`}
                  className="h-full w-full object-contain"
                  decoding="async"
                  height={72}
                  loading="lazy"
                  sizes="72px"
                  src={image.url}
                  unoptimized={!isOptimizableProductImageUrl(image.url)}
                  width={72}
                />
              </button>
              {index === 0 ? <span className="absolute bottom-1 left-1 rounded bg-matrix-gold px-1.5 py-0.5 text-[9px] font-bold text-black">Principal</span> : null}
              {editing ? (
                <>
                  <button aria-label="Remover imagem" className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-red-600 text-white opacity-100 shadow transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" onClick={(event) => { event.stopPropagation(); onRemoveImage(image.id); }} type="button"><X className="h-4 w-4" /></button>
                  <div className="mt-1 flex items-center justify-center gap-1 bg-white">
                    <button aria-label={`Mover imagem ${index + 1} para a esquerda`} className="grid h-7 w-7 place-items-center rounded border border-zinc-300 text-zinc-700 disabled:opacity-30" disabled={index === 0} onClick={() => onMoveImage(image.id, -1)} type="button"><ChevronLeft className="h-4 w-4" /></button>
                    <button
                      aria-label={`Arrastar imagem ${index + 1}`}
                      className="grid h-7 w-5 touch-none cursor-grab place-items-center text-zinc-500 active:cursor-grabbing"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        pointerDragImageId.current = image.id;
                        setDraggedImageId(image.id);
                        setDragOverImageId(image.id);
                      }}
                      type="button"
                    >
                      <GripVertical className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button aria-label={`Mover imagem ${index + 1} para a direita`} className="grid h-7 w-7 place-items-center rounded border border-zinc-300 text-zinc-700 disabled:opacity-30" disabled={index === images.length - 1} onClick={() => onMoveImage(image.id, 1)} type="button"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {editing ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Button onClick={onOpenPhotoSearch} type="button" variant="secondary"><ImagePlus className="h-4 w-4" />Buscar fotos no Mercado Livre</Button>
          {selectedImage && images[0]?.id !== selectedImage.id ? <Button onClick={() => onMakePrimary(selectedImage.id)} type="button" variant="secondary">Definir como principal</Button> : <span className="hidden sm:block" />}
        </div>
      ) : null}
    </section>
  );
});

export function ProductDetailsView<T extends ProductDetailsProduct>({
  canEditProduct,
  initialEditing = false,
  product,
  onBack,
  onProductUpdated,
  saveProduct
}: {
  canEditProduct: boolean;
  initialEditing?: boolean;
  product: T;
  onBack: () => void;
  onProductUpdated: (product: T) => void;
  saveProduct?: (productId: string, payload: unknown) => Promise<T>;
}) {
  const [currentProduct, setCurrentProduct] = useState<T>(product);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [editing, setEditing] = useState(initialEditing && canEditProduct);
  const [form, setForm] = useState<ProductDetailsEditForm>(() => formFromProduct(product));
  const [dirtyFields, setDirtyFields] = useState<Set<keyof ProductDetailsEditForm>>(() => new Set());
  const [nameEditorResetKey, setNameEditorResetKey] = useState(0);
  const [descriptionEditorResetKey, setDescriptionEditorResetKey] = useState(0);
  const [nameIsValid, setNameIsValid] = useState(() => {
    const length = formFromProduct(product).name.trim().length;
    return length >= 2 && length <= PRODUCT_DETAILS_NAME_MAX_LENGTH;
  });
  const [images, setImages] = useState<ProductDetailsImage[]>(() => orderedImages(product));
  const [baselineImageIds, setBaselineImageIds] = useState<string[]>(() => (product.images ?? []).map((image) => image.id));
  const [baselineImageKeys, setBaselineImageKeys] = useState<string[]>(() => orderedImages(product).map(imageStateKey));
  const [selectedImageId, setSelectedImageId] = useState<string | null>(() => orderedImages(product)[0]?.id ?? null);
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [dragOverImageId, setDragOverImageId] = useState<string | null>(null);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchingMercadoLivrePhotos, setSearchingMercadoLivrePhotos] = useState(false);
  const [titleAiLoading, setTitleAiLoading] = useState(false);
  const [titleAiError, setTitleAiError] = useState<string | null>(null);
  const [descriptionAiLoading, setDescriptionAiLoading] = useState(false);
  const [descriptionAiError, setDescriptionAiError] = useState<string | null>(null);
  const [descriptionAiNotice, setDescriptionAiNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const pointerDragImageId = useRef<string | null>(null);
  const titleAiRequest = useRef<AbortController | null>(null);
  const descriptionAiRequest = useRef<AbortController | null>(null);
  const generatedTitleHistory = useRef<Set<string>>(new Set());
  const generatedDescriptionHistory = useRef<Set<string>>(new Set());
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameDraftRef = useRef(form.name);
  const descriptionDraftRef = useRef(form.description);
  const resetTitleAiSession = useCallback(() => {
    titleAiRequest.current?.abort();
    titleAiRequest.current = null;
    generatedTitleHistory.current.clear();
    setTitleAiLoading(false);
    setTitleAiError(null);
  }, []);
  const resetDescriptionAiSession = useCallback(() => {
    descriptionAiRequest.current?.abort();
    descriptionAiRequest.current = null;
    generatedDescriptionHistory.current.clear();
    setDescriptionAiLoading(false);
    setDescriptionAiError(null);
    setDescriptionAiNotice(null);
  }, []);

  const baselineForm = useMemo(() => formFromProduct(currentProduct), [currentProduct]);
  const currentImageKeys = useMemo(() => images.map(imageStateKey), [images]);
  const hasPendingChanges = editing && (
    dirtyFields.size > 0 || !arraysEqual(currentImageKeys, baselineImageKeys)
  );

  const requestClose = useCallback(() => {
    if (saving) return;
    if (hasPendingChanges) {
      setConfirmingDiscard(true);
      return;
    }
    onBack();
  }, [hasPendingChanges, onBack, saving]);

  useEffect(() => {
    return () => {
      titleAiRequest.current?.abort();
      descriptionAiRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (searchingMercadoLivrePhotos) return setSearchingMercadoLivrePhotos(false);
      if (confirmingSave) return setConfirmingSave(false);
      if (confirmingDiscard) return setConfirmingDiscard(false);
      requestClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmingDiscard, confirmingSave, requestClose, searchingMercadoLivrePhotos]);

  const statusText = statusLabels[currentProduct.status] ?? displayText(currentProduct.status);
  const originText = displayText(currentProduct.origin ?? currentProduct.source ?? (getBlingName(currentProduct) ? "BLING" : null));
  const description = sanitizeProductDescription(currentProduct.description);
  const dimensionUnit = dimensionUnitAbbreviation(currentProduct.dimensionUnit);

  const detailValues = useMemo<Record<ProductDetailsFieldId, string | number | null | undefined>>(() => ({
    name: currentProduct.name,
    brand: currentProduct.brand,
    sku: currentProduct.sku,
    ean: currentProduct.ean,
    unit: currentProduct.unit,
    category: currentProduct.category,
    origin: originText,
    blingStatus: getBlingStatusLabel(currentProduct.blingStatus),
    format: currentProduct.format ? productFormatLabels[currentProduct.format] ?? currentProduct.format : null,
    productType: currentProduct.productType ? productTypeLabels[currentProduct.productType] ?? currentProduct.productType : null,
    commercialStatus: currentProduct.commercialStatus
      ? commercialStatusLabels[currentProduct.commercialStatus] ?? currentProduct.commercialStatus
      : null,
    costPrice: formatCurrency(currentProduct.costPriceDisplay ?? currentProduct.displayValue),
    salePrice: formatCurrency(currentProduct.salePriceDisplay),
    stock: currentProduct.stock,
    weight: formatMeasurement(currentProduct.weight, "kg"),
    grossWeight: formatMeasurement(getGrossWeight(currentProduct), "kg"),
    condition: getCondition(currentProduct),
    height: formatMeasurement(currentProduct.height, dimensionUnit),
    width: formatMeasurement(currentProduct.width, dimensionUnit),
    depth: formatMeasurement(currentProduct.depth, dimensionUnit),
    productionType: currentProduct.productionType
      ? productionTypeLabels[currentProduct.productionType] ?? currentProduct.productionType
      : null,
    expirationDate: formatDateOnly(currentProduct.expirationDate),
    freeShipping: currentProduct.freeShipping === null || currentProduct.freeShipping === undefined
      ? null
      : currentProduct.freeShipping
        ? "Sim"
        : "Nao",
    volumes: currentProduct.volumes,
    itemsPerBox: currentProduct.itemsPerBox,
    dimensionUnit: currentProduct.dimensionUnit
      ? dimensionUnitLabels[currentProduct.dimensionUnit] ?? currentProduct.dimensionUnit
      : null,
    packagingGtin: currentProduct.packagingGtin,
    updatedAt: formatDate(currentProduct.updatedAt)
  }), [currentProduct, dimensionUnit, originText]);

  const updateDirtyField = useCallback((key: keyof ProductDetailsEditForm, value: string) => {
    setDirtyFields((current) => {
      const isDirty = value !== baselineForm[key];
      if (current.has(key) === isDirty) return current;
      const next = new Set(current);
      if (isDirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, [baselineForm]);

  const updateField = useCallback((key: keyof ProductDetailsEditForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    updateDirtyField(key, value);
    setError(null);
    setFeedback(null);
  }, [updateDirtyField]);

  const updateNameDraft = useCallback((value: string) => {
    nameDraftRef.current = value;
    updateDirtyField("name", value);
    const length = value.trim().length;
    setNameIsValid((current) => {
      const next = length >= 2 && length <= PRODUCT_DETAILS_NAME_MAX_LENGTH;
      return current === next ? current : next;
    });
    setTitleAiError(null);
    setError(null);
    setFeedback(null);
  }, [updateDirtyField]);
  const updateDescriptionDraft = useCallback((value: string) => {
    descriptionDraftRef.current = value;
    updateDirtyField("description", value);
    setDescriptionAiError(null);
    setError(null);
    setFeedback(null);
  }, [updateDirtyField]);
  const openPhotoSearch = useCallback(() => setSearchingMercadoLivrePhotos(true), []);

  const generateTitleSuggestion = useCallback(async () => {
    if (titleAiRequest.current) return;
    const controller = new AbortController();
    titleAiRequest.current = controller;
    setTitleAiLoading(true);
    setTitleAiError(null);
    setError(null);
    setFeedback(null);

    try {
      const currentTitle = nameDraftRef.current.trim();
      const generatedTitles = [...generatedTitleHistory.current];
      const excludedTitles = generatedTitles.slice(-10);
      const response = await fetch(`/api/products/${currentProduct.id}/ai/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentTitle, excludedTitles }),
        signal: controller.signal
      });
      const payload = (await response.json()) as {
        title?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel melhorar o titulo.");
      }
      const title = payload.title?.trim().replace(/\s+/g, " ") ?? "";
      if (!title || title.length > PRODUCT_DETAILS_NAME_MAX_LENGTH) {
        throw new Error("A IA nao retornou uma sugestao valida.");
      }
      const normalizedTitle = title.toLocaleLowerCase("pt-BR");
      if (
        normalizedTitle === currentTitle.toLocaleLowerCase("pt-BR") ||
        generatedTitles.some((previousTitle) => (
          previousTitle.toLocaleLowerCase("pt-BR") === normalizedTitle
        ))
      ) {
        throw new Error("A IA repetiu um titulo desta sessao.");
      }

      const latestForm = form.name === nameDraftRef.current
        ? form
        : { ...form, name: nameDraftRef.current };
      const result = applyProductTitleSuggestion(latestForm, title);
      if ("error" in result) throw new Error(result.error);

      generatedTitleHistory.current.add(result.form.name);
      nameDraftRef.current = result.form.name;
      setForm(result.form);
      updateDirtyField("name", result.form.name);
      setNameIsValid(true);
      setNameEditorResetKey((current) => current + 1);
      setTitleAiError(null);
      setError(null);
      setFeedback(null);
      requestAnimationFrame(() => nameInputRef.current?.focus());
    } catch {
      if (controller.signal.aborted) return;
      setTitleAiError("Não foi possível melhorar o título agora. Tente novamente.");
    } finally {
      if (titleAiRequest.current === controller) {
        titleAiRequest.current = null;
        setTitleAiLoading(false);
      }
    }
  }, [currentProduct.id, form, updateDirtyField]);

  const generateDescription = useCallback(async () => {
    if (descriptionAiRequest.current) return;
    const currentDescription = sanitizeProductDescription(descriptionDraftRef.current);
    const savedDescription = sanitizeProductDescription(baselineForm.description);
    if (
      currentDescription &&
      currentDescription !== savedDescription &&
      !window.confirm(
        "A descrição possui alterações não salvas. Deseja substituí-las por uma nova descrição gerada com IA?"
      )
    ) {
      return;
    }

    const controller = new AbortController();
    descriptionAiRequest.current = controller;
    setDescriptionAiLoading(true);
    setDescriptionAiError(null);
    setDescriptionAiNotice(null);
    setError(null);
    setFeedback(null);

    try {
      const generatedDescriptions = [...generatedDescriptionHistory.current];
      const response = await fetch(
        `/api/products/${currentProduct.id}/ai/description`,
        {
          method: "POST",
          signal: controller.signal
        }
      );
      const payload = (await response.json()) as {
        html?: string;
        code?: string;
        error?: string;
        retryAfterSeconds?: number;
        usedWebSearch?: boolean;
        warnings?: string[];
        evidenceLevel?: "LOCAL_ONLY" | "LOCAL_AND_WEB";
        researchSummary?: {
          queriesAttempted: number;
          officialSourcesFound: number;
          fieldsConfirmed: number;
          fieldsOmitted: number;
        };
      };
      if (!response.ok) {
        throw new ProductDescriptionAiRequestError(
          descriptionAiErrorMessage(payload.code, payload.retryAfterSeconds)
        );
      }
      const nextDescription = sanitizeProductDescription(payload.html);
      if (!nextDescription || nextDescription.length > 12_000) {
        throw new Error("A IA não retornou uma descrição válida.");
      }
      const normalizedDescription = nextDescription
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("pt-BR");
      if (
        normalizedDescription === currentDescription
          .replace(/\s+/g, " ")
          .trim()
          .toLocaleLowerCase("pt-BR") ||
        generatedDescriptions.some((previousDescription) => (
          previousDescription
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase("pt-BR") === normalizedDescription
        ))
      ) {
        throw new Error("A IA repetiu uma descrição desta sessão.");
      }

      generatedDescriptionHistory.current.add(nextDescription);
      descriptionDraftRef.current = nextDescription;
      setForm((current) => ({ ...current, description: nextDescription }));
      updateDirtyField("description", nextDescription);
      setDescriptionEditorResetKey((current) => current + 1);
      setDescriptionAiError(null);
      setDescriptionAiNotice(
        payload.warnings?.includes("OFFICIAL_SOURCES_NOT_FOUND")
          ? "Descrição criada apenas com os dados disponíveis no cadastro."
          : null
      );
      setError(null);
      setFeedback(null);
    } catch (caughtError) {
      if (controller.signal.aborted) return;
      setDescriptionAiError(
        caughtError instanceof ProductDescriptionAiRequestError
          ? caughtError.message
          : "Não foi possível gerar a descrição agora. Tente novamente."
      );
    } finally {
      if (descriptionAiRequest.current === controller) {
        descriptionAiRequest.current = null;
        setDescriptionAiLoading(false);
      }
    }
  }, [baselineForm.description, currentProduct.id, updateDirtyField]);

  const reorderImage = useCallback((fromId: string, toId: string) => {
    if (!editing || fromId === toId) return;
    setImages((current) => {
      const fromIndex = current.findIndex((image) => image.id === fromId);
      const toIndex = current.findIndex((image) => image.id === toId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((image, position) => ({ ...image, position }));
    });
  }, [editing]);

  const moveImage = useCallback((imageId: string, offset: number) => {
    const index = images.findIndex((image) => image.id === imageId);
    const target = images[index + offset];
    if (!target) return;
    reorderImage(imageId, target.id);
    setSelectedImageId(imageId);
  }, [images, reorderImage]);

  const makePrimary = useCallback((imageId: string) => {
    const first = images[0];
    if (!first || first.id === imageId) return;
    reorderImage(imageId, first.id);
    setSelectedImageId(imageId);
  }, [images, reorderImage]);

  const removeImage = useCallback((imageId: string) => {
    setImages((current) => {
      const next = current.filter((image) => image.id !== imageId).map((image, position) => ({ ...image, position }));
      if (selectedImageId === imageId) setSelectedImageId(next[0]?.id ?? null);
      return next;
    });
    setError(null);
    setFeedback(null);
  }, [selectedImageId]);

  const applyMercadoLivrePhotos = useCallback((urls: string[]) => {
    const seen = new Set(
      images
        .map((image) => normalizeMercadoLivreReferenceImageUrl(image.url))
        .filter((url): url is string => Boolean(url))
    );
    const availableSlots = Math.max(0, INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES - images.length);
    const additions = urls
      .map(normalizeMercadoLivreReferenceImageUrl)
      .filter((url): url is string => Boolean(url))
      .filter((url) => !seen.has(url))
      .slice(0, availableSlots)
      .map((url, index) => ({
        id: `pending-ml-${globalThis.crypto.randomUUID()}`,
        url,
        position: images.length + index,
        pending: true
      }));
    if (additions.length) {
      setImages([...images, ...additions]);
      setSelectedImageId(additions[0].id);
      setFeedback(`${additions.length} ${additions.length === 1 ? "foto adicionada" : "fotos adicionadas"} para revisao. Salve as alteracoes para gravar no W Ecommerce.`);
    }
    setSearchingMercadoLivrePhotos(false);
    setError(null);
  }, [images]);

  const beginEditing = useCallback(() => {
    const nextForm = formFromProduct(currentProduct);
    setForm(nextForm);
    nameDraftRef.current = nextForm.name;
    descriptionDraftRef.current = nextForm.description;
    setDirtyFields(new Set());
    setNameEditorResetKey((current) => current + 1);
    setDescriptionEditorResetKey((current) => current + 1);
    setNameIsValid(nextForm.name.trim().length >= 2 && nextForm.name.trim().length <= PRODUCT_DETAILS_NAME_MAX_LENGTH);
    const nextImages = orderedImages(currentProduct);
    setImages(nextImages);
    setBaselineImageIds(nextImages.filter((image) => !image.pending).map((image) => image.id));
    setBaselineImageKeys(nextImages.map(imageStateKey));
    setSelectedImageId(nextImages[0]?.id ?? null);
    resetTitleAiSession();
    resetDescriptionAiSession();
    setEditing(true);
    setFeedback(null);
    setError(null);
  }, [currentProduct, resetDescriptionAiSession, resetTitleAiSession]);

  const openTitleAiExperience = useCallback(() => {
    if (titleAiRequest.current) return;
    if (!editing) beginEditing();
    requestAnimationFrame(() => nameInputRef.current?.focus());
    void generateTitleSuggestion();
  }, [beginEditing, editing, generateTitleSuggestion]);

  const openDescriptionAiExperience = useCallback(() => {
    if (descriptionAiRequest.current) return;
    if (!editing) beginEditing();
    void generateDescription();
  }, [beginEditing, editing, generateDescription]);

  const cancelEdit = useCallback(() => {
    const nextImages = orderedImages(currentProduct);
    const nextForm = formFromProduct(currentProduct);
    setForm(nextForm);
    nameDraftRef.current = nextForm.name;
    descriptionDraftRef.current = nextForm.description;
    setDirtyFields(new Set());
    setNameEditorResetKey((current) => current + 1);
    setDescriptionEditorResetKey((current) => current + 1);
    setNameIsValid(nextForm.name.trim().length >= 2 && nextForm.name.trim().length <= PRODUCT_DETAILS_NAME_MAX_LENGTH);
    setImages(nextImages);
    setBaselineImageIds(nextImages.filter((image) => !image.pending).map((image) => image.id));
    setBaselineImageKeys(nextImages.map(imageStateKey));
    setSelectedImageId(nextImages[0]?.id ?? null);
    resetTitleAiSession();
    resetDescriptionAiSession();
    setEditing(true);
    setConfirmingSave(false);
    setError(null);
    setFeedback(null);
  }, [currentProduct, resetDescriptionAiSession, resetTitleAiSession]);

  function buildPayload() {
    const latestForm = {
      ...form,
      name: nameDraftRef.current,
      description: descriptionDraftRef.current
    };
    const fieldsResult = buildProductDetailsPatch(baselineForm, latestForm);
    if ("error" in fieldsResult) return fieldsResult;
    const keptImageIds = images.filter((image) => !image.pending).map((image) => image.id);
    const keptImageSet = new Set(keptImageIds);
    const imagesChanged = !arraysEqual(images.map(imageStateKey), baselineImageKeys);
    const payload = {
      ...fieldsResult.payload,
      ...(imagesChanged ? {
        images: {
          keptImageIds,
          removedImageIds: baselineImageIds.filter((imageId) => !keptImageSet.has(imageId)),
          order: images.map((image) => image.pending
            ? { kind: "new" as const, url: image.url }
            : { kind: "existing" as const, id: image.id })
        }
      } : {})
    };

    return { payload, changed: Object.keys(payload).length > 0 };
  }

  function requestSave() {
    const result = buildPayload();
    if ("error" in result) {
      setError(result.error ?? "Dados invalidos.");
      return;
    }
    if (!result.changed) {
      setFeedback("Nenhuma alteracao para salvar.");
      return;
    }
    setConfirmingSave(true);
  }

  async function confirmSave() {
    if (saveInFlight.current) return;
    const result = buildPayload();
    if ("error" in result) {
      setError(result.error ?? "Dados invalidos.");
      setConfirmingSave(false);
      return;
    }
    if (!result.changed) {
      setConfirmingSave(false);
      setFeedback("Nenhuma alteracao para salvar.");
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      let nextProduct: T;
      if (saveProduct) {
        nextProduct = await saveProduct(currentProduct.id, result.payload);
      } else {
        const response = await fetch(`/api/products/${currentProduct.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result.payload)
        });
        const payload = (await response.json()) as { data?: T; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel salvar o produto.");
        nextProduct = payload.data;
      }
      const nextImages = orderedImages(nextProduct);
      const nextForm = formFromProduct(nextProduct);
      setCurrentProduct(nextProduct);
      setForm(nextForm);
      nameDraftRef.current = nextForm.name;
      descriptionDraftRef.current = nextForm.description;
      setDirtyFields(new Set());
      setNameEditorResetKey((current) => current + 1);
      setDescriptionEditorResetKey((current) => current + 1);
      setNameIsValid(nextForm.name.trim().length >= 2 && nextForm.name.trim().length <= PRODUCT_DETAILS_NAME_MAX_LENGTH);
      setImages(nextImages);
      setBaselineImageIds(nextImages.filter((image) => !image.pending).map((image) => image.id));
      setBaselineImageKeys(nextImages.map(imageStateKey));
      setSelectedImageId(nextImages[0]?.id ?? null);
      resetTitleAiSession();
      resetDescriptionAiSession();
      onProductUpdated(nextProduct);
      setEditing(true);
      setConfirmingSave(false);
      setFeedback("Produto salvo no W Ecommerce.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Nao foi possivel salvar o produto.");
      setConfirmingSave(false);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="w-full min-w-0 max-w-none">
      <section className="flex w-full flex-col overflow-hidden rounded-xl border border-matrix-gold/35 bg-matrix-panel text-matrix-fg shadow-glow lg:h-[calc(100dvh-6.25rem)] lg:min-h-0">
        <main className="matrix-scroll min-w-0 flex-1 overflow-visible px-4 py-4 pb-6 sm:px-6 lg:min-h-0 lg:overflow-y-auto">
          {feedback ? <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700"><CheckCircle2 className="h-4 w-4" />{feedback}</div> : null}
          {error ? <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />{error}</div> : null}

          <>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.35fr)]">
            <ProductGallery
              dragOverImageId={dragOverImageId}
              draggedImageId={draggedImageId}
              editing={editing}
              images={images}
              onMakePrimary={makePrimary}
              onMoveImage={moveImage}
              onOpenPhotoSearch={openPhotoSearch}
              onRemoveImage={removeImage}
              onReorderImage={reorderImage}
              onSelectImage={setSelectedImageId}
              pointerDragImageId={pointerDragImageId}
              productName={currentProduct.name}
              selectedImageId={selectedImageId}
              setDragOverImageId={setDragOverImageId}
              setDraggedImageId={setDraggedImageId}
            />

            <section className="relative order-1 min-w-0 pr-14 lg:order-2 lg:flex lg:min-h-full lg:flex-col lg:justify-center lg:py-8 lg:pr-16">
              <p className="text-xs font-semibold uppercase text-matrix-goldDark">Produto</p>
              <h2 className="mt-2 max-w-5xl break-words text-2xl font-bold leading-tight sm:text-3xl lg:text-4xl">{currentProduct.name}</h2>
              <button aria-label="Voltar para produtos" className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-lg border border-matrix-border bg-matrix-panel2 text-matrix-muted transition hover:border-matrix-gold/70 hover:text-matrix-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold" onClick={requestClose} title="Voltar para produtos" type="button"><ArrowLeft className="h-5 w-5" /></button>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-2 rounded-md border border-matrix-gold/30 bg-matrix-goldSoft/35 px-2.5 py-1.5 font-semibold text-matrix-goldDark"><span className="h-2 w-2 rounded-full bg-matrix-gold" />{statusText}</span>
                <span className="rounded-md border border-matrix-border bg-matrix-panel2 px-2.5 py-1.5">Origem: <strong>{originText}</strong></span>
                {getBlingName(currentProduct) ? <span className="rounded-md border border-matrix-border bg-matrix-panel2 px-2.5 py-1.5">Conta: <strong>{getBlingName(currentProduct)}</strong></span> : null}
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-matrix-muted">A primeira foto da galeria e a imagem principal do produto.</p>
            </section>
          </div>

          <ProductDetailsFieldsGrid
            aiDisabled={saving || titleAiLoading || !canEditProduct}
            aiError={titleAiError}
            aiLoading={titleAiLoading}
            canEditProduct={canEditProduct}
            detailValues={detailValues}
            editing={editing}
            form={form}
            nameInputRef={nameInputRef}
            nameResetKey={nameEditorResetKey}
            onFieldChange={updateField}
            onNameDraftChange={updateNameDraft}
            onOpenTitleAi={openTitleAiExperience}
          />

          <section className="mt-3 min-w-0 rounded-lg border border-matrix-border bg-matrix-panel2/65 p-4 [content-visibility:auto] [contain-intrinsic-size:auto_14rem]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 shrink-0 text-matrix-goldDark" />
                Descrição
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canEditProduct ? (
                  <ProductDescriptionAiTrigger
                    disabled={saving || descriptionAiLoading}
                    loading={descriptionAiLoading}
                    onClick={openDescriptionAiExperience}
                  />
                ) : null}
                <button
                  aria-expanded={isDescriptionExpanded}
                  aria-label={isDescriptionExpanded ? "Recolher descrição" : "Expandir descrição"}
                  className="inline-flex items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel px-2.5 py-1.5 text-xs font-semibold text-matrix-goldDark transition hover:border-matrix-gold/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold"
                  onClick={() => setIsDescriptionExpanded((current) => !current)}
                  title={isDescriptionExpanded ? "Recolher descrição" : "Expandir descrição"}
                  type="button"
                >
                  {isDescriptionExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  {isDescriptionExpanded ? "Recolher" : "Expandir"}
                </button>
              </div>
            </div>
            {editing ? (
              <>
                <ProductDescriptionEditor
                  disabled={saving || descriptionAiLoading}
                  expanded={isDescriptionExpanded}
                  initialValue={form.description}
                  onDraftChange={updateDescriptionDraft}
                  resetKey={descriptionEditorResetKey}
                />
                {descriptionAiError ? (
                  <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
                    {descriptionAiError}
                  </p>
                ) : null}
                {descriptionAiNotice ? (
                  <p className="mt-2 text-xs text-matrix-muted" role="status">
                    {descriptionAiNotice}
                  </p>
                ) : null}
              </>
            ) : (
              <div
                className={`matrix-scroll mt-3 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 [&_li]:ml-5 [&_ol+p]:mt-3 [&_ol]:list-decimal [&_p+ol]:mt-1 [&_p+p]:mt-3 [&_p+ul]:mt-1 [&_ul+p]:mt-3 [&_ul]:list-disc ${
                  isDescriptionExpanded ? "h-[70vh] min-h-80" : "max-h-72 min-h-56"
                }`}
                dangerouslySetInnerHTML={{ __html: description || "Nao informado" }}
              />
            )}
          </section>
          </>
        </main>

        <footer className="z-10 flex shrink-0 flex-col gap-3 border-t border-matrix-border bg-matrix-panel px-4 py-3 shadow-[0_-12px_32px_rgb(0_0_0/0.2)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-matrix-muted">{editing ? "As mudancas permanecem locais ate a confirmacao do salvamento." : !canEditProduct ? "Seu usuario pode visualizar, mas nao editar produtos." : "Visualizacao do cadastro local do W Ecommerce."}</p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            {editing ? (
              <><Button disabled={saving} onClick={cancelEdit} type="button" variant="secondary">Cancelar</Button><Button disabled={saving || titleAiLoading || descriptionAiLoading || !hasPendingChanges || !nameIsValid} onClick={requestSave} type="button"><Save className="h-4 w-4" />{saving ? "Salvando alterações..." : "Salvar alterações"}</Button></>
            ) : <Button onClick={requestClose} type="button" variant="secondary"><ArrowLeft className="h-4 w-4" />Voltar para produtos</Button>}
          </div>
        </footer>
      </section>

      {searchingMercadoLivrePhotos ? (
        <MercadoLivrePhotoSearchModal
          existingImageUrls={images.map((image) => image.url)}
          maximumSelectable={Math.max(0, INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES - images.length)}
          onApply={applyMercadoLivrePhotos}
          onCancel={() => setSearchingMercadoLivrePhotos(false)}
          productId={currentProduct.id}
          productName={currentProduct.name}
        />
      ) : null}

          {confirmingSave ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 shadow-glow"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-matrix-goldDark" /><div><h3 className="text-lg font-bold">Salvar alterações?</h3><p className="mt-2 text-sm leading-6 text-matrix-muted">As alteracoes serao gravadas somente no W Ecommerce. Para envia-las ao Bling, selecione o produto na lista e use Atualizar selecionados no Bling.</p></div></div><div className="mt-5 flex justify-end gap-2"><Button disabled={saving} onClick={() => setConfirmingSave(false)} type="button" variant="secondary">Voltar</Button><Button disabled={saving || titleAiLoading || descriptionAiLoading} onClick={() => void confirmSave()} type="button">{saving ? "Salvando alterações..." : "Salvar alterações"}</Button></div></div></div> : null}

      {confirmingDiscard ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4"><div className="w-full max-w-md rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 shadow-glow"><h3 className="text-lg font-bold">Descartar alteracoes?</h3><p className="mt-2 text-sm leading-6 text-matrix-muted">A ordem e as fotos removidas serao restauradas na visualizacao e nada sera salvo.</p><div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmingDiscard(false)} type="button" variant="secondary">Continuar editando</Button><Button onClick={onBack} type="button"><Trash2 className="h-4 w-4" />Descartar</Button></div></div></div> : null}
    </div>
  );
}
