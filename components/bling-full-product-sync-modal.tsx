"use client";

import { AlertTriangle, CheckCircle2, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import type {
  BlingFullProductModuleResult,
  BlingFullProductSyncPreview,
  BlingFullProductSyncResult
} from "@/lib/services/bling-full-product-sync-service";

function formatCurrency(value: number | null) {
  return value === null
    ? "Nao informado"
    : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatStock(value: number | null) {
  return value === null ? "Nao informado" : value.toLocaleString("pt-BR");
}

function moduleLabel(module: BlingFullProductModuleResult["module"]) {
  if (module === "PRODUCT_FIELDS") return "Atualizando dados";
  if (module === "PRICE_COST") return "Atualizando preco e custo";
  if (module === "STOCK") return "Atualizando estoque";
  if (module === "IMAGES") return "Atualizando fotos";
  return "Verificando resultado";
}

function ModuleStatus({ item }: { item: BlingFullProductModuleResult }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm">
      <span>{moduleLabel(item.module)}</span>
      <span className={
        item.status === "COMPLETED"
          ? "text-green-600"
          : item.status === "FAILED" || item.status === "VERIFICATION_FAILED"
            ? "text-red-600"
            : "text-matrix-muted"
      }>
        {item.status === "COMPLETED"
          ? "Concluido"
          : item.status === "FAILED"
            ? "Falhou"
            : item.status === "VERIFICATION_FAILED"
              ? "Verificacao falhou"
              : item.status === "NOT_REQUESTED"
              ? "Nao necessario"
              : "Pendente"}
      </span>
    </li>
  );
}

export function BlingFullProductSyncModal({
  preview,
  result,
  loading,
  message,
  onCancel,
  onConfirm
}: {
  preview: BlingFullProductSyncPreview | null;
  result: BlingFullProductSyncResult | null;
  loading: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const modules = result?.modules ?? preview?.modules ?? [];
  const canConfirm = Boolean(
    preview
    && preview.capabilityEnabled
    && !preview.blockers.length
    && !loading
    && !result
  );

  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-black/75 p-3 backdrop-blur-sm">
      <section
        aria-labelledby="bling-full-sync-title"
        aria-modal="true"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-xl border border-matrix-gold/35 bg-matrix-panel shadow-glow"
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-matrix-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 shrink-0 text-matrix-goldDark" />
              <h2 className="text-lg font-bold" id="bling-full-sync-title">Atualizar produto no Bling</h2>
            </div>
            <p className="mt-1 text-sm text-matrix-muted">
              O cadastro salvo no W Ecommerce sera usado como fonte de verdade.
            </p>
          </div>
        </header>

        <main className="matrix-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-matrix-gold/30 bg-matrix-gold/10 px-3 py-3 text-sm font-semibold">
              <Loader2 className="h-4 w-4 animate-spin" />
              Atualizando produto no Bling...
            </div>
          ) : null}
          {message ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}
          {result ? (
            <div className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-3 text-sm ${
              result.status === "UPDATED" || result.status === "UNCHANGED"
                ? "border-green-500/25 bg-green-500/10 text-green-700"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700"
            }`}>
              {result.status === "UPDATED" || result.status === "UNCHANGED"
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{result.message}</span>
            </div>
          ) : null}

          {preview ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <dt className="text-xs font-semibold uppercase text-matrix-muted">Titulo local</dt>
                  <dd className="mt-1 break-words text-sm font-semibold">{preview.title}</dd>
                </div>
                <div className="rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <dt className="text-xs font-semibold uppercase text-matrix-muted">Dados preenchidos</dt>
                  <dd className="mt-1 text-xl font-bold text-matrix-goldDark">{preview.populatedFieldCount}</dd>
                </div>
                <div className="rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase text-matrix-muted">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Fotos
                  </dt>
                  <dd className="mt-1 text-xl font-bold text-matrix-goldDark">{preview.imageCount}</dd>
                </div>
                <div className="rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <dt className="text-xs font-semibold uppercase text-matrix-muted">Fotos atuais no Bling</dt>
                  <dd className="mt-1 text-xl font-bold text-matrix-goldDark">{preview.remoteImageCount}</dd>
                </div>
                <div className="rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <dt className="text-xs font-semibold uppercase text-matrix-muted">Fotos removidas no espelhamento</dt>
                  <dd className="mt-1 text-xl font-bold text-matrix-goldDark">{preview.remoteImagesToRemoveCount}</dd>
                </div>
                <div className="rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <dt className="text-xs font-semibold uppercase text-matrix-muted">Estoque</dt>
                  <dd className="mt-1 text-sm font-semibold">{formatStock(preview.stock)}</dd>
                </div>
                <div className="rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <dt className="text-xs font-semibold uppercase text-matrix-muted">Preco de venda</dt>
                  <dd className="mt-1 text-sm font-semibold">{formatCurrency(preview.price)}</dd>
                </div>
              </dl>

              {preview.blockers.length ? (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm font-semibold text-amber-700">A operacao foi bloqueada antes de qualquer escrita.</p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-700">
                    {preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                </div>
              ) : null}
              {preview.notices.length ? (
                <div className="mt-4 rounded-lg border border-matrix-border bg-matrix-panel2/65 p-3">
                  <p className="text-sm font-semibold">Campos omitidos com seguranca</p>
                  <ul className="mt-2 space-y-1 text-sm text-matrix-muted">
                    {preview.notices.map((notice) => <li key={notice}>{notice}</li>)}
                  </ul>
                </div>
              ) : null}
              {!preview.capabilityEnabled ? (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
                  A atualizacao completa de produtos no Bling esta temporariamente desativada.
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-lg border border-matrix-border bg-matrix-panel2/65 p-4 text-sm text-matrix-muted">
              Preparando o resumo seguro do produto...
            </div>
          )}

          {modules.length ? (
            <ul className="mt-4 space-y-2">
              {modules.map((item) => <ModuleStatus item={item} key={item.module} />)}
            </ul>
          ) : null}
        </main>

        <footer className="grid shrink-0 grid-cols-1 gap-2 border-t border-matrix-border bg-matrix-panel px-4 py-3 sm:grid-cols-2 sm:px-5">
          <Button disabled={loading} onClick={onCancel} type="button" variant="secondary">
            Cancelar
          </Button>
          <Button disabled={!canConfirm} onClick={onConfirm} type="button">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {loading ? "Atualizando produto no Bling..." : "Atualizar produto no Bling"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
