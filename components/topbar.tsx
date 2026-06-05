"use client";

import { Bell, LogOut, Menu, Moon, Plus, Search, SlidersHorizontal, Sun, UserRound } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type SessionView = {
  user: { name: string | null; email: string; role: string };
  organization: { name: string };
};

let cachedSession: SessionView | null = null;

function TopbarComponent({ onMenuClick, sidebarCollapsed }: { onMenuClick: () => void; sidebarCollapsed: boolean }) {
  const [session, setSession] = useState<SessionView | null>(cachedSession);
  const { theme, toggleTheme } = useTheme();

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
          <span className="hidden rounded-md bg-matrix-goldSoft/50 px-2 py-1 text-xs font-semibold text-matrix-goldDark md:inline">⌘ K</span>
        </div>
        <button className="hidden items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm font-semibold text-matrix-fg hover:border-matrix-gold/50 sm:flex">
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </button>
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
