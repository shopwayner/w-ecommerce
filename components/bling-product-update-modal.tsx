"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  RefreshCw,
  Star,
  Trash2,
  X
} from "lucide-react";
import { Button } from "@/components/ui";

export type BlingProductEditableValues = {
  name: string;
  images: string[];
};

export type BlingProductReviewChanges = {
  name?: string;
  images?: string[];
};

export type BlingProductUpdatePreview = {
  confirmedLinkMismatch?: true;
  linkMismatchConfirmation?: string;
  capabilities: {
    namePatchEnabled: boolean;
    imagesPatchEnabled: boolean;
  };
  item: {
    productId: string;
    status: "READY" | "UNCHANGED" | "VINCULO_PRECISA_REVISAO" | "NOT_LINKED" | "UNSUPPORTED" | "ERROR";
    message: string;
    local: BlingProductEditableValues | null;
    remote: BlingProductEditableValues | null;
    imageComparison?: "IMAGES_ALREADY_SYNCED" | "IMAGES_DIFFERENT" | "IMAGES_UNKNOWN";
    dryRun?: {
      canUpdate: boolean;
      safeToExecute: boolean;
      changedFields: Array<"name" | "images">;
      preservedFields: string[];
      missingFields: string[];
      ambiguousFields: string[];
      remoteImageCount: number;
      finalImageCount: number;
      payloadKeys: string[];
      externalProductIdMasked: string | null;
      payload?: null;
    };
    linkReview?: {
      status: "VINCULO_PRECISA_REVISAO";
      externalProductIdMasked: string | null;
      localName: string;
      remoteName: string;
      localMeasures: string[];
      remoteMeasures: string[];
      reasons: Array<"KIT_VS_UNIT" | "MEASURES_MISMATCH" | "MODEL_MISMATCH" | "SKU_MISMATCH" | "GTIN_MISMATCH" | "BRAND_MISMATCH">;
    };
  };
};

export type BlingProductUpdateResult = {
  productId: string;
  externalProductIdMasked: string | null;
  status: "UPDATED" | "UNCHANGED" | "FAILED";
  message: string;
  fields: Array<"name" | "images">;
  code?:
    | "AUTHORIZATION_REQUIRED"
    | "IMAGES_REJECTED"
    | "TITLE_REJECTED"
    | "REQUIRED_FIELDS_MISSING"
    | "UNSUPPORTED_STRUCTURE"
    | "DATA_REJECTED"
    | "RATE_LIMITED"
    | "TEMPORARY_FAILURE"
    | "VERIFICATION_REQUIRED"
    | "LINK_REVIEW_REQUIRED"
    | "TEMPORARILY_BLOCKED"
    | "NAME_PATCH_BLOCKED"
    | "IMAGES_PATCH_BLOCKED"
    | "PRODUCT_INCIDENT_BLOCKED"
    | "EXTERNAL_UPDATE_INTEGRITY_FAILED"
    | "LOCAL_MAPPING_CONCURRENT_UPDATE"
    | "LOCAL_MAPPING_RECORD_FAILED"
    | "LOCAL_AUDIT_RECORD_FAILED";
  replayed?: boolean;
};

type BlingProductUpdateModalProps = {
  busy: boolean;
  message: string;
  onClose: () => void;
  onConfirm: (fields: BlingProductReviewChanges) => void;
  onConfirmLinkMismatch: () => void;
  preview: BlingProductUpdatePreview | null;
  result: BlingProductUpdateResult | null;
};

function normalizeReviewText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sameImages(left: string[], right: string[]) {
  return left.length === right.length && left.every((image, index) => image === right[index]);
}

