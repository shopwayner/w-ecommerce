"use client";

import { Bell, LogOut, Menu, Moon, Plus, Search, Sun, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { memo, useEffect, useState } from "react";
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

let cachedSession: SessionView | null = null;

function contextKey(option: Pick<AccountContextOption, "mode" | "provider" | "connectionId">) {
  return option.mode === "ERP_ACCOUNT" ? `${option.provider}:${option.connectionId}` : "MATRIX";
}

function TopbarComponent({ onMenuClick, sidebarCollapsed }: { onMenuClick: () => void; sidebarCollapsed: boolean }) {
  const [session, setSession] = useState<SessionView | null>(cachedSession);
  const [accountContext, setAccountContext] = useState<AccountContextView | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [changingContextKey, setChangingContextKey] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();
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
  }, [pathname]);

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
      <div className="flex h-16 items-center gap-2 px-3 py-2 sm:px-4 lg:px-5">
        <button onClick={onMenuClick} className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted lg:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 gold-ring">
          <Search className="h-4 w-4 text-matrix-gold" />
          <input
            className="w-full bg-transparent text-sm text-matrix-fg outline-none placeholder:text-matrix-muted"
            placeholder="Buscar produto, SKU, pedido ou integracao"
          />
          <span className="hidden rounded-md bg-matrix-goldSoft/50 px-2 py-1 text-xs font-semibold text-matrix-goldDark md:inline">Ctrl K</span>
        </div>
        <div className="relative hidden sm:block">
          <button
            className="flex max-w-[260px] items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm font-semibold text-matrix-fg hover:border-matrix-gold/50"
            onClick={() => setAccountMenuOpen((current) => !current)}
            type="button"
          >
            <UserRound className="h-4 w-4 shrink-0 text-matrix-gold" />
            <span>Conta</span>
            <span className="min-w-0 max-w-40 truncate text-xs font-medium text-matrix-muted">{currentLabel}</span>
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
        <button className="hidden items-center gap-2 rounded-md bg-matrix-gold px-3 py-2 text-sm font-semibold text-black shadow-gold hover:bg-matrix-goldDark hover:text-white sm:flex">
          <Plus className="h-4 w-4" />
          Acao rapida
        </button>
        <button onClick={toggleTheme} className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted hover:text-matrix-gold" title="Alternar tema">
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
        <button className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted hover:text-matrix-gold" title="Notificacoes">
          <Bell className="h-4 w-4" />
        </button>
        <div className="hidden min-w-0 items-center gap-3 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 md:flex">
          <UserRound className="h-4 w-4 shrink-0 text-matrix-gold" />
          <div className="min-w-0">
            <p className="truncate text-xs text-matrix-muted">{session?.organization.name ?? "Organizacao"}</p>
            <p className="truncate text-sm font-semibold text-matrix-fg">{session?.user.name ?? session?.user.email ?? "Usuario"}</p>
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
