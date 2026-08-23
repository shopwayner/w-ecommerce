"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  blingProductSyncCategories,
  blingProductSyncCategoryLabels,
  type BlingProductSyncChangeCategory,
  type BlingProductSyncChangeValue,
  type BlingProductSyncReportFilter
} from "@/lib/bling-product-sync-report";

type SyncReportEntry = {
  productId: string;
  sku: string;
  localSku: string | null;
  externalCode: string | null;
  identityConflict: boolean;
  category: BlingProductSyncChangeCategory;
  field: string;
  previousValue: BlingProductSyncChangeValue;
  newValue: BlingProductSyncChangeValue;
  delta?: number;
};

type SyncReportPreview = {
  changedProducts: number;
  totalChanges: number;
  failureCount: number;
  categoryCounts: Record<BlingProductSyncChangeCategory, number>;
  groups: Array<{
    category: BlingProductSyncChangeCategory;
    total: number;
    items: SyncReportEntry[];
  }>;
};

type NotificationView = {
  id: string;
  type: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  source: "system";
  action?: {
    label: "Ver alterações";
    jobId: string;
    preview: SyncReportPreview;
  };
};

type SyncReportPage = {
  jobId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filter: BlingProductSyncReportFilter;
  entries: SyncReportEntry[];
  failures: Array<{ productId: string | null; sku: string; message: string }>;
  summary: Omit<SyncReportPreview, "groups">;
};

function syncIdentityLabel(item: Pick<SyncReportEntry, "sku" | "localSku" | "externalCode">) {
  if (item.localSku) return `SKU local: ${item.localSku}`;
  if (item.externalCode) return `Codigo Bling: ${item.externalCode}`;
  return `SKU: ${item.sku}`;
}

function syncExternalIdentityLabel(item: Pick<SyncReportEntry, "localSku" | "externalCode" | "identityConflict">) {
  if (item.identityConflict) return "Codigos Bling conflitantes";
  if (item.localSku && item.externalCode && item.localSku !== item.externalCode) {
    return `Codigo Bling: ${item.externalCode}`;
  }
  return null;
}

function formatSyncChange(change: SyncReportEntry) {
  if (change.category === "IMAGES" && change.delta) {
    return `+${change.delta} ${change.delta === 1 ? "imagem" : "imagens"}`;
  }
  if (change.category === "DESCRIPTION") return "Atualizada";
  if (["ATTRIBUTES", "OTHER"].includes(change.category)) return change.field;
  return `${String(change.previousValue ?? "-")} -> ${String(change.newValue ?? "-")}`;
}