function normalizePresentationText(value: string) {
  return normalizeReviewText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeImages(current: string[], available: string[]) {
  return [...new Set([...current, ...available])].slice(0, 13);
}

const linkMismatchReasonLabels: Record<
  NonNullable<BlingProductUpdatePreview["item"]["linkReview"]>["reasons"][number],
  string
> = {
  KIT_VS_UNIT: "O cadastro local indica um conjunto e o cadastro vinculado indica uma unidade.",
  MEASURES_MISMATCH: "As medidas identificadas nos títulos são diferentes.",
  MODEL_MISMATCH: "Os modelos identificados nos títulos são diferentes.",
  SKU_MISMATCH: "Os códigos informados nos dois cadastros são diferentes.",
  GTIN_MISMATCH: "Os identificadores comerciais informados são diferentes.",
  BRAND_MISMATCH: "Os fabricantes informados nos dois cadastros são diferentes."
};

export function BlingProductUpdateModal({
  busy,
  message,
  onClose,
  onConfirm,
  onConfirmLinkMismatch,
  preview,
  result
}: BlingProductUpdateModalProps) {
  const item = preview?.item ?? null;
  const [title, setTitle] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [linkMismatchAcknowledged, setLinkMismatchAcknowledged] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [imagesEditingEnabled, setImagesEditingEnabled] = useState(false);
  const [removedRemoteImages, setRemovedRemoteImages] = useState<string[]>([]);
  const [imageReductionAcknowledged, setImageReductionAcknowledged] = useState(false);

  useEffect(() => {
    setTitle(item?.remote?.name ?? item?.local?.name ?? "");
    setImages(item?.remote?.images ?? []);
    setSelectedImageIndex(0);
    setShowLinkReview(false);
    setLinkMismatchAcknowledged(false);
    setNameTouched(false);
    setImagesEditingEnabled(false);
    setRemovedRemoteImages([]);
    setImageReductionAcknowledged(false);
  }, [item?.productId, item?.local, item?.remote]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const normalizedTitle = normalizeReviewText(title);
  const remote = item?.remote;
  const remoteImages = remote?.images ?? [];
  const localImages = item?.local?.images ?? [];
  const namePatchEnabled = preview?.capabilities.namePatchEnabled === true;
  const imagesPatchEnabled = preview?.capabilities.imagesPatchEnabled === true;
  const imagesAlreadySynced = item?.imageComparison === "IMAGES_ALREADY_SYNCED";
  const imagesDifferent = item?.imageComparison === "IMAGES_DIFFERENT";
  const linkNeedsReview = item?.status === "VINCULO_PRECISA_REVISAO";
  const canReview = Boolean(
    item?.local && remote && !["VINCULO_PRECISA_REVISAO", "NOT_LINKED", "UNSUPPORTED", "ERROR"].includes(item.status)
  );
  const nameChanged = Boolean(nameTouched && remote && normalizedTitle !== normalizeReviewText(remote.name));
  const imagesChanged = Boolean(
    imagesPatchEnabled && imagesEditingEnabled && remote && !sameImages(images, remoteImages)
  );
  const removedRemoteCount = remoteImages.filter((image) => !images.includes(image)).length;
  const imageRemovalNotExplicit = Boolean(
    imagesChanged && images.length < remoteImages.length && removedRemoteImages.length < removedRemoteCount
  );
  const galleryReductionRequiresConfirmation = Boolean(imagesChanged && images.length < remoteImages.length);
  const imageReductionUnconfirmed = galleryReductionRequiresConfirmation && !imageReductionAcknowledged;
  const hasDifferences = nameChanged || imagesChanged;
  const formInvalid = (nameTouched && !normalizedTitle)
    || (imagesEditingEnabled && !images.length)
    || imageRemovalNotExplicit
    || imageReductionUnconfirmed;
  const presentationOnlyTitleDifference = Boolean(
    item?.local?.name
      && remote?.name
      && item.local.name !== remote.name
      && normalizePresentationText(item.local.name) === normalizePresentationText(remote.name)
  );
  const completed = result?.status === "UPDATED" || result?.status === "UNCHANGED";
  const retryBlocked = result?.code === "VERIFICATION_REQUIRED";
  const selectedImage = images[selectedImageIndex] ?? null;
  const friendlyMessage = message || (!canReview ? item?.message ?? "" : "");
  const localRecordWarning = Boolean(
    result?.status === "UPDATED"
    && result.code
    && ["LOCAL_MAPPING_CONCURRENT_UPDATE", "LOCAL_MAPPING_RECORD_FAILED", "LOCAL_AUDIT_RECORD_FAILED"].includes(result.code)
  );

  function makeSelectedImagePrimary() {
    if (!imagesPatchEnabled || !imagesEditingEnabled || selectedImageIndex <= 0) return;
    setImages((current) => {
      const selected = current[selectedImageIndex];
      if (!selected) return current;
      return [selected, ...current.filter((_, index) => index !== selectedImageIndex)];
    });
    setSelectedImageIndex(0);
  }

  function removeSelectedImage() {
    if (!imagesPatchEnabled || !imagesEditingEnabled) return;
    const selected = images[selectedImageIndex];
    if (selected && remoteImages.includes(selected)) {
      setRemovedRemoteImages((current) => current.includes(selected) ? current : [...current, selected]);
    }
    setImageReductionAcknowledged(false);
    setImages((current) => current.filter((_, index) => index !== selectedImageIndex));
    setSelectedImageIndex((current) => Math.max(0, Math.min(current, images.length - 2)));
  }

  function useLocalImages() {
    if (!imagesPatchEnabled) return;
    const merged = mergeImages(remoteImages, localImages);
    setImages(merged);
    setImagesEditingEnabled(true);
    setRemovedRemoteImages([]);
    setImageReductionAcknowledged(false);
    const firstLocalIndex = merged.findIndex((image) => localImages.includes(image));
    setSelectedImageIndex(firstLocalIndex >= 0 ? firstLocalIndex : 0);
  }

  function useLocalTitle() {
    if (!namePatchEnabled || !item?.local?.name) return;
    setTitle(item.local.name);
    setNameTouched(true);
  }

  function submit() {
    if (!canReview || !hasDifferences || formInvalid || busy || completed) return;
    const fields: BlingProductReviewChanges = {};
    if (nameChanged && namePatchEnabled) fields.name = normalizedTitle;
    if (imagesChanged && imagesPatchEnabled) fields.images = images;
    onConfirm(fields);
  }

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/75 px-3 py-4 backdrop-blur-sm sm:px-5"
      onClick={() => !busy && onClose()}
    >
      <section
        aria-labelledby="bling-product-update-title"
        aria-modal="true"
        className="matrix-scroll flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-matrix-gold/35 bg-matrix-panel shadow-[0_24px_90px_rgb(0_0_0/0.45)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-matrix-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h3 id="bling-product-update-title" className="text-xl font-semibold text-matrix-fg">
              {linkNeedsReview ? "Revisar vínculo" : "Atualizar produto no Bling"}
            </h3>
            <p className="mt-1 text-sm text-matrix-muted">
              {linkNeedsReview
                ? "Confira os dois cadastros antes de continuar."
                : "Revise o título e as fotos antes de enviar."}
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-matrix-border text-matrix-muted transition hover:border-matrix-gold/45 hover:text-matrix-goldDark disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="matrix-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {!preview && busy ? (
            <div className="flex items-center justify-center gap-3 rounded-md border border-matrix-border bg-matrix-panel2 p-8 text-sm text-matrix-muted">
              <RefreshCw className="h-4 w-4 animate-spin text-matrix-goldDark" />
              Carregando produto...
            </div>
          ) : null}

          {item?.local && linkNeedsReview ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)]">
              <div className="relative grid aspect-square max-h-[360px] place-items-center overflow-hidden rounded-lg border border-matrix-gold/30 bg-white">
                {item.local.images[0] ? (
                  <Image
                    alt={item.local.name}
                    className="h-full w-full object-contain"
                    fill
                    priority
                    sizes="(max-width: 1024px) 90vw, 360px"
                    src={item.local.images[0]}
                    unoptimized
                  />
                ) : (
                  <div className="text-center text-matrix-muted">
                    <ImageIcon className="mx-auto h-8 w-8" />
                    <p className="mt-2 text-sm">Produto sem foto</p>
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col justify-center gap-4">
                <div className="flex gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>Os dados parecem diferentes, mas você pode confirmar manualmente que este é o mesmo produto.</p>
                </div>
                {item.linkReview ? (
                  <div className="grid gap-3 rounded-md border border-matrix-border bg-matrix-panel2 p-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase text-matrix-muted">ID Bling</p>
                      <p className="mt-1 text-matrix-fg">{item.linkReview.externalProductIdMasked ?? "Indisponível"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-matrix-muted">Produto no W Ecommerce</p>
                      <p className="mt-1 text-matrix-fg">{item.linkReview.localName}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-matrix-muted">Produto vinculado no Bling</p>
                      <p className="mt-1 text-matrix-fg">{item.linkReview.remoteName}</p>
                    </div>
                    {(item.linkReview.localMeasures.length || item.linkReview.remoteMeasures.length) ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase text-matrix-muted">Medidas locais</p>
                          <p className="mt-1 text-matrix-fg">{item.linkReview.localMeasures.join(" + ") || "Não informadas"}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-matrix-muted">Medidas no Bling</p>
                          <p className="mt-1 text-matrix-fg">{item.linkReview.remoteMeasures.join(" + ") || "Não informadas"}</p>
                        </div>
                      </div>
                    ) : null}
                    {item.linkReview.reasons.length ? (
                      <div>
                        <p className="text-xs font-semibold uppercase text-matrix-muted">Principais diferenças</p>
                        <ul className="mt-2 grid gap-1 text-matrix-fg">
                          {item.linkReview.reasons.map((reason) => (
                            <li key={reason}>• {linkMismatchReasonLabels[reason]}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {showLinkReview ? (
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-matrix-gold/35 bg-matrix-goldSoft/10 p-4 text-sm text-matrix-fg">
                    <input
                      checked={linkMismatchAcknowledged}
                      className="mt-0.5 h-4 w-4 accent-matrix-gold"
                      disabled={busy}
                      onChange={(event) => setLinkMismatchAcknowledged(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Confirmo que este é o mesmo produto.</span>
                  </label>
                ) : null}
              </div>
            </div>
          ) : item?.local ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]">
              <div className="min-w-0">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-matrix-fg">Fotos atuais no Bling</p>
                    <p className="mt-1 text-xs text-matrix-muted">
                      Elas serão preservadas enquanto você não escolher alterar as fotos.
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-matrix-muted">{remoteImages.length} foto(s)</span>
                </div>
                <div className="relative grid aspect-square max-h-[430px] place-items-center overflow-hidden rounded-lg border border-matrix-gold/30 bg-white">
                  {selectedImage ? (
                    <Image
                      alt={normalizedTitle || "Produto"}
                      className="h-full w-full object-contain"
                      fill
                      priority
                      sizes="(max-width: 1024px) 90vw, 430px"
                      src={selectedImage}
                      unoptimized
                    />
                  ) : (
                    <div className="text-center text-matrix-muted">
                      <ImageIcon className="mx-auto h-8 w-8" />
                      <p className="mt-2 text-sm">Nenhuma foto selecionada</p>
                    </div>
                  )}
                  {selectedImage ? (
                    <div className="absolute right-3 top-3 flex gap-2">
                      <button
                        aria-label="Definir como foto principal"
                        className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel/90 text-matrix-goldDark disabled:opacity-45"
                        disabled={!imagesPatchEnabled || !imagesEditingEnabled || selectedImageIndex === 0 || busy || completed}
                        onClick={makeSelectedImagePrimary}
                        title="Definir como foto principal"
                        type="button"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Remover foto"
                        className="grid h-10 w-10 place-items-center rounded-md border border-red-500/35 bg-matrix-panel/90 text-red-400 disabled:opacity-45"
                        disabled={!imagesPatchEnabled || !imagesEditingEnabled || busy || completed}
                        onClick={removeSelectedImage}
                        title="Remover foto"
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    aria-label="Foto anterior"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-matrix-border text-matrix-muted disabled:opacity-40"
                    disabled={selectedImageIndex <= 0}
                    onClick={() => setSelectedImageIndex((index) => Math.max(0, index - 1))}
                    type="button"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div aria-label="Fotos atuais no Bling" className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
                    {images.map((image, index) => (
                      <button
                        key={image}
                        aria-label={index === 0 ? "Foto principal" : `Foto ${index + 1}`}
                        className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-white ${
                          index === selectedImageIndex
                            ? "border-matrix-gold ring-2 ring-matrix-gold/25"
                            : "border-matrix-border"
                        }`}
                        onClick={() => setSelectedImageIndex(index)}
                        type="button"
                      >
                        <Image alt="" className="object-cover" fill sizes="64px" src={image} unoptimized />
                      </button>
                    ))}
                  </div>
                  <button
                    aria-label="Próxima foto"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-matrix-border text-matrix-muted disabled:opacity-40"
                    disabled={selectedImageIndex >= images.length - 1}
                    onClick={() => setSelectedImageIndex((index) => Math.min(images.length - 1, index + 1))}
                    type="button"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-5 rounded-md border border-matrix-border bg-matrix-panel2 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-matrix-fg">Fotos disponíveis no W Ecommerce</p>
                      <p className="mt-1 text-xs text-matrix-muted">
                        Use estas fotos somente quando quiser incluí-las na galeria do Bling.
                      </p>
                    </div>
                    <Button
                      className="shrink-0"
                      disabled={!imagesPatchEnabled || !localImages.length || imagesEditingEnabled || busy || completed}
                      onClick={useLocalImages}
                      type="button"
                      variant="secondary"
                    >
                      Usar estas fotos no Bling
                    </Button>
                  </div>
                  {localImages.length ? (
                    <div aria-label="Fotos disponíveis no W Ecommerce" className="mt-3 flex gap-2 overflow-x-auto py-1">
                      {localImages.map((image, index) => (
                        <div
                          key={image}
                          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-matrix-border bg-white"
                          title={`Foto disponível ${index + 1}`}
                        >
                          <Image alt="" className="object-cover" fill sizes="56px" src={image} unoptimized />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-matrix-muted">Nenhuma foto local disponível para incluir.</p>
                  )}
                  {imagesEditingEnabled ? (
                    <p className="mt-3 text-xs text-green-300">
                      As fotos locais foram adicionadas à seleção. Revise antes de atualizar.
                    </p>
                  ) : null}
                  {imagesAlreadySynced ? (
                    <p className="mt-3 text-xs text-green-300">
                      As fotos já estão atualizadas no Bling.
                    </p>
                  ) : null}
                  {imagesDifferent && !imagesPatchEnabled ? (
                    <p className="mt-3 text-xs text-amber-200">
                      As fotos não serão enviadas nesta atualização.
                    </p>
                  ) : null}
                  {galleryReductionRequiresConfirmation ? (
                    <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <input
                        checked={imageReductionAcknowledged}
                        className="mt-0.5 h-4 w-4 accent-matrix-gold"
                        disabled={busy || completed}
                        onChange={(event) => setImageReductionAcknowledged(event.target.checked)}
                        type="checkbox"
                      />
                      <span>Confirmo que revisei a remoção de fotos desta galeria.</span>
                    </label>
                  ) : null}
                </div>
              </div>

              <div className="flex min-w-0 flex-col justify-center gap-4">
                <label className="grid gap-2 text-sm font-semibold text-matrix-fg">
                  Título
                  <textarea
                    className="min-h-28 resize-y rounded-md border border-matrix-gold/35 bg-matrix-panel2 px-3 py-2 text-base font-semibold text-matrix-fg outline-none focus:border-matrix-gold/70"
                    disabled={!namePatchEnabled || busy || completed}
                    maxLength={120}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setNameTouched(true);
                    }}
                    value={title}
                  />
                </label>
                {item.local.name !== remote?.name ? (
                  <div className="rounded-md border border-matrix-border bg-matrix-panel2 p-3 text-sm">
                    <p className="text-matrix-muted">
                      {presentationOnlyTitleDifference
                        ? "O título do W Ecommerce tem apenas uma pequena diferença de apresentação."
                        : "Há um título diferente disponível no W Ecommerce."}
                    </p>
                    <button
                      className="mt-2 font-semibold text-matrix-goldDark hover:underline disabled:opacity-50"
                      disabled={!namePatchEnabled || busy || completed}
                      onClick={useLocalTitle}
                      type="button"
                    >
                      Usar título do W Ecommerce
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {friendlyMessage && !linkNeedsReview ? (
            <p
              className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                result?.status === "UPDATED" && !localRecordWarning
                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                  : localRecordWarning
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  : result?.status === "FAILED" || item?.status === "ERROR"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : "border-matrix-border bg-matrix-panel2 text-matrix-muted"
              }`}
            >
              {friendlyMessage}
            </p>
          ) : null}
          {canReview && nameChanged && !busy && !completed ? (
            <p className="mt-4 rounded-md border border-matrix-gold/30 bg-matrix-goldSoft/10 px-3 py-2 text-sm text-matrix-fg">
              {imagesDifferent && !imagesPatchEnabled
                ? "Somente o nome será atualizado. As fotos não serão enviadas nesta atualização."
                : "Somente o nome será atualizado."}
            </p>
          ) : null}
          {canReview && !hasDifferences && !imagesDifferent && !busy && !completed ? (
            <p className="mt-4 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm text-matrix-muted">
              Este produto já está atualizado no Bling.
            </p>
          ) : null}
          {formInvalid ? (
            <p className="mt-3 text-sm text-red-300">
              {imagesEditingEnabled && !images.length
                ? "Mantenha ao menos uma foto para atualizar a galeria."
                : imageRemovalNotExplicit
                  ? "Revise as fotos removidas antes de continuar."
                  : imageReductionUnconfirmed
                    ? "Confirme a redução da galeria antes de continuar."
                    : "Preencha os campos exibidos antes de continuar."}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-matrix-border px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-5">
          <Button
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={onClose}
            type="button"
            variant="secondary"
          >
            {linkNeedsReview ? "Fechar" : "Cancelar"}
          </Button>
          {linkNeedsReview ? (
            <Button
              className="w-full sm:w-auto"
              disabled={busy || (showLinkReview && !linkMismatchAcknowledged)}
              onClick={() => {
                if (!showLinkReview) {
                  setShowLinkReview(true);
                  return;
                }
                onConfirmLinkMismatch();
              }}
              type="button"
            >
              {busy
                ? "Confirmando vínculo..."
                : showLinkReview
                  ? "Continuar com este vínculo"
                  : "Revisar vínculo"}
            </Button>
          ) : (
            <Button
              className="w-full sm:w-auto"
              disabled={!canReview || !hasDifferences || formInvalid || busy || completed || retryBlocked}
              onClick={submit}
              type="button"
            >
              {busy
                ? nameChanged && !imagesChanged
                  ? "Atualizando nome..."
                  : "Atualizando produto..."
                : nameChanged && !imagesChanged
                  ? "Atualizar nome no Bling"
                  : "Atualizar no Bling"}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
