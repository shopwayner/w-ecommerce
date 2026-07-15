"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
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
  brand: string | null;
  images: string[];
};

export type BlingProductUpdatePreview = {
  item: {
    productId: string;
    status: "READY" | "UNCHANGED" | "NOT_LINKED" | "UNSUPPORTED" | "ERROR";
    message: string;
    local: BlingProductEditableValues | null;
    remote: BlingProductEditableValues | null;
  };
};

export type BlingProductUpdateResult = {
  productId: string;
  externalProductIdMasked: string | null;
  status: "UPDATED" | "UNCHANGED" | "FAILED";
  message: string;
  fields: Array<"name" | "brand" | "images">;
  code?: "LOCAL_MAPPING_CONCURRENT_UPDATE" | "LOCAL_MAPPING_RECORD_FAILED";
  replayed?: boolean;
};

type BlingProductUpdateModalProps = {
  busy: boolean;
  message: string;
  onClose: () => void;
  onConfirm: (fields: BlingProductEditableValues) => void;
  preview: BlingProductUpdatePreview | null;
  result: BlingProductUpdateResult | null;
};

function normalizeReviewText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sameImages(left: string[], right: string[]) {
  return left.length === right.length && left.every((image, index) => image === right[index]);
}

export function BlingProductUpdateModal({
  busy,
  message,
  onClose,
  onConfirm,
  preview,
  result
}: BlingProductUpdateModalProps) {
  const item = preview?.item ?? null;
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    setTitle(item?.local?.name ?? "");
    setBrand(item?.local?.brand ?? "");
    setImages(item?.local?.images ?? []);
    setSelectedImageIndex(0);
  }, [item?.productId, item?.local]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const normalizedTitle = normalizeReviewText(title);
  const normalizedBrand = normalizeReviewText(brand);
  const brandVisible = Boolean(item?.local?.brand);
  const remote = item?.remote;
  const canReview = Boolean(
    item?.local && remote && !["NOT_LINKED", "UNSUPPORTED", "ERROR"].includes(item.status)
  );
  const imagesChanged = Boolean(images.length && remote && !sameImages(images, remote.images));
  const hasDifferences = Boolean(
    remote &&
      (normalizedTitle !== normalizeReviewText(remote.name) ||
        (brandVisible && normalizedBrand !== normalizeReviewText(remote.brand ?? "")) ||
        imagesChanged)
  );
  const formInvalid = !normalizedTitle || (brandVisible && !normalizedBrand);
  const completed = result?.status === "UPDATED" || result?.status === "UNCHANGED";
  const selectedImage = images[selectedImageIndex] ?? null;
  const friendlyMessage = message || (!canReview ? item?.message ?? "" : "");
  const localRecordWarning = Boolean(result?.code);

  function makeSelectedImagePrimary() {
    if (selectedImageIndex <= 0) return;
    setImages((current) => {
      const selected = current[selectedImageIndex];
      if (!selected) return current;
      return [selected, ...current.filter((_, index) => index !== selectedImageIndex)];
    });
    setSelectedImageIndex(0);
  }

  function removeSelectedImage() {
    setImages((current) => current.filter((_, index) => index !== selectedImageIndex));
    setSelectedImageIndex((current) => Math.max(0, Math.min(current, images.length - 2)));
  }

  function submit() {
    if (!canReview || !hasDifferences || formInvalid || busy || completed) return;
    onConfirm({
      name: normalizedTitle,
      brand: brandVisible ? normalizedBrand : null,
      images
    });
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
              Atualizar produto no Bling
            </h3>
            <p className="mt-1 text-sm text-matrix-muted">
              Revise o título, a marca e as fotos antes de enviar.
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

          {item?.local ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]">
              <div className="min-w-0">
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
                        disabled={selectedImageIndex === 0 || busy || completed}
                        onClick={makeSelectedImagePrimary}
                        title="Definir como foto principal"
                        type="button"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Remover foto"
                        className="grid h-10 w-10 place-items-center rounded-md border border-red-500/35 bg-matrix-panel/90 text-red-400 disabled:opacity-45"
                        disabled={busy || completed}
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
                  <div aria-label="Galeria de fotos" className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
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
                {!images.length ? (
                  <p className="mt-2 text-xs text-matrix-muted">As fotos atuais do Bling serão preservadas.</p>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-col justify-center gap-4">
                <label className="grid gap-2 text-sm font-semibold text-matrix-fg">
                  Título
                  <textarea
                    className="min-h-28 resize-y rounded-md border border-matrix-gold/35 bg-matrix-panel2 px-3 py-2 text-base font-semibold text-matrix-fg outline-none focus:border-matrix-gold/70"
                    disabled={busy || completed}
                    maxLength={220}
                    onChange={(event) => setTitle(event.target.value)}
                    value={title}
                  />
                </label>
                {brandVisible ? (
                  <label className="grid gap-2 text-sm font-semibold text-matrix-fg">
                    Marca
                    <input
                      className="h-11 rounded-md border border-matrix-gold/35 bg-matrix-panel2 px-3 text-sm font-semibold text-matrix-fg outline-none focus:border-matrix-gold/70"
                      disabled={busy || completed}
                      maxLength={120}
                      onChange={(event) => setBrand(event.target.value)}
                      value={brand}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}

          {friendlyMessage ? (
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
          {canReview && !hasDifferences && !busy && !completed ? (
            <p className="mt-4 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm text-matrix-muted">
              Este produto já está atualizado no Bling.
            </p>
          ) : null}
          {formInvalid ? (
            <p className="mt-3 text-sm text-red-300">Preencha os campos exibidos antes de continuar.</p>
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
            Cancelar
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={!canReview || !hasDifferences || formInvalid || busy || completed}
            onClick={submit}
            type="button"
          >
            {busy ? "Atualizando produto..." : "Atualizar no Bling"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
