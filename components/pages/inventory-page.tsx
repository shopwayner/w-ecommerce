"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Boxes, Eye, FileUp, RefreshCw, Search, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, DataTable, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { isOptimizableProductImageUrl } from "@/lib/product-image-optimization";

type InventoryStatus = "OK" | "LOW_STOCK" | "RUPTURE";

type InventoryItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  ean: string | null;
  imageUrl: string | null;
  bling: {
    connectionId: string;
    name: string;
    status: string;
    externalProductId: string | null;
  };
  deposit: string | null;
  physicalQuantity: number;
  reservedQuantity: number;
  safetyStock: number;
  availableQuantity: number;
  minQuantity: number | null;
  maxQuantity: number | null;
  status: InventoryStatus;
  rawStatus: string;
  updatedAt: string;
};

type InventorySummary = {
  totalPhysical: number;
  totalReserved: number;
  lowStockCount: number;
  ruptureCount: number;
  movementCount: number;
  totalItems: number;
};

type InventoryResponse = {
  data?: InventoryItem[];
  criticalItems?: InventoryItem[];
  summary?: InventorySummary;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

const pageSizeOptions = [50, 100, 200];

const statusLabel: Record<InventoryStatus, string> = {
  OK: "OK",
  LOW_STOCK: "Baixo estoque",
  RUPTURE: "Ruptura"
};

const statusTone: Record<InventoryStatus, "success" | "warning" | "danger"> = {
  OK: "success",
  LOW_STOCK: "warning",
  RUPTURE: "danger"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatNullableNumber(value: number | null) {
  return value === null ? "-" : formatNumber(value);
}

function placeholderNotice(action: string) {
  return `${action} esta em preparacao. Nenhuma API externa foi chamada e nenhum saldo foi alterado.`;
}

export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [criticalItems, setCriticalItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalResults, setTotalResults] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const requestIdRef = useRef(0);

  const loadInventory = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(pageSize)
      });
      if (debouncedSearchQuery) params.set("q", debouncedSearchQuery);
      const response = await fetch(`/api/inventory?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as InventoryResponse & { error?: string };
      if (requestId !== requestIdRef.current) return;

      if (!response.ok) {
        setItems([]);
        setCriticalItems([]);
        setSummary(null);
        setTotalResults(0);
        setTotalPages(1);
        setError(payload.error ?? "Nao foi possivel carregar o estoque.");
        return;
      }

      setItems(payload.data ?? []);
      setCriticalItems(payload.criticalItems ?? []);
      setSummary(payload.summary ?? null);
      setTotalResults(payload.pagination?.total ?? 0);
      setTotalPages(payload.pagination?.totalPages ?? 1);
      if (payload.pagination && payload.pagination.page !== currentPage) {
        setCurrentPage(payload.pagination.page);
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setItems([]);
      setCriticalItems([]);
      setSummary(null);
      setTotalResults(0);
      setTotalPages(1);
      setError("Nao foi possivel carregar o estoque.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [currentPage, debouncedSearchQuery, pageSize]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    function reloadForAccountContext() {
      void loadInventory();
    }

    window.addEventListener("w-account-context-updated", reloadForAccountContext);
    window.addEventListener("w-erps-active-account-updated", reloadForAccountContext);
    return () => {
      window.removeEventListener("w-account-context-updated", reloadForAccountContext);
      window.removeEventListener("w-erps-active-account-updated", reloadForAccountContext);
    };
  }, [loadInventory]);

  const computedSummary: InventorySummary = summary ?? {
    totalPhysical: 0,
    totalReserved: 0,
    lowStockCount: 0,
    ruptureCount: 0,
    movementCount: 0,
    totalItems: 0
  };

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const pageStart = totalResults ? (currentPage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(currentPage * pageSize, totalResults);

  return (
    <AppShell>
      <PageHeader
        title="Estoque"
        description="Saldos fisicos, reservados, seguranca e disponibilidade calculada sem estoque negativo."
        actions={
          <>
            <Button onClick={() => setNotice(placeholderNotice("Ajuste manual"))} type="button">
              <Boxes className="h-4 w-4" /> Ajuste manual
            </Button>
            <Button onClick={() => setNotice(placeholderNotice("Importar saldo"))} type="button" variant="secondary">
              <FileUp className="h-4 w-4" /> Importar saldo
            </Button>
            <Button onClick={() => setNotice(placeholderNotice("Sincronizar"))} type="button" variant="secondary">
              <RefreshCw className="h-4 w-4" /> Sincronizar
            </Button>
            <Button onClick={() => setNotice(placeholderNotice("Enviar filial"))} type="button" variant="secondary">
              <Send className="h-4 w-4" /> Enviar filial
            </Button>
          </>
        }
      />

      {notice ? (
        <div className="mb-4 rounded-md border border-matrix-gold/30 bg-matrix-goldSoft/25 px-3 py-2 text-sm font-semibold text-matrix-goldDark">
          {notice}
        </div>
      ) : null}
      {error ? <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-7">
        <KpiCard
          label="Estoque total"
          value={loading ? "..." : formatNumber(computedSummary.totalPhysical)}
          hint={`${formatNumber(computedSummary.totalItems)} saldo(s) carregado(s)`}
        />
        <KpiCard
          label="Baixo estoque"
          value={loading ? "..." : formatNumber(computedSummary.lowStockCount)}
          hint="Disponivel menor ou igual ao minimo"
          tone="warning"
        />
        <KpiCard
          label="Ruptura"
          value={loading ? "..." : formatNumber(computedSummary.ruptureCount)}
          hint="Disponivel menor ou igual a zero"
          tone="danger"
        />
        <KpiCard
          label="Movimentacoes"
          value={loading ? "..." : formatNumber(computedSummary.movementCount)}
          hint="Movimentacoes ainda nao habilitadas"
          tone="purple"
        />
        <KpiCard
          label="Reservado"
          value={loading ? "..." : formatNumber(computedSummary.totalReserved)}
          hint="Soma reservada em saldos locais"
          tone="info"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-matrix-muted" />
              <input
                aria-label="Buscar estoque por produto, SKU, EAN ou Bling"
                className="h-10 w-full rounded-md border border-matrix-border bg-white/[0.03] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-600 focus:border-matrix-gold/55"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Buscar por produto, SKU, EAN ou Bling"
                value={searchQuery}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex h-10 items-center rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 font-semibold text-matrix-fg">
                Pagina {currentPage} de {totalPages}
              </span>
              <select
                aria-label="Saldos por pagina"
                className="h-10 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 font-semibold text-matrix-fg outline-none"
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setCurrentPage(1);
                }}
                value={pageSize}
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} saldos por pagina
                  </option>
                ))}
              </select>
              <Button disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} type="button" variant="secondary">
                Anterior
              </Button>
              <Button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} type="button" variant="secondary">
                Proxima
              </Button>
            </div>
          </div>

          <DataTable
            columns={["Produto", "SKU", "Bling", "Deposito", "Fisico", "Reservado", "Seguranca", "Disponivel", "Minimo", "Maximo", "Status", "Acoes"]}
            emptyMessage={loading ? "Carregando saldos reais..." : "Nenhum saldo encontrado para o contexto atual."}
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-matrix-border px-3 py-2 text-xs text-matrix-muted">
                <span>
                  Mostrando {pageStart}-{pageEnd} de {formatNumber(totalResults)} saldo(s)
                </span>
                <span>{formatNumber(computedSummary.totalItems)} saldo(s) no contexto atual</span>
              </div>
            }
            rows={items.map((item) => [
              <div key={`${item.id}-product`} className="flex min-w-[280px] items-center gap-3 whitespace-normal">
                {item.imageUrl ? (
                  <Image
                    alt=""
                    className="h-10 w-10 rounded-md border border-matrix-border object-cover"
                    decoding="async"
                    height={40}
                    loading="lazy"
                    sizes="40px"
                    src={item.imageUrl}
                    unoptimized={!isOptimizableProductImageUrl(item.imageUrl)}
                    width={40}
                  />
                ) : (
                  <div className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-xs text-matrix-muted">
                    sem img
                  </div>
                )}
                <div className="min-w-0">
                  <p className="max-w-[360px] truncate font-semibold text-matrix-fg">{item.productName}</p>
                  <p className="mt-1 text-xs text-matrix-muted">EAN: {item.ean ?? "-"}</p>
                </div>
              </div>,
              item.sku ?? "-",
              <div key={`${item.id}-bling`} className="min-w-[180px] whitespace-normal">
                <p className="font-semibold text-matrix-fg">{item.bling.name}</p>
                <p className="mt-1 text-xs text-matrix-muted">ID: {item.bling.externalProductId ?? "-"}</p>
              </div>,
              item.deposit ?? "-",
              formatNumber(item.physicalQuantity),
              formatNumber(item.reservedQuantity),
              formatNumber(item.safetyStock),
              <span key={`${item.id}-available`} className={item.availableQuantity <= 0 ? "font-semibold text-red-300" : "font-semibold text-matrix-fg"}>
                {formatNumber(item.availableQuantity)}
              </span>,
              formatNullableNumber(item.minQuantity),
              formatNullableNumber(item.maxQuantity),
              <Badge key={`${item.id}-status`} tone={statusTone[item.status]}>
                {statusLabel[item.status]}
              </Badge>,
              <Button key={`${item.id}-action`} className="min-h-8 px-2 py-1 text-xs" onClick={() => setNotice(`Visualizacao do saldo ${item.sku ?? item.productName} em preparacao.`)} type="button" variant="secondary">
                <Eye className="h-3.5 w-3.5" /> Ver
              </Button>
            ])}
          />
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Reposicao sugerida</h3>
          <p className="mt-1 text-sm text-matrix-muted">Itens em ruptura ou abaixo do minimo configurado.</p>
          <div className="mt-4">
            {criticalItems.length ? (
              <div className="space-y-2">
                {criticalItems.map((item) => (
                  <div key={item.id} className="rounded-md border border-matrix-border bg-matrix-panel2/65 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-matrix-fg">{item.productName}</p>
                        <p className="mt-1 text-xs text-matrix-muted">SKU: {item.sku ?? "-"} | Deposito: {item.deposit ?? "-"}</p>
                      </div>
                      <Badge tone={statusTone[item.status]}>{statusLabel[item.status]}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-matrix-muted">
                      <span>Fisico: {formatNumber(item.physicalQuantity)}</span>
                      <span>Disp.: {formatNumber(item.availableQuantity)}</span>
                      <span>Min.: {formatNullableNumber(item.minQuantity)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sem reposicao sugerida." description="Alertas reais surgem quando houver ruptura ou estoque abaixo do minimo." />
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
