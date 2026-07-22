"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckSquare2, ImagePlus, Save, Search, ShieldCheck, ZoomIn, X } from "lucide-react";
import { Button } from "@/components/ui";
import {
  deduplicateMercadoLivreProductPhotos,
  selectedMercadoLivrePhotoUrls,
  toggleMercadoLivrePhotoSelection,
  type MercadoLivreProductPhoto
} from "@/lib/mercado-livre-product-photos";
import { normalizeMercadoLivreReferenceImageUrl } from "@/lib/mercado-livre-reference-images";

type MercadoLivrePhotoSearchPage = {
  sessionId?: string;
  photos: MercadoLivreProductPhoto[];
  paging: { page: number; pageSize: number; hasNextPage: boolean; sessionLimitReached?: boolean };
  progress?: { analyzedResults: number; nextStart: number | null; nextEnd: number | null };
  stats: {
    gtinResults: number | null;
    titleResults: number | null;
    urlsFound: number;
    duplicatesRemoved: number;
    displayedPhotos: number;
    analyzedResults?: number;
    batchNewPhotos?: number;
  };
  readOnly: true;
  externalWrite: false;
};

export function MercadoLivrePhotoSearchModal({
  productId,
  productName,
  existingImageUrls,
  maximumSelectable,
  onCancel,
  onApply,
  loadPage
}: {
  productId: string;
  productName: string;
  existingImageUrls: readonly string[];
  maximumSelectable: number;
  onCancel: () => void;
  onApply: (urls: string[]) => void;
  loadPage?: (page: number, signal?: AbortSignal) => Promise<MercadoLivrePhotoSearchPage>;
}) {
  const [photos, setPhotos] = useState<MercadoLivreProductPhoto[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [analyzedResults, setAnalyzedResults] = useState(0);
  const [sessionLimitReached, setSessionLimitReached] = useState(false);
  const [nextRange, setNextRange] = useState<{ start: number; end: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<MercadoLivreProductPhoto | null>(null);
  const initialLoadStarted = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const loadInFlightRef = useRef(false);

  const selectedUrls = useMemo(
    () => selectedMercadoLivrePhotoUrls(photos, selectedIds),
    [photos, selectedIds]
  );
  const existingUrlKeys = useMemo(
    () => new Set(
      existingImageUrls
        .map(normalizeMercadoLivreReferenceImageUrl)
        .filter((url): url is string => Boolean(url))
    ),
    [existingImageUrls]
  );

  async function requestPage(nextPage: number, signal: AbortSignal) {
    if (loadPage) return loadPage(nextPage, signal);
    const query = new URLSearchParams({ page: String(nextPage) });
    if (sessionIdRef.current) query.set("sessionId", sessionIdRef.current);
    const response = await fetch(
      `/api/products/${encodeURIComponent(productId)}/mercado-livre/photos?${query.toString()}`,
      { cache: "no-store", signal }
    );
    const payload = (await response.json()) as { data?: MercadoLivrePhotoSearchPage; error?: string };
    if (!response.ok || !payload.data) {
      throw new Error(payload.error ?? "Não foi possível consultar o Mercado Livre agora.");
    }
    return payload.data;
  }

  async function load(nextPage: number) {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const result = await requestPage(nextPage, controller.signal);
      if (controller.signal.aborted) return;
      if (result.sessionId) sessionIdRef.current = result.sessionId;
      setPhotos((current) => deduplicateMercadoLivreProductPhotos([
        ...current.map((photo) => ({ imageId: photo.id, url: photo.url, width: photo.width, height: photo.height })),
        ...result.photos
          .filter((photo) => !existingUrlKeys.has(normalizeMercadoLivreReferenceImageUrl(photo.url) ?? ""))
          .map((photo) => ({ imageId: photo.id, url: photo.url, width: photo.width, height: photo.height }))
      ]).photos);
      setPage(result.paging.page);
      setHasMore(result.paging.hasNextPage);
      setAnalyzedResults(result.progress?.analyzedResults ?? result.stats.analyzedResults ?? 0);
      setSessionLimitReached(Boolean(result.paging.sessionLimitReached));
      setNextRange(
        result.progress?.nextStart && result.progress.nextEnd
          ? { start: result.progress.nextStart, end: result.progress.nextEnd }
          : null
      );
    } catch (loadError) {
      if (controller.signal.aborted || (loadError instanceof Error && loadError.name === "AbortError")) return;
      setError("Não foi possível consultar o Mercado Livre agora.");
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        loadInFlightRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void load(1);
    return () => {
      const activeRequest = requestControllerRef.current;
      requestControllerRef.current = null;
      activeRequest?.abort();
      loadInFlightRef.current = false;
    };
  // A primeira consulta pertence ao ciclo de vida desta janela.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cancelAndClose() {
    const activeRequest = requestControllerRef.current;
    requestControllerRef.current = null;
    activeRequest?.abort();
    loadInFlightRef.current = false;
    onCancel();
  }

  function togglePhoto(photoId: string) {
    setSelectedIds((current) => toggleMercadoLivrePhotoSelection(current, photoId, maximumSelectable));
  }

  function discardBrokenPhoto(photoId: string) {
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
    setSelectedIds((current) => current.filter((id) => id !== photoId));
    setZoomedPhoto((current) => current?.id === photoId ? null : current);
  }

  const selectedLabel = `${selectedIds.length} ${selectedIds.length === 1 ? "foto selecionada" : "fotos selecionadas"}`;
  const selectionLimitReached = maximumSelectable === 0 || selectedIds.length >= maximumSelectable;
  const loadMoreLabel = loadingMore && nextRange
    ? `Analisando resultados ${nextRange.start} a ${nextRange.end}...`
    : loadingMore
      ? "Analisando o próximo lote..."
      : "Carregar mais fotos";

  return (
    <div className="fixed inset-0 z-[85] bg-black/80 p-1 backdrop-blur-md sm:p-2">
      <section aria-modal="true" className="mx-auto flex h-[calc(100dvh-0.5rem)] w-full max-w-[1640px] flex-col overflow-hidden rounded-xl border border-matrix-gold/35 bg-matrix-panel shadow-glow sm:h-[calc(100dvh-1rem)]" role="dialog">
        <header className="flex shrink-0 items-start gap-3 border-b border-matrix-border px-4 py-3 sm:px-5">
          <button aria-label="Voltar" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md text-matrix-goldDark transition hover:bg-matrix-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold" onClick={cancelAndClose} type="button"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-matrix-fg">Buscar fotos no Mercado Livre</h2>
            <p className="mt-0.5 break-words text-xs text-matrix-muted">Fotos encontradas para: {productName}</p>
          </div>
          <button aria-label="Fechar busca de fotos" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-matrix-border text-matrix-muted transition hover:border-matrix-gold/70 hover:text-matrix-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold" onClick={cancelAndClose} type="button"><X className="h-5 w-5" /></button>
        </header>

        <div className="matrix-scroll grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_270px] lg:overflow-hidden">
          <main className="matrix-scroll px-4 py-4 sm:px-5 lg:min-h-0 lg:overflow-y-auto">
            {loading ? <div className="grid min-h-56 place-items-center text-sm font-semibold text-matrix-muted"><span className="inline-flex items-center gap-2"><Search className="h-4 w-4 animate-pulse text-matrix-goldDark" />Buscando fotos no Mercado Livre...</span></div> : null}
            {!loading && error && photos.length === 0 ? <div className="grid min-h-56 place-items-center text-center"><div><p className="text-sm font-semibold text-matrix-fg">{error}</p><Button className="mt-3" onClick={() => void load(Math.max(1, page || 1))} type="button" variant="secondary">Tentar novamente</Button></div></div> : null}
            {!loading && !error && photos.length === 0 && !hasMore ? <div className="grid min-h-56 place-items-center text-center text-sm font-semibold text-matrix-muted">Nenhuma foto foi encontrada para este produto.</div> : null}

            {!loading && (photos.length || hasMore || sessionLimitReached) ? (
              <>
                {error ? <p className="mb-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
                {photos.length ? <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {photos.map((photo, index) => {
                    const selected = selectedIds.includes(photo.id);
                    return (
                      <article key={photo.id} className={`relative aspect-[4/3] overflow-hidden rounded-lg border-2 bg-white transition ${selected ? "border-matrix-gold shadow-glow" : "border-zinc-300"}`}>
                        <input
                          aria-label={`Selecionar foto ${index + 1}`}
                          checked={selected}
                          className="absolute left-2 top-2 z-10 h-4 w-4 accent-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold"
                          disabled={!selected && selectionLimitReached}
                          onChange={() => togglePhoto(photo.id)}
                          type="checkbox"
                        />
                        <button aria-label={`Ampliar foto ${index + 1}`} className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-md bg-zinc-200/95 text-zinc-700 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" onClick={() => setZoomedPhoto(photo)} type="button"><ZoomIn className="h-4 w-4" /></button>
                        <Image alt={`Foto ${index + 1} encontrada para ${productName}`} className="h-full w-full object-contain p-2" fill onError={() => discardBrokenPhoto(photo.id)} sizes="(min-width: 1536px) 18vw, (min-width: 1024px) 22vw, (min-width: 768px) 30vw, 48vw" src={photo.url} unoptimized />
                      </article>
                    );
                  })}
                </div> : null}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-matrix-border pt-4">
                  <div className="space-y-1 text-xs text-matrix-muted">
                    <p>{photos.length} {photos.length === 1 ? "foto encontrada" : "fotos encontradas"}</p>
                    <p>{analyzedResults} {analyzedResults === 1 ? "resultado analisado" : "resultados analisados"}</p>
                    {selectionLimitReached ? <p className="font-semibold text-matrix-goldDark">Limite de imagens atingido.</p> : null}
                    {sessionLimitReached ? <p className="max-w-2xl font-semibold text-matrix-goldDark">Limite de consulta atingido. Refine o título do produto para encontrar fotos mais específicas.</p> : null}
                  </div>
                  {hasMore ? <Button disabled={loadingMore} onClick={() => void load(page + 1)} type="button" variant="secondary">{loadMoreLabel}</Button> : null}
                  {!hasMore && !sessionLimitReached ? <p className="text-xs font-semibold text-matrix-muted">Não há mais fotos para carregar.</p> : null}
                </div>
              </>
            ) : null}
          </main>

          <aside className="matrix-scroll border-t border-matrix-border bg-matrix-panel2/65 px-4 py-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <h3 className="text-sm font-bold text-matrix-fg">Como funciona?</h3>
            <p className="mt-2 text-xs leading-5 text-matrix-muted">Buscamos imagens semelhantes no Mercado Livre e apresentamos para você escolher.</p>
            <div className="mt-4 space-y-4">
              <div className="flex gap-3"><CheckSquare2 className="mt-0.5 h-5 w-5 shrink-0 text-matrix-goldDark" /><div><p className="text-xs font-semibold text-matrix-fg">Selecione as fotos</p><p className="mt-1 text-xs leading-5 text-matrix-muted">Marque as imagens que deseja adicionar ao produto.</p></div></div>
              <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-matrix-goldDark" /><div><p className="text-xs font-semibold text-matrix-fg">Defina a principal</p><p className="mt-1 text-xs leading-5 text-matrix-muted">A primeira imagem selecionada será definida como principal entre as novas fotos.</p></div></div>
              <div className="flex gap-3"><Save className="mt-0.5 h-5 w-5 shrink-0 text-matrix-goldDark" /><div><p className="text-xs font-semibold text-matrix-fg">Aplicar e salvar</p><p className="mt-1 text-xs leading-5 text-matrix-muted">As fotos serão adicionadas à galeria do produto para revisão.</p></div></div>
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-matrix-border pt-4 text-xs text-matrix-muted"><ImagePlus className="h-4 w-4 text-matrix-goldDark" />Você pode adicionar mais {maximumSelectable} fotos.</div>
          </aside>
        </div>

        <footer className="grid shrink-0 grid-cols-1 items-center gap-2 border-t border-matrix-border bg-matrix-panel px-4 py-3 shadow-[0_-12px_32px_rgb(0_0_0/0.2)] sm:grid-cols-[auto_1fr_auto] sm:px-5">
          <Button onClick={cancelAndClose} type="button" variant="secondary">Cancelar</Button>
          <p aria-live="polite" className="text-center text-xs text-matrix-muted">{selectedLabel}</p>
          <Button disabled={!selectedUrls.length} onClick={() => onApply(selectedUrls)} type="button">Aplicar fotos selecionadas</Button>
        </footer>
      </section>

      {zoomedPhoto ? (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-black/90 p-4" onMouseDown={(event) => event.target === event.currentTarget && setZoomedPhoto(null)}>
          <div className="relative h-full max-h-[88dvh] w-full max-w-5xl overflow-hidden rounded-xl bg-white">
            <Image alt={`Foto ampliada de ${productName}`} className="object-contain p-3" fill onError={() => discardBrokenPhoto(zoomedPhoto.id)} sizes="90vw" src={zoomedPhoto.url} unoptimized />
            <button aria-label="Fechar ampliacao" className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-lg bg-black/75 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold" onClick={() => setZoomedPhoto(null)} type="button"><X className="h-5 w-5" /></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
