"use client";

import { Bell, LogOut, Menu, Moon, Plus, Sun, UserRound } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const NotificationCenter = dynamic(
  () => import("@/components/notification-center").then((module) => module.NotificationCenter),
  { ssr: false }
);

export type TopbarSessionView = {
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

export type TopbarAccountContextView = {
  mode: "MATRIX" | "ERP_ACCOUNT";
  label: string;
  provider: "BLING" | null;
  connectionId: string | null;
  options: AccountContextOption[];
};

const marketplaceOptions = [
  { label: "Mercado Livre", value: "mercado-livre", href: "/marketplaces/mercado-livre" },
  { label: "Amazon", value: "amazon", href: "/marketplaces" },
  { label: "Shopee", value: "shopee", href: "/marketplaces" },
  { label: "TikTok Shop", value: "tiktok-shop", href: "/marketplaces" },
  { label: "Magalu", value: "magalu", href: "/marketplaces" },
  { label: "Madeira Madeira", value: "madeira-madeira", href: "/marketplaces" }
];

let cachedSession: TopbarSessionView | null = null;

function contextKey(option: Pick<AccountContextOption, "mode" | "provider" | "connectionId">) {
  return option.mode === "ERP_ACCOUNT" ? `${option.provider}:${option.connectionId}` : "MATRIX";
}

type TopbarProps = {
  initialAccountContext?: TopbarAccountContextView | null;
  initialSession?: TopbarSessionView | null;
  onAccountContextChange?: (context: TopbarAccountContextView) => void;
  onMenuClick: () => void;
  sidebarCollapsed: boolean;
  denseDesktopShell?: boolean;
};

function TopbarComponent({
  initialAccountContext = null,
  initialSession = null,
  onAccountContextChange,
  onMenuClick,
  sidebarCollapsed,
  denseDesktopShell = false
}: TopbarProps) {
  const [session, setSession] = useState<TopbarSessionView | null>(initialSession ?? cachedSession);
  const [accountContext, setAccountContext] = useState<TopbarAccountContextView | null>(initialAccountContext);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [changingContextKey, setChangingContextKey] = useState<string | null>(null);
  const [selectedMarketplace, setSelectedMarketplace] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationCenterMounted, setNotificationCenterMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const unreadRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const unreadRefreshedAtRef = useRef(0);
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const currentLabel = accountContext?.label ?? "nenhuma";
  const currentKey = accountContext ? contextKey(accountContext) : "MATRIX";

  useEffect(() => {
    if (initialSession) {
      cachedSession = initialSession;
      return;
    }
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
  }, [initialSession]);

  useEffect(() => {
    let mounted = true;
    const loadAccountContext = () => {
      fetch("/api/account-context")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!mounted) return;
          const nextContext = data as TopbarAccountContextView | null;
          setAccountContext(nextContext);
          if (nextContext) onAccountContextChange?.(nextContext);
        })
        .catch(() => {
          if (mounted) setAccountContext(null);
        });
    };

    if (!initialAccountContext) loadAccountContext();
    window.addEventListener("w-account-context-updated", loadAccountContext);
    window.addEventListener("w-erps-active-account-updated", loadAccountContext);
    return () => {
      mounted = false;
      window.removeEventListener("w-account-context-updated", loadAccountContext);
      window.removeEventListener("w-erps-active-account-updated", loadAccountContext);
    };
  }, [initialAccountContext, onAccountContextChange]);

  useEffect(() => {
    if (!initialAccountContext) return;
    setAccountContext(initialAccountContext);
    onAccountContextChange?.(initialAccountContext);
  }, [initialAccountContext, onAccountContextChange]);

  useEffect(() => {
    setAccountMenuOpen(false);
    setNotificationsOpen(false);
    setSelectedMarketplace(pathname === "/marketplaces/mercado-livre" ? "mercado-livre" : "");
  }, [pathname]);

  useEffect(() => {
    let active = true;
    function refreshUnreadCount(force = false) {
      const now = Date.now();
      if (!force && now - unreadRefreshedAtRef.current < 30_000) {
        return unreadRefreshInFlightRef.current ?? Promise.resolve();
      }
      if (unreadRefreshInFlightRef.current) return unreadRefreshInFlightRef.current;

      const request = fetch("/api/notifications?summary=1", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const payload = (await response.json()) as { unreadCount?: number };
          unreadRefreshedAtRef.current = Date.now();
          if (active) setUnreadCount(payload.unreadCount ?? 0);
        })
        .catch(() => undefined)
        .finally(() => {
          unreadRefreshInFlightRef.current = null;
        });
      unreadRefreshInFlightRef.current = request;
      return request;
    }
    function handleRefresh() {
      void refreshUnreadCount();
    }
    function handleNotificationUpdate() {
      void refreshUnreadCount(true);
    }
    const idleWindow = window as Window & {
      cancelIdleCallback?: (id: number) => void;
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    const idleId = idleWindow.requestIdleCallback?.(
      () => void refreshUnreadCount(),
      { timeout: 2_000 }
    );
    const timeoutId = idleId === undefined
      ? window.setTimeout(() => void refreshUnreadCount(), 1_200)
      : null;
    const interval = window.setInterval(() => void refreshUnreadCount(), 60_000);
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("w-notifications-updated", handleNotificationUpdate);
    return () => {
      active = false;
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.clearInterval(interval);
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("w-notifications-updated", handleNotificationUpdate);
    };
  }, []);

  function selectMarketplace(value: string) {
    setSelectedMarketplace(value);
    const option = marketplaceOptions.find((item) => item.value === value);
    router.push(option?.href ?? "/marketplaces");
  }

  function toggleNotifications() {
    setNotificationsOpen((current) => {
      const next = !current;
      if (next) {
        setAccountMenuOpen(false);
        setNotificationCenterMounted(true);
      }
      return next;
    });
  }

  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const handleUnreadCountChange = useCallback((count: number) => {
    unreadRefreshedAtRef.current = Date.now();
    setUnreadCount(count);
  }, []);

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
    const nextContext = (await response.json()) as TopbarAccountContextView;
    setAccountContext(nextContext);
    onAccountContextChange?.(nextContext);
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
        <div className="relative">
          <button
            aria-expanded={notificationsOpen}
            aria-label="Abrir notificacoes"
            className="relative grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted hover:text-matrix-gold"
            data-notification-trigger="true"
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
          {notificationCenterMounted ? (
            <NotificationCenter
              onClose={closeNotifications}
              onUnreadCountChange={handleUnreadCountChange}
              open={notificationsOpen}
              unreadCount={unreadCount}
            />
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
