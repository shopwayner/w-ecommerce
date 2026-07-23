"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
  Edit3,
  Factory,
  FileText,
  Folder,
  Globe2,
  GripVertical,
  ImageIcon,
  ImagePlus,
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
import { MercadoLivrePhotoSearchModal } from "@/components/mercado-livre-photo-search-modal";
import { Button } from "@/components/ui";
import { INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES } from "@/lib/intelligent-product-preview";
import { normalizeMercadoLivreReferenceImageUrl } from "@/lib/mercado-livre-reference-images";
import {
  buildProductDetailsPatch,
  createProductDetailsEditForm,
  PRODUCT_DETAILS_NAME_MAX_LENGTH,
  productDetailsFieldDefinitions,
  type ProductDetailsEditForm,
  type ProductDetailsFieldId
} from "@/lib/product-details-edit";

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
  condition?: string | null;
  attributes?: unknown;
  blingStatus?: string | null;
  blingAccount: {
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

function sanitizeDescription(value: string | null | undefined) {
  if (!value?.trim()) return "";
  return value
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\b[^>]*>/gi, "\n")
    .replace(/<\/?\s*(p|div|section|article|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
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
    description: sanitizeDescription(product.description)
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

export function ProductDetailsModal<T extends ProductDetailsProduct>({
  product,
  onClose,
  onProductUpdated,
  loadProduct,
  checkPermission,
  saveProduct
}: {
  product: T;
  onClose: () => void;
  onProductUpdated: (product: T) => void;
  loadProduct?: (productId: string) => Promise<T>;
  checkPermission?: () => Promise<boolean>;
  saveProduct?: (productId: string, payload: unknown) => Promise<T>;
}) {
  const [currentProduct, setCurrentProduct] = useState<T>(product);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProductDetailsEditForm>(() => formFromProduct(product));
  const [images, setImages] = useState<ProductDetailsImage[]>(() => orderedImages(product));
  const [baselineImageIds, setBaselineImageIds] = useState<string[]>(() => (product.images ?? []).map((image) => image.id));
  const [baselineImageKeys, setBaselineImageKeys] = useState<string[]>(() => orderedImages(product).map(imageStateKey));
  const [selectedImageId, setSelectedImageId] = useState<string | null>(() => orderedImages(product)[0]?.id ?? null);
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [dragOverImageId, setDragOverImageId] = useState<string | null>(null);
  const [canEditProduct, setCanEditProduct] = useState(false);
  const [permissionChecked, setPermissionChecked] = useState(false);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchingMercadoLivrePhotos, setSearchingMercadoLivrePhotos] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const pointerDragImageId = useRef<string | null>(null);

  const baselineForm = useMemo(() => formFromProduct(currentProduct), [currentProduct]);
  const currentImageKeys = useMemo(() => images.map(imageStateKey), [images]);
  const hasPendingChanges = editing && (
    JSON.stringify(form) !== JSON.stringify(baselineForm) || !arraysEqual(currentImageKeys, baselineImageKeys)
  );
  const selectedImage = images.find((image) => image.id === selectedImageId) ?? images[0] ?? null;

  const requestClose = useCallback(() => {
    if (saving) return;
    if (hasPendingChanges) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  }, [hasPendingChanges, onClose, saving]);

  useEffect(() => {
    let active = true;
    setDetailsLoading(true);
    setDetailsLoaded(false);

    async function loadDetails() {
      try {
        let nextProduct: T;
        if (loadProduct) {
          nextProduct = await loadProduct(product.id);
        } else {
          const response = await fetch(`/api/products/${product.id}`, { cache: "no-store" });
          const payload = (await response.json()) as { data?: T; error?: string };
          if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel carregar o produto.");
          nextProduct = payload.data;
        }
        if (!active) return;
        const nextImages = orderedImages(nextProduct);
        setCurrentProduct(nextProduct);
        setForm(formFromProduct(nextProduct));
        setImages(nextImages);
        setBaselineImageIds(nextImages.filter((image) => !image.pending).map((image) => image.id));
        setBaselineImageKeys(nextImages.map(imageStateKey));
        setSelectedImageId(nextImages[0]?.id ?? null);
        setDetailsLoaded(true);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar o produto.");
      } finally {
        if (active) setDetailsLoading(false);
      }
    }

    void loadDetails();
    return () => {
      active = false;
    };
  }, [loadProduct, product.id]);

  useEffect(() => {
    let active = true;
    async function loadPermission() {
      try {
        if (checkPermission) {
          const allowed = await checkPermission();
          if (active) setCanEditProduct(allowed);
        } else {
          const response = await fetch("/api/auth/session");
          if (!response.ok) return;
          const payload = (await response.json()) as { user?: { role?: string } };
          if (active) setCanEditProduct(payload.user?.role === "OWNER" || payload.user?.role === "ADMIN");
        }
      } finally {
        if (active) setPermissionChecked(true);
      }
    }
    void loadPermission();
    return () => {
      active = false;
    };
  }, [checkPermission]);

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
  const description = editing ? form.description : sanitizeDescription(currentProduct.description);
  const canToggleDescription = !editing && (description.length > 360 || description.split(/\r?\n/).length > 4);
  const descriptionCollapsed = canToggleDescription && !descriptionExpanded;
  const cardClass = "rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3";
  const inputClass = "mt-2 h-10 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 text-sm font-semibold text-matrix-fg outline-none transition focus:border-matrix-gold/70 focus:ring-2 focus:ring-matrix-gold/20";

  const detailIcons: Record<ProductDetailsFieldId, typeof Package> = {
    name: Package,
    brand: Factory,
    sku: Tag,
    ean: Barcode,
    unit: ClipboardList,
    category: Folder,
    origin: Globe2,
    blingStatus: ShieldCheck,
    costPrice: DollarSign,
    salePrice: Tag,
    stock: Box,
    weight: Scale,
    grossWeight: Scale,
    condition: ShieldCheck,
    height: Ruler,
    width: Ruler,
    depth: Ruler,
    updatedAt: CalendarDays
  };
  const detailValues: Record<ProductDetailsFieldId, string | number | null | undefined> = {
    name: currentProduct.name,
    brand: currentProduct.brand,
    sku: currentProduct.sku,
    ean: currentProduct.ean,
    unit: currentProduct.unit,
    category: currentProduct.category,
    origin: originText,
    blingStatus: getBlingStatusLabel(currentProduct.blingStatus),
    costPrice: formatCurrency(currentProduct.costPriceDisplay ?? currentProduct.displayValue),
    salePrice: formatCurrency(currentProduct.salePriceDisplay),
    stock: currentProduct.stock,
    weight: formatMeasurement(currentProduct.weight, "kg"),
    grossWeight: formatMeasurement(getGrossWeight(currentProduct), "kg"),
    condition: getCondition(currentProduct),
    height: formatMeasurement(currentProduct.height, "cm"),
    width: formatMeasurement(currentProduct.width, "cm"),
    depth: formatMeasurement(currentProduct.depth, "cm"),
    updatedAt: formatDate(currentProduct.updatedAt)
  };

  function updateField(key: keyof ProductDetailsEditForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setFeedback(null);
  }

  function reorderImage(fromId: string, toId: string) {
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
  }

  function moveImage(imageId: string, offset: number) {
    const index = images.findIndex((image) => image.id === imageId);
    const target = images[index + offset];
    if (!target) return;
    reorderImage(imageId, target.id);
    setSelectedImageId(imageId);
  }

  function makePrimary(imageId: string) {
    const first = images[0];
    if (!first || first.id === imageId) return;
    reorderImage(imageId, first.id);
    setSelectedImageId(imageId);
  }

  function removeImage(imageId: string) {
    setImages((current) => {
      const next = current.filter((image) => image.id !== imageId).map((image, position) => ({ ...image, position }));
      if (selectedImageId === imageId) setSelectedImageId(next[0]?.id ?? null);
      return next;
    });
    setError(null);
    setFeedback(null);
  }

  function applyMercadoLivrePhotos(urls: string[]) {
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
  }

  function beginEditing() {
    setForm(formFromProduct(currentProduct));
    const nextImages = orderedImages(currentProduct);
    setImages(nextImages);
    setBaselineImageIds(nextImages.filter((image) => !image.pending).map((image) => image.id));
    setBaselineImageKeys(nextImages.map(imageStateKey));
    setSelectedImageId(nextImages[0]?.id ?? null);
    setEditing(true);
    setFeedback(null);
    setError(null);
  }

  function cancelEdit() {
    const nextImages = orderedImages(currentProduct);
    setForm(formFromProduct(currentProduct));
    setImages(nextImages);
    setBaselineImageIds(nextImages.filter((image) => !image.pending).map((image) => image.id));
    setBaselineImageKeys(nextImages.map(imageStateKey));
    setSelectedImageId(nextImages[0]?.id ?? null);
    setEditing(false);
    setConfirmingSave(false);
    setError(null);
    setFeedback(null);
  }

  function buildPayload() {
    const fieldsResult = buildProductDetailsPatch(baselineForm, form);
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
      setCurrentProduct(nextProduct);
      setForm(formFromProduct(nextProduct));
      setImages(nextImages);
      setBaselineImageIds(nextImages.filter((image) => !image.pending).map((image) => image.id));
      setBaselineImageKeys(nextImages.map(imageStateKey));
      setSelectedImageId(nextImages[0]?.id ?? null);
      onProductUpdated(nextProduct);
      setEditing(false);
      setConfirmingSave(false);
      setFeedback("Alteracoes salvas no W Ecommerce. As integracoes externas nao foram atualizadas.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Nao foi possivel salvar o produto.");
      setConfirmingSave(false);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-1 backdrop-blur-md sm:p-2" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section aria-modal="true" className="mx-auto flex h-[calc(100dvh-0.5rem)] w-full max-w-[1540px] flex-col overflow-hidden rounded-xl border border-matrix-gold/35 bg-matrix-panel text-matrix-fg shadow-glow sm:h-[calc(100dvh-1rem)]" role="dialog">
        <main className="matrix-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-6 sm:px-6">
          {detailsLoading ? <p className="mb-3 text-sm text-matrix-muted">Carregando todas as fotos e detalhes...</p> : null}
          {feedback ? <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700"><CheckCircle2 className="h-4 w-4" />{feedback}</div> : null}
          {error ? <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />{error}</div> : null}

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.35fr)]">
            <section className="order-2 min-w-0 lg:order-1">
              <div className="grid aspect-[4/3] max-h-[52dvh] w-full place-items-center overflow-hidden rounded-lg border border-matrix-border bg-white text-matrix-muted">
                {selectedImage ? <Image alt={currentProduct.name} className="h-full w-full object-contain" height={720} src={selectedImage.url} unoptimized width={960} /> : <div className="px-6 py-12 text-center"><ImageIcon className="mx-auto h-10 w-10 text-matrix-goldDark" /><p className="mt-3 font-semibold">Produto sem imagem</p></div>}
              </div>

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
                      onDragOver={(event) => { if (!editing) return; event.preventDefault(); setDragOverImageId(image.id); }}
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
                        if (sourceImageId) reorderImage(sourceImageId, image.id);
                        pointerDragImageId.current = null;
                        setDraggedImageId(null);
                        setDragOverImageId(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceImageId = event.dataTransfer.getData("text/plain") || pointerDragImageId.current || draggedImageId;
                        if (sourceImageId) reorderImage(sourceImageId, image.id);
                        pointerDragImageId.current = null;
                        setDraggedImageId(null);
                        setDragOverImageId(null);
                      }}
                    >
                      <button aria-label={`Visualizar imagem ${index + 1}`} className={`block h-16 w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold ${editing ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`} onClick={() => setSelectedImageId(image.id)} type="button">
                        <Image alt={`Imagem ${index + 1} de ${currentProduct.name}`} className="h-full w-full object-contain" height={72} src={image.url} unoptimized width={72} />
                      </button>
                      {index === 0 ? <span className="absolute bottom-1 left-1 rounded bg-matrix-gold px-1.5 py-0.5 text-[9px] font-bold text-black">Principal</span> : null}
                      {editing ? (
                        <>
                          <button aria-label="Remover imagem" className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-red-600 text-white opacity-100 shadow transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" onClick={(event) => { event.stopPropagation(); removeImage(image.id); }} type="button"><X className="h-4 w-4" /></button>
                          <div className="mt-1 flex items-center justify-center gap-1 bg-white">
                            <button aria-label={`Mover imagem ${index + 1} para a esquerda`} className="grid h-7 w-7 place-items-center rounded border border-zinc-300 text-zinc-700 disabled:opacity-30" disabled={index === 0} onClick={() => moveImage(image.id, -1)} type="button"><ChevronLeft className="h-4 w-4" /></button>
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
                            <button aria-label={`Mover imagem ${index + 1} para a direita`} className="grid h-7 w-7 place-items-center rounded border border-zinc-300 text-zinc-700 disabled:opacity-30" disabled={index === images.length - 1} onClick={() => moveImage(image.id, 1)} type="button"><ChevronRight className="h-4 w-4" /></button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {editing ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Button onClick={() => setSearchingMercadoLivrePhotos(true)} type="button" variant="secondary"><ImagePlus className="h-4 w-4" />Buscar fotos no Mercado Livre</Button>
                  {selectedImage && images[0]?.id !== selectedImage.id ? <Button onClick={() => makePrimary(selectedImage.id)} type="button" variant="secondary">Definir como principal</Button> : <span className="hidden sm:block" />}
                </div>
              ) : null}
            </section>

            <section className="relative order-1 min-w-0 pr-14 lg:order-2 lg:flex lg:min-h-full lg:flex-col lg:justify-center lg:py-8 lg:pr-16">
              <p className="text-xs font-semibold uppercase text-matrix-goldDark">Ver produto</p>
              <h2 className="mt-2 max-w-5xl break-words text-2xl font-bold leading-tight sm:text-3xl lg:text-4xl">{editing ? form.name || currentProduct.name : currentProduct.name}</h2>
              <button aria-label="Fechar detalhes do produto" className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-lg border border-matrix-border bg-matrix-panel2 text-matrix-muted transition hover:border-matrix-gold/70 hover:text-matrix-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold" onClick={requestClose} type="button"><X className="h-6 w-6" /></button>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-2 rounded-md border border-matrix-gold/30 bg-matrix-goldSoft/35 px-2.5 py-1.5 font-semibold text-matrix-goldDark"><span className="h-2 w-2 rounded-full bg-matrix-gold" />{statusText}</span>
                <span className="rounded-md border border-matrix-border bg-matrix-panel2 px-2.5 py-1.5">Origem: <strong>{originText}</strong></span>
                {getBlingName(currentProduct) ? <span className="rounded-md border border-matrix-border bg-matrix-panel2 px-2.5 py-1.5">Conta: <strong>{getBlingName(currentProduct)}</strong></span> : null}
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-matrix-muted">A primeira foto da galeria e a imagem principal do produto.</p>
            </section>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {productDetailsFieldDefinitions.map((field) => {
              const Icon = detailIcons[field.id];
              if (editing && field.editable) {
                const formKey = field.id as keyof ProductDetailsEditForm;
                return (
                  <label key={field.id} className={cardClass}>
                    <span className="flex items-center gap-2 text-xs text-matrix-muted"><Icon className="h-4 w-4 text-matrix-goldDark" />{field.label}</span>
                    {field.id === "condition" ? (
                      <select className={inputClass} onChange={(event) => updateField("condition", event.target.value)} value={form.condition}>
                        <option value="">Nao informado</option>
                        <option value="NEW">Novo</option>
                        <option value="USED">Usado</option>
                        <option value="UNSPECIFIED">Nao especificado</option>
                      </select>
                    ) : (
                      <input
                        className={inputClass}
                        inputMode={field.inputMode}
                        maxLength={field.id === "name" ? PRODUCT_DETAILS_NAME_MAX_LENGTH : field.id === "brand" ? 120 : undefined}
                        onChange={(event) => updateField(formKey, event.target.value)}
                        placeholder={field.placeholder}
                        value={form[formKey]}
                      />
                    )}
                    {field.id === "name" ? <span className={`mt-1 block text-right text-xs ${form.name.length >= 55 ? "text-matrix-goldDark" : "text-matrix-muted"}`}>{form.name.length}/{PRODUCT_DETAILS_NAME_MAX_LENGTH}</span> : null}
                  </label>
                );
              }
              return (
                <div key={field.id} className={cardClass}>
                  <div className="flex gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-matrix-goldDark" /><div className="min-w-0"><p className="text-xs text-matrix-muted">{field.label}</p><p className="mt-1 break-words text-sm font-semibold">{displayText(detailValues[field.id], field.placeholder)}</p></div></div>
                </div>
              );
            })}
          </div>

          <section className="mt-3 rounded-lg border border-matrix-border bg-matrix-panel2/65 p-4">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-matrix-goldDark" />Descricao</div>{canToggleDescription ? <button aria-expanded={descriptionExpanded} className="inline-flex items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel px-2.5 py-1.5 text-xs font-semibold text-matrix-goldDark" onClick={() => setDescriptionExpanded((current) => !current)} type="button">{descriptionExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{descriptionExpanded ? "Recolher" : "Expandir"}</button> : null}</div>
            {editing ? <textarea className="mt-3 min-h-44 w-full resize-y rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm leading-6 outline-none focus:border-matrix-gold/70 focus:ring-2 focus:ring-matrix-gold/20" onChange={(event) => updateField("description", event.target.value)} value={form.description} /> : <div className={`relative mt-3 ${descriptionCollapsed ? "max-h-28 overflow-hidden" : ""}`}><p className="whitespace-pre-line break-words text-sm leading-6">{description || "Nao informado"}</p>{descriptionCollapsed ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-matrix-panel2 to-transparent" /> : null}</div>}
          </section>
        </main>

        <footer className="z-10 flex shrink-0 flex-col gap-3 border-t border-matrix-border bg-matrix-panel px-4 py-3 shadow-[0_-12px_32px_rgb(0_0_0/0.2)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-matrix-muted">{editing ? "As mudancas permanecem locais ate a confirmacao do salvamento." : permissionChecked && !canEditProduct ? "Seu usuario pode visualizar, mas nao editar produtos." : "Visualizacao do cadastro local do W Ecommerce."}</p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            {editing ? <><Button disabled={saving} onClick={cancelEdit} type="button" variant="secondary">Cancelar</Button><Button disabled={saving || !hasPendingChanges || form.name.trim().length < 2 || form.name.trim().length > PRODUCT_DETAILS_NAME_MAX_LENGTH} onClick={requestSave} type="button"><Save className="h-4 w-4" />Salvar alteracoes</Button></> : <><Button onClick={requestClose} type="button" variant="secondary">Fechar</Button>{canEditProduct ? <Button disabled={!detailsLoaded || detailsLoading} onClick={beginEditing} type="button"><Edit3 className="h-4 w-4" />Editar</Button> : null}</>}
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

      {confirmingSave ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 shadow-glow"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-matrix-goldDark" /><div><h3 className="text-lg font-bold">Salvar alteracoes locais?</h3><p className="mt-2 text-sm leading-6 text-matrix-muted">A ordem e as remocoes de fotos serao gravadas somente no W Ecommerce. Nenhuma integracao externa sera atualizada.</p></div></div><div className="mt-5 flex justify-end gap-2"><Button disabled={saving} onClick={() => setConfirmingSave(false)} type="button" variant="secondary">Voltar</Button><Button disabled={saving} onClick={() => void confirmSave()} type="button">{saving ? "Salvando..." : "Confirmar salvamento local"}</Button></div></div></div> : null}

      {confirmingDiscard ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4"><div className="w-full max-w-md rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 shadow-glow"><h3 className="text-lg font-bold">Descartar alteracoes?</h3><p className="mt-2 text-sm leading-6 text-matrix-muted">A ordem e as fotos removidas serao restauradas na visualizacao e nada sera salvo.</p><div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmingDiscard(false)} type="button" variant="secondary">Continuar editando</Button><Button onClick={onClose} type="button"><Trash2 className="h-4 w-4" />Descartar</Button></div></div></div> : null}
    </div>
  );
}
