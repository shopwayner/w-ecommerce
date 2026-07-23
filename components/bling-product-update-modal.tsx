"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  RefreshCw,
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
  confirmedIncidentReview?: true;
  incidentReviewConfirmation?: string;
  confirmedLinkMismatch?: true;
  linkMismatchConfirmation?: string;
  capabilities: {
    namePatchEnabled: boolean;
    imagesPatchEnabled: boolean;
  };
  item: {
    productId: string;
    status: "READY" | "UNCHANGED" | "INCIDENT_REVIEW_REQUIRED" | "VINCULO_PRECISA_REVISAO" | "NOT_LINKED" | "UNSUPPORTED" | "ERROR";
    message: string;
    local: BlingProductEditableValues | null;
    remote: BlingProductEditableValues | null;
    imageComparison?: "IMAGES_ALREADY_SYNCED" | "IMAGES_DIFFERENT" | "IMAGES_UNKNOWN";
    dryRun?: {
      appendPlanValid: boolean;
      canUpdate: boolean;
      safeToExecute: boolean;
      changedFields: Array<"name" | "images">;
      preservedFields: string[];
      missingFields: string[];
      ambiguousFields: string[];
      remoteImageCount: number;
      selectedImageCount: number;
      newImageCount: number;
      duplicateImageCount: number;
      finalImageCount: number;
      remoteImages: string[];
      selectedImages: string[];
      newImages: string[];
      duplicateImages: string[];
      finalImages: string[];
      appendOnly: boolean;
      remoteOrderPreserved: boolean;
      remotePrincipalPreserved: boolean;
      remoteGalleryComplete: boolean;
      imageWriteContract: "COMPLETE_GALLERY_PATCH";
      protectedFieldsFingerprint: string;
      remoteGalleryFingerprint: string;
      imageAppendConfirmation?: string;
      payloadKeys: string[];
      externalProductIdMasked: string | null;
      payloadPreview?: {
        midia?: {
          video: { url: string };
          imagens: { imagensURL: Array<{ link: string }> };
        };
      };
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
    incidentReview?: {
      status: "INCIDENT_REVIEW_REQUIRED";
      externalProductIdMasked: string | null;
      localName: string;
      remoteName: string;
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
    | "ABORTED_PRECONDITION_REMOTE_GALLERY_CHANGED"
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
  onConfirmImages: (images: string[], confirmation: string) => void;
  onPreviewImages: (images: string[]) => void;
  onConfirmIncidentReview: () => void;
  onConfirmLinkMismatch: () => void;
  preview: BlingProductUpdatePreview | null;
  result: BlingProductUpdateResult | null;
};

function normalizeReviewText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePresentationText(value: string) {
  return normalizeReviewText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  onConfirmImages,
  onPreviewImages,
  onConfirmIncidentReview,
  onConfirmLinkMismatch,
  preview,
  result
}: BlingProductUpdateModalProps) {
  const item = preview?.item ?? null;
  const [title, setTitle] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [selectedLocalImages, setSelectedLocalImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [linkMismatchAcknowledged, setLinkMismatchAcknowledged] = useState(false);
  const [showIncidentReview, setShowIncidentReview] = useState(false);
  const [incidentReviewAcknowledged, setIncidentReviewAcknowledged] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    setTitle(item?.remote?.name ?? item?.local?.name ?? "");
    setImages(item?.remote?.images ?? []);
    setSelectedLocalImages([]);
    setSelectedImageIndex(0);
    setShowLinkReview(false);
    setLinkMismatchAcknowledged(false);
    setShowIncidentReview(false);
    setIncidentReviewAcknowledged(false);
    setNameTouched(false);
    // Keep the selected local photos when this product receives a refreshed dry-run preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.productId]);

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
  const imagePreviewMatchesSelection = Boolean(
    item?.dryRun
    && item.dryRun.selectedImages.length === selectedLocalImages.length
    && item.dryRun.selectedImages.every((image, index) => image === selectedLocalImages[index])
  );
  const imageLimitExceeded =
    item?.dryRun?.missingFields.some((field) =>
      field.endsWith("IMAGE_LIMIT_EXCEEDED"),
    ) ?? false;
  const canConfirmImages = Boolean(
    imagePreviewMatchesSelection
    && item?.dryRun?.appendPlanValid
    && item.dryRun.imageAppendConfirmation
    && imagesPatchEnabled
  );
  const incidentNeedsReview = item?.status === "INCIDENT_REVIEW_REQUIRED";
  const incidentNameOnly = preview?.confirmedIncidentReview === true;
  const linkNeedsReview = item?.status === "VINCULO_PRECISA_REVISAO";
  const canReview = Boolean(
    item?.local && remote && !["INCIDENT_REVIEW_REQUIRED", "VINCULO_PRECISA_REVISAO", "NOT_LINKED", "UNSUPPORTED", "ERROR"].includes(item.status)
  );
  const nameChanged = Boolean(nameTouched && remote && normalizedTitle !== normalizeReviewText(remote.name));
  const hasDifferences = nameChanged;
  const formInvalid = nameTouched && !normalizedTitle;
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

  function toggleLocalImage(image: string) {
    if (busy || completed) return;
    setSelectedLocalImages((current) => current.includes(image)
      ? current.filter((candidate) => candidate !== image)
      : [...current, image]
    );
  }

  function moveSelectedLocalImage(index: number, direction: -1 | 1) {
    setSelectedLocalImages((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
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
              {incidentNeedsReview
                ? "Revisão necessária"
                : linkNeedsReview
                  ? "Revisar vínculo"
                  : "Atualizar produto no Bling"}
            </h3>
            <p className="mt-1 text-sm text-matrix-muted">
              {incidentNeedsReview
                ? "Este produto teve uma atualização anterior com divergências. Revise antes de continuar."
                : linkNeedsReview
                  ? "Confira os dois cadastros antes de continuar."
                  : incidentNameOnly
                    ? "Revise somente o nome antes de enviar."
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

          {item?.local && incidentNeedsReview ? (
            <div className="mx-auto grid max-w-2xl gap-4">
              <div className="flex gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-100">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>Este produto teve uma atualização anterior com divergências. Revise antes de continuar.</p>
              </div>
              {showIncidentReview && item.incidentReview ? (
                <>
                  <div className="grid gap-3 rounded-md border border-matrix-border bg-matrix-panel2 p-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase text-matrix-muted">Nome atual no W Ecommerce</p>
                      <p className="mt-1 text-matrix-fg">{item.incidentReview.localName}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-matrix-muted">Nome atual no Bling</p>
                      <p className="mt-1 text-matrix-fg">{item.incidentReview.remoteName}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-matrix-muted">ID Bling</p>
                      <p className="mt-1 text-matrix-fg">{item.incidentReview.externalProductIdMasked ?? "Indisponível"}</p>
                    </div>
                    <p className="rounded-md border border-matrix-gold/30 bg-matrix-goldSoft/10 p-3 text-matrix-fg">
                      Somente o nome poderá ser alterado. Fotos e dados comerciais permanecerão bloqueados.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-matrix-gold/35 bg-matrix-goldSoft/10 p-4 text-sm text-matrix-fg">
                    <input
                      checked={incidentReviewAcknowledged}
                      className="mt-0.5 h-4 w-4 accent-matrix-gold"
                      disabled={busy}
                      onChange={(event) => setIncidentReviewAcknowledged(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Confirmo que revisei este produto e desejo liberar somente a atualização do nome.</span>
                  </label>
                </>
              ) : null}
            </div>
          ) : item?.local && linkNeedsReview ? (
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
                      {incidentNameOnly
                        ? "Somente para visualização."
                        : "Elas serão preservadas enquanto você não escolher alterar as fotos."}
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
                {!incidentNameOnly ? (
                <div className="mt-5 rounded-md border border-matrix-border bg-matrix-panel2 p-3">
                  <div>
                    <p className="text-sm font-semibold text-matrix-fg">Novas fotos selecionadas</p>
                    <p className="mt-1 text-xs text-matrix-muted">
                      Selecione somente as fotos que deseja acrescentar ao final da galeria atual.
                    </p>
                  </div>
                  {localImages.length ? (
                    <div aria-label="Fotos disponíveis no W Ecommerce" className="mt-3 flex gap-2 overflow-x-auto py-1">
                      {localImages.map((image, index) => (
                        <button
                          key={image}
                          aria-pressed={selectedLocalImages.includes(image)}
                          className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-white ${
                            selectedLocalImages.includes(image)
                              ? "border-matrix-gold ring-2 ring-matrix-gold/30"
                              : "border-matrix-border"
                          }`}
                          disabled={busy || completed}
                          onClick={() => toggleLocalImage(image)}
                          title={`Selecionar foto ${index + 1}`}
                          type="button"
                        >
                          <Image alt="" className="object-cover" fill sizes="64px" src={image} unoptimized />
                          {selectedLocalImages.includes(image) ? (
                            <span className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-matrix-gold px-1 text-[10px] font-bold text-black">
                              {selectedLocalImages.indexOf(image) + 1}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-matrix-muted">Nenhuma foto local disponível para incluir.</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-matrix-muted">
                    <span>{selectedLocalImages.length} foto(s) selecionada(s)</span>
                    <span>Ordem somente das novas fotos</span>
                  </div>
                  {selectedLocalImages.length ? (
                    <div aria-label="Ordem das novas fotos" className="mt-2 flex gap-2 overflow-x-auto py-1">
                      {selectedLocalImages.map((image, index) => (
                        <div key={image} className="w-20 shrink-0 rounded-md border border-matrix-border bg-matrix-panel p-1.5">
                          <div className="relative h-14 overflow-hidden rounded bg-white">
                            <Image alt="" className="object-cover" fill sizes="56px" src={image} unoptimized />
                            <span className="absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-matrix-gold px-1 text-[10px] font-bold text-black">
                              {index + 1}
                            </span>
                          </div>
                          <div className="mt-1 flex justify-between gap-1">
                            <button
                              aria-label={`Mover nova foto ${index + 1} para a esquerda`}
                              className="grid h-7 w-7 place-items-center rounded border border-matrix-border text-matrix-muted disabled:opacity-35"
                              disabled={index === 0 || busy || completed}
                              onClick={() => moveSelectedLocalImage(index, -1)}
                              title="Mover para a esquerda"
                              type="button"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              aria-label={`Mover nova foto ${index + 1} para a direita`}
                              className="grid h-7 w-7 place-items-center rounded border border-matrix-border text-matrix-muted disabled:opacity-35"
                              disabled={index === selectedLocalImages.length - 1 || busy || completed}
                              onClick={() => moveSelectedLocalImage(index, 1)}
                              title="Mover para a direita"
                              type="button"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
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
                  <Button
                    className="mt-3 w-full sm:w-auto"
                    disabled={!selectedLocalImages.length || busy || completed}
                    onClick={() => onPreviewImages(selectedLocalImages)}
                    type="button"
                    variant="secondary"
                  >
                    Adicionar fotos ao Bling
                  </Button>
                  <p className="mt-2 text-xs text-matrix-muted">
                    Este primeiro passo apenas gera a prévia. Nenhuma foto é enviada sem a confirmação seguinte.
                  </p>

                  {item.dryRun && imagePreviewMatchesSelection ? (
                    <div className="mt-4 rounded-md border border-matrix-gold/30 bg-matrix-panel p-3 text-sm">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <p>Atuais no Bling: <strong>{item.dryRun.remoteImageCount}</strong></p>
                        <p>Novas selecionadas: <strong>{item.dryRun.selectedImageCount}</strong></p>
                        <p>Duplicadas ignoradas: <strong>{item.dryRun.duplicateImageCount}</strong></p>
                        <p>Total após atualização: <strong>{item.dryRun.finalImageCount}</strong></p>
                      </div>
                      {!imagesPatchEnabled ? (
                        <p className="mt-3 text-xs text-amber-200">
                          A atualização de fotos permanece bloqueada durante a validação controlada.
                        </p>
                      ) : null}
                      {imageLimitExceeded ? (
                        <p className="mt-3 text-xs text-rose-300">
                          Este produto ultrapassaria o limite de 13 imagens.
                        </p>
                      ) : null}
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase text-matrix-muted">Resultado final previsto</p>
                        <div className="mt-2 flex gap-2 overflow-x-auto py-1">
                          {item.dryRun.finalImages.map((image, index) => (
                            <div
                              key={`${image}-${index}`}
                              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-matrix-border bg-white"
                              title={index < item.dryRun!.remoteImageCount ? `Foto atual ${index + 1}` : `Nova foto ${index + 1}`}
                            >
                              <Image alt="" className="object-cover" fill sizes="56px" src={image} unoptimized />
                              {index === 0 ? (
                                <span className="absolute bottom-0 left-0 right-0 bg-black/75 py-0.5 text-center text-[9px] text-white">Principal</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                      {item.dryRun.appendPlanValid ? (
                        <p className="mt-3 flex items-center gap-2 text-xs text-green-300">
                          <Check className="h-4 w-4" />
                          Todas as fotos remotas permanecem na mesma ordem; as novas entram somente no final.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-col justify-center gap-4">
                <label className="grid gap-2 text-sm font-semibold text-matrix-fg">
                  {incidentNameOnly ? "Nome" : "Título"}
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
                      {incidentNameOnly ? "Usar nome do W Ecommerce" : "Usar título do W Ecommerce"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {friendlyMessage && !incidentNeedsReview && !linkNeedsReview ? (
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
              {incidentNameOnly
                ? "Somente o nome será atualizado. Fotos e dados comerciais permanecerão inalterados."
                : imagesDifferent && !imagesPatchEnabled
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
              Preencha os campos exibidos antes de continuar.
            </p>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-matrix-border px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-5">
          <Button
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => {
              if (incidentNeedsReview && showIncidentReview) {
                setShowIncidentReview(false);
                setIncidentReviewAcknowledged(false);
                return;
              }
              onClose();
            }}
            type="button"
            variant="secondary"
          >
            {incidentNeedsReview && showIncidentReview
              ? "Voltar"
              : linkNeedsReview
                ? "Fechar"
                : "Cancelar"}
          </Button>
          {incidentNeedsReview ? (
            <Button
              className="w-full sm:w-auto"
              disabled={busy || (showIncidentReview && !incidentReviewAcknowledged)}
              onClick={() => {
                if (!showIncidentReview) {
                  setShowIncidentReview(true);
                  return;
                }
                onConfirmIncidentReview();
              }}
              type="button"
            >
              {busy
                ? "Liberando atualização..."
                : showIncidentReview
                  ? "Liberar atualização do nome"
                  : "Revisar produto"}
            </Button>
          ) : linkNeedsReview ? (
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
            <>
              {item?.dryRun && imagePreviewMatchesSelection ? (
                <Button
                  className="w-full sm:w-auto"
                  disabled={!canConfirmImages || busy || completed || retryBlocked}
                  onClick={() => {
                    const confirmation = item.dryRun?.imageAppendConfirmation;
                    if (confirmation) onConfirmImages(selectedLocalImages, confirmation);
                  }}
                  type="button"
                >
                  {busy ? "Adicionando fotos..." : "Confirmar e adicionar fotos"}
                </Button>
              ) : null}
              <Button
                className="w-full sm:w-auto"
                disabled={!canReview || !hasDifferences || formInvalid || busy || completed || retryBlocked}
                onClick={submit}
                type="button"
              >
                {busy ? "Atualizando nome..." : "Atualizar somente nome"}
              </Button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
