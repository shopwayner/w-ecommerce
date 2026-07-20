"use client";

import { Bell, LogOut, Menu, Moon, Plus, Sun, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { memo, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type SessionView = {
  user: { name: string | null; email: string; role: string };
  organization: { name: string };
};

type AccountContextOption = {
  mode: "MATRIX" | "ERP_ACCOUNT";
  provider: "BLING" | null;
  connectionId: string | null;
  label: string;
  description?: string;
  status?: string;
  isDefault?: boolean;
};

type AccountContextView = {
  mode: "MATRIX" | "ERP_ACCOUNT";
  label: string;
  provider: "BLING" | null;
  connectionId: string | null;
  options: AccountContextOption[];
};

type NotificationView = {
  id: string;
  type: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  source: "system";
};

const marketplaceOptions = [
  { label: "Mercado Livre", value: "mercado-livre", href: "/marketplaces/mercado-livre" },
  { label: "Amazon", value: "amazon", href: "/marketplaces" },
  { label: "Shopee", value: "shopee", href: "/marketplaces" },
  { label: "TikTok Shop", value: "tiktok-shop", href: "/marketplaces" },
  { label: "Magalu", value: "magalu", href: "/marketplaces" },
  { label: "Madeira Madeira", value: "madeira-madeira", href: "/marketplaces" }
];

let cachedSession: SessionView | null = null;

function contextKey(option: Pick<AccountContextOption, "mode" | "provider" | "connectionId">) {
  return option.mode === "ERP_ACCOUNT" ? `${option.provider}:${option.connectionId}` : "MATRIX";
}

type TopbarProps = {
  onMenuClick: () => void;
  sidebarCollapsed: boolean;
  denseDesktopShell?: boolean;
};

function TopbarComponent({ onMenuClick, sidebarCollapsed, denseDesktopShell = false }: TopbarProps) {
  const [session, setSession] = useState<SessionView | null>(cachedSession);
  const [accountContext, setAccountContext] = useState<AccountContextView | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [changingContextKey, setChangingContextKey] = useState<string | null>(null);
  const [selectedMarketplace, setSelectedMarketplace] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const currentLabel = accountContext?.label ?? "nenhuma";
  const currentKey = accountContext ? contextKey(accountContext) : "MATRIX";

  useEffect(() => {
    if (cachedSession) return;
    let mounted = true;

    fetch("/api/auth/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!mounted) return;
        cachedSession = data;
        setSession(data);
      })
      .catch(() => {
        if (mounted) setSession(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadAccountContext = () => {
      fetch("/api/account-context")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!mounted) return;
          setAccountContext(data);
        })
        .catch(() => {
          if (mounted) setAccountContext(null);
        });
    };

    loadAccountContext();
    window.addEventListener("w-account-context-updated", loadAccountContext);
    window.addEventListener("w-erps-active-account-updated", loadAccountContext);
    return () => {
      mounted = false;
      window.removeEventListener("w-account-context-updated", loadAccountContext);
      window.removeEventListener("w-erps-active-account-updated", loadAccountContext);
    };
  }, []);

  useEffect(() => {
    setAccountMenuOpen(false);
    setNotificationsOpen(false);
    setSelectedMarketplace(pathname === "/marketplaces/mercado-livre" ? "mercado-livre" : "");
  }, [pathname]);

  useEffect(() => {
    if (!notificationsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && notificationsRef.current?.contains(target)) return;
      setNotificationsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setNotificationsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen]);

  function selectMarketplace(value: string) {
    setSelectedMarketplace(value);
    const option = marketplaceOptions.find((item) => item.value === value);
    router.push(option?.href ?? "/marketplaces");
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error("notifications_unavailable");
      const payload = (await response.json()) as { notifications?: NotificationView[]; unreadCount?: number };
      setNotifications(payload.notifications ?? []);
      setUnreadCount(payload.unreadCount ?? 0);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
      setNotificationsError("Nao foi possivel carregar as notificacoes.");
    } finally {
      setNotificationsLoading(false);
    }
  }

  function toggleNotifications() {
    setNotificationsOpen((current) => {
      const next = !current;
      if (next) {
        setAccountMenuOpen(false);
        void loadNotifications();
      }
      return next;
    });
  }

  async function markAllNotificationsRead() {
    if (notifications.length === 0) return;
    setNotificationsError(null);
    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    setUnreadCount(0);

    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!response.ok) throw new Error("mark_all_failed");
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnreadCount);
      setNotificationsError("Nao foi possivel marcar as notificacoes como lidas.");
    }
  }

  async function selectAccountContext(option: AccountContextOption) {
    const key = contextKey(option);
    setChangingContextKey(key);
    const response = await fetch("/api/account-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: option.mode,
        provider: option.provider,
        connectionId: option.connectionId
      })
    });
    setChangingContextKey(null);
    if (!response.ok) return;
    setAccountContext((await response.json()) as AccountContextView);
    setAccountMenuOpen(false);
    window.dispatchEvent(new Event("w-account-context-updated"));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    cachedSession = null;
    window.location.assign("/login");
  }

  return (
    <header
      className={cn(
        "fixed left-0 right-0 top-0 z-30 border-b border-matrix-border bg-matrix-panel/88 shadow-glow backdrop-blur transition-[left] duration-200",
        sidebarCollapsed ? "lg:left-20" : "lg:left-72"
      )}
    >
      <div className={cn("flex h-16 items-center gap-2 px-3 py-2 sm:px-4 lg:px-5", denseDesktopShell && "lg:!h-[3.75rem] lg:!gap-[7px] lg:!px-1")}>
        <button onClick={onMenuClick} className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted lg:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <label
          className={cn(
            "flex min-w-0 flex-1 items-center rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 gold-ring sm:min-w-[11rem] sm:max-w-sm lg:max-w-md",
            denseDesktopShell && "lg:!w-[17.625rem] lg:!max-w-[17.625rem] lg:!flex-none"
          )}
        >
          <span className="sr-only">Marketplace</span>
          <select
            className="min-w-0 w-full bg-transparent text-sm font-semibold text-matrix-fg outline-none"
            onChange={(event) => selectMarketplace(event.target.value)}
            value={selectedMarketplace}
          >
            <option className="bg-matrix-panel text-matrix-fg" value="">
              Marketplace
            </option>
            {marketplaceOptions.map((marketplace) => (
              <option className="bg-matrix-panel text-matrix-fg" key={marketplace.value} value={marketplace.value}>
                {marketplace.label}
              </option>
            ))}
          </select>
        </label>
        <div className="relative hidden sm:block">
          <button
            className={cn(
              "flex max-w-[260px] items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm font-semibold text-matrix-fg hover:border-matrix-gold/50",
              denseDesktopShell && "lg:!w-[159px] lg:!gap-1.5 lg:!px-1.5 lg:!text-xs"
            )}
            onClick={() => setAccountMenuOpen((current) => !current)}
            type="button"
          >
            <UserRound className="h-4 w-4 shrink-0 text-matrix-gold" />
            <span>Conta</span>
            <span className={cn("min-w-0 max-w-40 truncate text-xs font-medium text-matrix-muted", denseDesktopShell && "lg:!text-[10px]")}>{currentLabel}</span>
          </button>
          {accountMenuOpen ? (
            <div className="absolute right-0 top-12 z-50 w-80 rounded-lg border border-matrix-border bg-matrix-panel p-4 text-sm shadow-glow">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Contexto de dados</p>
              <p className="mt-2 break-words text-base font-bold text-matrix-fg">Conta: {currentLabel}</p>
              <p className="mt-2 text-xs leading-5 text-matrix-muted">
                Esta escolha vale apenas para o seu usuario. Nenhum dado e consultado no Bling ao trocar o contexto.
              </p>
              <div className="mt-4 grid gap-2">
                {(accountContext?.options ?? [{ mode: "MATRIX", provider: null, connectionId: null, label: "Matrix" }]).map((option) => {
                  const key = contextKey(option);
                  const selected = key === currentKey;
                  return (
                    <button
                      key={key}
                      className={`rounded-md border px-3 py-2 text-left hover:border-matrix-gold/50 ${
                        selected ? "border-matrix-gold/50 bg-matrix-goldSoft/35" : "border-matrix-border bg-matrix-panel2/70"
                      }`}
                      disabled={changingContextKey === key}
                      onClick={() => selectAccountContext(option)}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-matrix-fg">{option.label}</span>
                        {selected ? <span className="text-xs font-semibold text-matrix-goldDark">Selecionada</span> : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-matrix-muted">
                        {option.mode === "MATRIX" ? "Matrix - visao consolidada de todas as integracoes." : "Mostra somente produtos desta conta ERP."}
                      </span>
                    </button>
                  );
                })}
                <button
                  className="rounded-md border border-matrix-border px-3 py-2 text-left font-semibold text-matrix-fg hover:border-matrix-gold/50"
                  onClick={() => window.location.assign("/erps")}
                  type="button"
                >
                  Gerenciar contas em ERPs
                </button>
                <button
                  className="rounded-md bg-matrix-gold px-3 py-2 text-left font-semibold text-black hover:bg-matrix-goldDark hover:text-white"
                  onClick={() => window.location.assign("/erps")}
                  type="button"
                >
                  Conectar nova conta Bling
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <button
          className={cn(
            "hidden items-center gap-2 rounded-md bg-matrix-gold px-3 py-2 text-sm font-semibold text-black shadow-gold hover:bg-matrix-goldDark hover:text-white sm:flex",
            denseDesktopShell && "lg:!w-24 lg:!justify-center lg:!px-2 lg:!text-xs lg:!whitespace-nowrap"
          )}
        >
          <Plus className="h-4 w-4" />
          Acao rapida
        </button>
        <button onClick={toggleTheme} className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted hover:text-matrix-gold" title="Alternar tema">
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
        <div className="relative" ref={notificationsRef}>
          <button
            aria-expanded={notificationsOpen}
            aria-label="Abrir notificacoes"
            className="relative grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted hover:text-matrix-gold"
            onClick={toggleNotifications}
            title="Notificacoes"
            type="button"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-matrix-gold px-1 text-[10px] font-bold text-black">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </button>
          {notificationsOpen ? (
            <div className="absolute right-0 top-12 z-50 w-[calc(100vw-1.5rem)] max-w-sm rounded-lg border border-matrix-border bg-matrix-panel p-4 text-sm shadow-glow sm:w-96">
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
                {!notificationsLoading && notificationsError ? (
                  <p className="rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">{notificationsError}</p>
                ) : null}
                {!notificationsLoading && !notificationsError && notifications.length === 0 ? (
                  <p className="rounded-md border border-matrix-border bg-matrix-panel2/70 p-3 text-sm text-matrix-muted">Nenhuma notificacao no momento.</p>
                ) : null}
                {!notificationsLoading && !notificationsError
                  ? notifications.map((notification) => (
                      <div
                        className={`rounded-md border p-3 ${
                          notification.read ? "border-matrix-border bg-matrix-panel2/55" : "border-matrix-gold/45 bg-matrix-goldSoft/25"
                        }`}
                        key={notification.id}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                              notification.type === "ERROR"
                                ? "border-red-500/40 text-red-200"
                                : notification.type === "WARNING"
                                  ? "border-amber-500/40 text-amber-200"
                                  : notification.type === "SUCCESS"
                                    ? "border-emerald-500/40 text-emerald-200"
                                    : "border-matrix-gold/40 text-matrix-gold"
                            }`}
                          >
                            {notification.type}
                          </span>
                          <span className="text-[11px] text-matrix-muted">{new Date(notification.createdAt).toLocaleString("pt-BR")}</span>
                        </div>
                        <p className="mt-2 font-semibold text-matrix-fg">{notification.title}</p>
                        <p className="mt-1 text-xs leading-5 text-matrix-muted">{notification.message}</p>
                      </div>
                    ))
                  : null}
              </div>
            </div>
          ) : null}
        </div>
        <div
          className={cn(
            "hidden min-w-0 items-center gap-3 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 md:flex",
            denseDesktopShell && "lg:!w-[9.625rem] lg:!gap-2 lg:!px-2"
          )}
        >
          <UserRound className="h-4 w-4 shrink-0 text-matrix-gold" />
          <div className="min-w-0">
            <p className={cn("truncate text-xs text-matrix-muted", denseDesktopShell && "lg:!text-[10px]")}>{session?.organization.name ?? "Organizacao"}</p>
            <p className={cn("truncate text-sm font-semibold text-matrix-fg", denseDesktopShell && "lg:!text-xs")}>{session?.user.name ?? session?.user.email ?? "Usuario"}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted hover:text-matrix-gold"
          title="Sair"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

export const Topbar = memo(TopbarComponent);