export function NotificationCenter({
  onClose,
  onUnreadCountChange,
  open,
  unreadCount
}: {
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
  open: boolean;
  unreadCount: number;
}) {
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [selectedSyncJobId, setSelectedSyncJobId] = useState<string | null>(null);
  const [syncReportCategory, setSyncReportCategory] = useState<BlingProductSyncReportFilter>("ALL");
  const [syncReportPage, setSyncReportPage] = useState(1);
  const [syncReportData, setSyncReportData] = useState<SyncReportPage | null>(null);
  const [syncReportLoading, setSyncReportLoading] = useState(false);
  const [syncReportError, setSyncReportError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setNotificationsLoading(true);
    setNotificationsError(null);
    fetch("/api/notifications", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("notifications_unavailable");
        return response.json() as Promise<{
          notifications?: NotificationView[];
          unreadCount?: number;
        }>;
      })
      .then((payload) => {
        setNotifications(payload.notifications ?? []);
        onUnreadCountChange(payload.unreadCount ?? 0);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setNotifications([]);
        onUnreadCountChange(0);
        setNotificationsError("Nao foi possivel carregar as notificacoes.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setNotificationsLoading(false);
      });
    return () => controller.abort();
  }, [onUnreadCountChange, open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-notification-trigger="true"]')) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!selectedSyncJobId) return;
    const controller = new AbortController();
    setSyncReportLoading(true);
    setSyncReportError(null);
    const query = new URLSearchParams({
      page: String(syncReportPage),
      pageSize: "20",
      category: syncReportCategory
    });
    fetch(
      `/api/notifications/bling-sync/${encodeURIComponent(selectedSyncJobId)}/report?${query}`,
      { cache: "no-store", signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("report_unavailable");
        return response.json() as Promise<SyncReportPage>;
      })
      .then(setSyncReportData)
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setSyncReportError("Nao foi possivel carregar o relatorio.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSyncReportLoading(false);
      });
    return () => controller.abort();
  }, [selectedSyncJobId, syncReportCategory, syncReportPage]);

  async function markAllNotificationsRead() {
    if (notifications.length === 0) return;
    setNotificationsError(null);
    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    onUnreadCountChange(0);
    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!response.ok) throw new Error("mark_all_failed");
    } catch {
      setNotifications(previousNotifications);
      onUnreadCountChange(previousUnreadCount);
      setNotificationsError("Nao foi possivel marcar as notificacoes como lidas.");
    }
  }

  return (
    <>
      {open ? (
        <div ref={panelRef} className="absolute right-0 top-12 z-50 w-[calc(100vw-1.5rem)] max-w-sm rounded-lg border border-matrix-border bg-matrix-panel p-4 text-sm shadow-glow sm:w-96">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-bold text-matrix-fg">Notificacoes</p>
              <p className="mt-1 text-xs text-matrix-muted">Eventos internos do sistema e avisos futuros de marketplace.</p>
            </div>
            {notifications.length > 0 ? (
              <button className="shrink-0 text-xs font-semibold text-matrix-goldDark hover:text-matrix-gold" onClick={markAllNotificationsRead} type="button">
                Marcar todas como lidas
              </button>
            ) : null}
          </div>
          <div className="matrix-scroll mt-4 max-h-[min(65vh,24rem)] space-y-2 overflow-y-auto pr-1">
            {notificationsLoading ? <p className="rounded-md border border-matrix-border bg-matrix-panel2/70 p-3 text-sm text-matrix-muted">Carregando notificacoes...</p> : null}
            {!notificationsLoading && notificationsError ? <p className="rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">{notificationsError}</p> : null}
            {!notificationsLoading && !notificationsError && notifications.length === 0 ? <p className="rounded-md border border-matrix-border bg-matrix-panel2/70 p-3 text-sm text-matrix-muted">Nenhuma notificacao no momento.</p> : null}
            {!notificationsLoading && !notificationsError
              ? notifications.map((notification) => (
                  <div className={`rounded-md border p-3 ${notification.read ? "border-matrix-border bg-matrix-panel2/55" : "border-matrix-gold/45 bg-matrix-goldSoft/25"}`} key={notification.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${notification.type === "ERROR" ? "border-red-500/40 text-red-200" : notification.type === "WARNING" ? "border-amber-500/40 text-amber-200" : notification.type === "SUCCESS" ? "border-emerald-500/40 text-emerald-200" : "border-matrix-gold/40 text-matrix-gold"}`}>
                        {notification.type}
                      </span>
                      <span className="text-[11px] text-matrix-muted">{new Date(notification.createdAt).toLocaleString("pt-BR")}</span>
                    </div>
                    <p className="mt-2 font-semibold text-matrix-fg">{notification.title}</p>
                    <p className="mt-1 text-xs leading-5 text-matrix-muted">{notification.message}</p>
                    {notification.action ? (
                      <>
                        <div className="mt-2 space-y-2">
                          {notification.action.preview.groups.map((group) => (
                            <div key={group.category}>
                              <p className="text-[11px] font-semibold text-matrix-fg">{blingProductSyncCategoryLabels[group.category]} - {group.total}</p>
                              {group.items.slice(0, 3).map((item, index) => (
                                <p className="mt-0.5 text-[11px] text-matrix-muted" key={`${item.productId}-${item.field}-${index}`}>
                                  {syncIdentityLabel(item)}{syncExternalIdentityLabel(item) ? ` (${syncExternalIdentityLabel(item)})` : ""}: {formatSyncChange(item)}
                                </p>
                              ))}
                              {group.total > group.items.length ? <p className="mt-1 text-[10px] text-matrix-muted">Mostrando {group.items.length} de {group.total} alteracoes.</p> : null}
                            </div>
                          ))}
                        </div>
                        <button className="mt-3 text-xs font-semibold text-matrix-gold hover:text-matrix-goldDark" onClick={() => {
                          setSelectedSyncJobId(notification.action?.jobId ?? null);
                          setSyncReportCategory("ALL");
                          setSyncReportPage(1);
                          setSyncReportData(null);
                          onClose();
                        }} type="button">Ver alterações</button>
                      </>
                    ) : null}
                  </div>
                ))
              : null}
          </div>
        </div>
      ) : null}
      {selectedSyncJobId ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 px-3 py-5 backdrop-blur-sm" onClick={() => setSelectedSyncJobId(null)}>
          <section aria-label="Relatorio da sincronizacao Bling" aria-modal="true" className="matrix-scroll max-h-[90vh] w-full max-w-3xl min-w-0 overflow-y-auto rounded-lg border border-matrix-gold/35 bg-matrix-panel p-4 sm:p-5" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-matrix-fg">Alteracoes da sincronizacao</h2>
                <p className="mt-1 text-xs text-matrix-muted">Somente produtos que tiveram dados atualizados.</p>
              </div>
              <button aria-label="Fechar relatorio" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:text-matrix-gold" onClick={() => setSelectedSyncJobId(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-matrix-muted" htmlFor="sync-report-category">Categoria</label>
              <select className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-xs text-matrix-fg" id="sync-report-category" onChange={(event) => {
                setSyncReportCategory(event.target.value as BlingProductSyncReportFilter);
                setSyncReportPage(1);
              }} value={syncReportCategory}>
                <option value="ALL">Todas as alteracoes</option>
                {blingProductSyncCategories.map((category) => <option key={category} value={category}>{blingProductSyncCategoryLabels[category]}</option>)}
                <option value="FAILURES">Falhas</option>
              </select>
            </div>
            <div className="mt-5 space-y-3">
              {syncReportLoading ? <p className="rounded-md border border-matrix-border bg-matrix-panel2 p-3 text-sm text-matrix-muted">Carregando relatorio...</p> : null}
              {!syncReportLoading && syncReportError ? <p className="rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">{syncReportError}</p> : null}
              {!syncReportLoading && !syncReportError && syncReportData ? (
                <>
                  <p className="text-xs text-matrix-muted">{syncReportData.summary.changedProducts} produtos alterados; {syncReportData.summary.totalChanges} alteracoes; {syncReportData.summary.failureCount} falhas.</p>
                  <div className="divide-y divide-matrix-border rounded-md border border-matrix-border bg-matrix-panel2/60">
                    {syncReportData.entries.map((item, index) => (
                      <div className="grid min-w-0 gap-1 px-3 py-2 text-xs sm:grid-cols-[11rem_11rem_minmax(0,1fr)]" key={`${item.productId}-${item.field}-${index}`}>
                        <div className="min-w-0">
                          <strong className="block break-words text-matrix-fg">{syncIdentityLabel(item)}</strong>
                          {syncExternalIdentityLabel(item) ? <span className="block break-words text-[10px] text-matrix-muted">{syncExternalIdentityLabel(item)}</span> : null}
                        </div>
                        <span className="break-words text-matrix-gold">{blingProductSyncCategoryLabels[item.category]}</span>
                        <span className="min-w-0 break-words text-matrix-muted">{formatSyncChange(item)}</span>
                      </div>
                    ))}
                    {syncReportData.failures.map((item, index) => (
                      <div className="grid min-w-0 gap-1 px-3 py-2 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]" key={`${item.productId ?? item.sku}-${index}`}>
                        <strong className="break-words text-matrix-fg">SKU {item.sku}</strong>
                        <span className="min-w-0 break-words text-red-200">{item.message}</span>
                      </div>
                    ))}
                    {syncReportData.total === 0 ? <p className="p-3 text-sm text-matrix-muted">Nenhum item nesta categoria.</p> : null}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button className="rounded-md border border-matrix-border px-3 py-2 text-xs font-semibold text-matrix-fg disabled:opacity-40" disabled={syncReportData.page <= 1} onClick={() => setSyncReportPage((current) => Math.max(1, current - 1))} type="button">Anterior</button>
                    <span className="text-xs text-matrix-muted">Pagina {syncReportData.page} de {syncReportData.totalPages} - {syncReportData.total} itens</span>
                    <button className="rounded-md border border-matrix-border px-3 py-2 text-xs font-semibold text-matrix-fg disabled:opacity-40" disabled={syncReportData.page >= syncReportData.totalPages} onClick={() => setSyncReportPage((current) => current + 1)} type="button">Proxima</button>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
