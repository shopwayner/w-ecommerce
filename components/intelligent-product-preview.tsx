"use client";

import Image from "next/image";
import { ArrowLeft, ChevronLeft, ChevronRight, ImageIcon, Save, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { normalizeIntelligentProductPreviewTitle } from "@/lib/intelligent-product-preview";

type IntelligentProductPreviewProps = {
  title: string;
  brand: string;
  showBrand: boolean;
  images: string[];
  selectedIndex: number;
  notice?: string | null;
  currentProduct?: {
    title: string;
    brand: string | null;
    imageCount: number;
  } | null;
  referenceDetails?: {
    gtin: string | null;
    price: string | null;
    attributes: Array<{ label: string; value: string }>;
  } | null;
  saving: boolean;
  canSave: boolean;
  onTitleChange: (value: string) => void;
  onBrandChange: (value: string) => void;
  onSelectImage: (index: number) => void;
  onNavigateImage: (direction: -1 | 1) => void;
  onMakePrimary: () => void;
  onRemoveImage: () => void;
  onSave: () => void;
  onBack: () => void;
};

export function IntelligentProductPreview({
  title,
  brand,
  showBrand,
  images,
  selectedIndex,
  notice,
  currentProduct,
  referenceDetails,
  saving,
  canSave,
  onTitleChange,
  onBrandChange,
  onSelectImage,
  onNavigateImage,
  onMakePrimary,
  onRemoveImage,
  onSave,
  onBack
}: IntelligentProductPreviewProps) {
  const selectedImage = images[selectedIndex] ?? null;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col">
      <div className="matrix-scroll min-h-0 flex-1 overflow-y-auto pb-4">
        <section className="rounded-lg border border-matrix-gold/45 bg-matrix-panel2/72 p-4 shadow-glow sm:p-5">
        <div>
          <h4 className="text-lg font-semibold text-matrix-goldDark">Prévia do produto</h4>
          <p className="mt-1 text-sm text-matrix-muted">Confira o título e as fotos antes de salvar.</p>
          {notice ? (
            <p className="mt-3 rounded-md border border-matrix-gold/35 bg-matrix-goldSoft/18 px-3 py-2 text-sm text-matrix-fg">
              {notice}
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,1fr)] lg:items-start">
          <div className="min-w-0">
            <div className="relative aspect-square w-full overflow-hidden rounded-md border border-matrix-gold/35 bg-white">
              {selectedImage ? (
                <Image
                  alt={title || "Produto"}
                  className="object-contain p-3"
                  fill
                  priority
                  sizes="(max-width: 1024px) 90vw, 42vw"
                  src={selectedImage}
                  unoptimized
                />
              ) : (
                <div className="grid h-full place-items-center p-6 text-center text-matrix-muted">
                  <div>
                    <ImageIcon className="mx-auto h-10 w-10" />
                    <p className="mt-3 text-sm font-semibold">Nenhuma foto disponível</p>
                  </div>
                </div>
              )}

              {selectedImage ? (
                <div className="absolute right-3 top-3 flex gap-2">
                  <button
                    aria-label="Definir como foto principal"
                    className="grid h-10 w-10 place-items-center rounded-md border border-matrix-gold/45 bg-matrix-panel/95 text-matrix-gold transition hover:bg-matrix-goldSoft disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={selectedIndex === 0}
                    onClick={onMakePrimary}
                    title="Definir como foto principal"
                    type="button"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                  <button
                    aria-label="Remover foto da seleção"
                    className="grid h-10 w-10 place-items-center rounded-md border border-red-400/45 bg-matrix-panel/95 text-red-300 transition hover:bg-red-500/15"
                    onClick={onRemoveImage}
                    title="Remover foto da seleção"
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                aria-label="Foto anterior"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-matrix-border bg-matrix-panel text-matrix-fg transition hover:border-matrix-gold/50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={images.length < 2}
                onClick={() => onNavigateImage(-1)}
                title="Foto anterior"
                type="button"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-xs text-matrix-muted">
                {images.length ? selectedIndex + 1 + " de " + images.length : "Sem fotos"}
              </span>
              <button
                aria-label="Próxima foto"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-matrix-border bg-matrix-panel text-matrix-fg transition hover:border-matrix-gold/50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={images.length < 2}
                onClick={() => onNavigateImage(1)}
                title="Próxima foto"
                type="button"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <label className="block text-sm font-semibold text-matrix-fg">
              Título
              <textarea
                className="mt-2 min-h-28 w-full resize-y rounded-md border border-matrix-gold/35 bg-matrix-panel px-3 py-3 text-base font-semibold leading-6 text-matrix-fg outline-none transition focus:border-matrix-gold"
                maxLength={220}
                onChange={(event) => onTitleChange(event.target.value)}
                value={title}
              />
            </label>

            {showBrand ? (
              <label className="block text-sm font-semibold text-matrix-fg">
                Marca
                <input
                  className="mt-2 w-full rounded-md border border-matrix-gold/35 bg-matrix-panel px-3 py-3 text-sm text-matrix-fg outline-none transition focus:border-matrix-gold"
                  maxLength={120}
                  onChange={(event) => onBrandChange(event.target.value)}
                  value={brand}
                />
              </label>
            ) : null}
          </div>
        </div>

        {images.length ? (
          <div className="matrix-scroll mt-4 flex max-w-full gap-2 overflow-x-auto pb-2" aria-label="Galeria de fotos">
            {images.map((url, index) => (
              <button
                aria-label={index === 0 ? "Foto principal" : "Selecionar foto " + (index + 1)}
                className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-white transition ${
                  selectedIndex === index ? "border-matrix-gold" : "border-matrix-border hover:border-matrix-gold/55"
                }`}
                key={url}
                onClick={() => onSelectImage(index)}
                title={index === 0 ? "Foto principal" : "Selecionar foto " + (index + 1)}
                type="button"
              >
                <Image alt="" className="object-contain p-1" fill priority={index === 0} sizes="80px" src={url} unoptimized />
                {index === 0 ? (
                  <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-matrix-panel/90 text-matrix-gold" title="Foto principal">
                    <Star className="h-3 w-3 fill-current" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {referenceDetails?.gtin || referenceDetails?.price || referenceDetails?.attributes.length ? (
          <div className="mt-4 border-t border-matrix-border pt-4">
            <h5 className="text-sm font-semibold text-matrix-fg">Dados do anúncio escolhido</h5>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-matrix-muted">
              {referenceDetails.gtin ? <span>GTIN: {referenceDetails.gtin}</span> : null}
              {referenceDetails.price ? <span>Preço de referência: {referenceDetails.price}</span> : null}
            </div>
            {referenceDetails.attributes.length ? (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Atributos básicos do anúncio">
                {referenceDetails.attributes.map((attribute) => (
                  <span
                    className="rounded border border-matrix-border bg-matrix-panel px-2 py-1 text-xs text-matrix-muted"
                    key={`${attribute.label}-${attribute.value}`}
                  >
                    {attribute.label}: {attribute.value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {currentProduct ? (
          <div className="mt-4 border-t border-matrix-border pt-4">
            <h5 className="text-sm font-semibold text-matrix-fg">Comparação</h5>
            <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2 sm:divide-x sm:divide-matrix-border">
              <dl className="min-w-0 space-y-2">
                <dt className="font-semibold text-matrix-fg">Produto atual</dt>
                <dd className="break-words text-matrix-muted">Nome: {currentProduct.title}</dd>
                <dd className="break-words text-matrix-muted">Marca: {currentProduct.brand || "Não informada"}</dd>
                <dd className="text-matrix-muted">Fotos atuais: {currentProduct.imageCount}</dd>
              </dl>
              <dl className="min-w-0 space-y-2 sm:pl-4">
                <dt className="font-semibold text-matrix-fg">Produto escolhido</dt>
                <dd className="break-words text-matrix-muted">Novo nome: {title}</dd>
                <dd className="break-words text-matrix-muted">
                  Nova marca: {showBrand && brand ? brand : "Marca atual preservada"}
                </dd>
                <dd className="text-matrix-muted">Novas fotos: {images.length}</dd>
              </dl>
            </div>
          </div>
        ) : null}
        </section>
      </div>

      <div className="shrink-0 space-y-3 border-t border-matrix-border bg-matrix-panel py-4 pt-5">
        <Button
          className="w-full justify-center py-3 text-base"
          disabled={!canSave || saving || !normalizeIntelligentProductPreviewTitle(title)}
          onClick={onSave}
          type="button"
        >
          <Save className="h-4 w-4" />
          {saving ? "Atualizando produto..." : "Atualizar produto no W Ecommerce"}
        </Button>
        <Button className="w-full justify-center" disabled={saving} onClick={onBack} type="button" variant="secondary">
          <ArrowLeft className="h-4 w-4" />
          Voltar e revisar dados
        </Button>
      </div>
    </div>
  );
}
