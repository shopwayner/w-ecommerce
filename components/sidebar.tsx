"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Menu, PanelLeftClose } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { navigationItems, type NavigationGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleCollapsed: () => void;
};

type PlanInfo = {
  planLabel: string;
  currentPeriodEnd: string | null;
};

const planLabels: Record<string, string> = {
  START: "Plano Inicial",
  MATRIX: "Plano Empresarial",
  ENTERPRISE: "Plano Enterprise"
};

let cachedPlanInfo: PlanInfo | null = null;

function isGroupActive(group: NavigationGroup, pathname: string) {
  return group.children.some((child) => pathname === child.href || (child.href !== "/" && pathname.startsWith(`${child.href}/`)));
}

function formatDate(value: string | null) {
  if (!value) return "--/--/----";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function SidebarComponent({ collapsed, mobileOpen, onCloseMobile, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const currentPath = pendingHref ?? pathname;
  const activeGroups = useMemo(
    () => navigationItems.filter((item): item is NavigationGroup => item.type === "group" && isGroupActive(item, currentPath)).map((item) => item.label),
    [currentPath]
  );
  const [openGroups, setOpenGroups] = useState<string[]>(activeGroups);
  const [planInfo, setPlanInfo] = useState<PlanInfo>(cachedPlanInfo ?? { planLabel: "Plano Empresarial", currentPeriodEnd: null });

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    setOpenGroups((current) => Array.from(new Set([...current, ...activeGroups])));
  }, [activeGroups]);

  useEffect(() => {
    if (cachedPlanInfo) return;
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const code = payload?.data?.subscription?.plan?.code;
        cachedPlanInfo = {
          planLabel: planLabels[code] ?? "Plano Empresarial",
          currentPeriodEnd: payload?.data?.subscription?.currentPeriodEnd ?? null
        };
        setPlanInfo(cachedPlanInfo);
      })
      .catch(() => undefined);
  }, []);

  function toggleGroup(label: string) {
    setOpenGroups((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]));
  }

  return (
    <>
      <div className={cn("fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden", mobileOpen ? "block" : "hidden")} onClick={onCloseMobile} />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-matrix-border bg-[rgb(var(--sidebar-background)/0.96)] px-3 py-4 shadow-glow backdrop-blur transition-all duration-200",
          collapsed ? "lg:w-20" : "lg:w-72",
          mobileOpen ? "w-72 translate-x-0" : "w-72 -translate-x-full lg:translate-x-0"
        )}
      >
        <div className={cn("mb-4 flex items-center gap-3 px-2", collapsed && "lg:flex-col lg:justify-center lg:gap-2 lg:px-0")}>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-black font-bold text-matrix-gold shadow-gold">
            M
          </div>
          <div className={cn("min-w-0", collapsed && "lg:hidden")}>
            <p className="text-xs font-medium text-matrix-muted">SaaS Hub</p>
            <h1 className="truncate text-lg font-bold tracking-normal text-matrix-fg">Matrix Commerce</h1>
          </div>
          {collapsed ? (
            <button
              onClick={onToggleCollapsed}
              className="hidden h-9 w-9 shrink-0 place-items-center rounded-md border border-matrix-gold/35 bg-matrix-panel2 text-matrix-gold shadow-gold hover:bg-matrix-gold hover:text-black lg:grid"
              title="Expandir menu"
              aria-label="Expandir menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <nav className="matrix-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            if (item.type === "group") {
              const open = openGroups.includes(item.label);
              const active = isGroupActive(item, currentPath);
              return (
                <div key={item.label}>
                  <button
                    onClick={() => toggleGroup(item.label)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-matrix-muted transition hover:bg-matrix-goldSoft/35 hover:text-matrix-fg",
                      collapsed && "lg:justify-center lg:px-2",
                      active && "border border-matrix-gold/40 bg-black text-matrix-gold shadow-gold"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className={cn("min-w-0 flex-1 truncate text-left", collapsed && "lg:hidden")}>{item.label}</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 transition", open && "rotate-180", collapsed && "lg:hidden")} />
                  </button>
                  {open ? (
                    <div className={cn("mt-1 space-y-1 border-l border-matrix-gold/25 pl-4", collapsed && "lg:hidden")}>
                      {item.children.map((child) => {
                        const childActive = currentPath === child.href || (child.href !== "/" && currentPath.startsWith(`${child.href}/`));
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            prefetch
                            onClick={() => {
                              setPendingHref(child.href);
                              onCloseMobile();
                            }}
                            className={cn(
                              "block rounded-md px-3 py-1.5 text-sm text-matrix-muted transition hover:bg-matrix-goldSoft/35 hover:text-matrix-fg",
                              childActive && "bg-matrix-goldSoft/60 font-semibold text-matrix-goldDark"
                            )}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            }

            const active = currentPath === item.href || (item.href !== "/" && currentPath.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onClick={() => {
                  setPendingHref(item.href);
                  onCloseMobile();
                }}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-matrix-muted transition hover:bg-matrix-goldSoft/35 hover:text-matrix-fg",
                  collapsed && "lg:justify-center lg:px-2",
                  active && "border border-matrix-gold/40 bg-black text-matrix-gold shadow-gold"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 shrink-0 space-y-3">
          <SidebarPlanCard collapsed={collapsed} planInfo={planInfo} />
          <button
            onClick={onToggleCollapsed}
            className={cn(
              "hidden h-11 w-full items-center justify-center gap-2 rounded-md border bg-matrix-panel px-3 text-sm font-semibold transition lg:flex",
              collapsed
                ? "border-matrix-gold/35 px-0 text-matrix-gold shadow-gold hover:bg-matrix-gold hover:text-black"
                : "border-matrix-border text-matrix-muted hover:border-matrix-gold/50 hover:text-matrix-gold"
            )}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /> Recolher menu</>}
          </button>
        </div>
      </aside>
    </>
  );
}

export const Sidebar = memo(SidebarComponent);

function SidebarPlanCard({ collapsed, planInfo }: { collapsed: boolean; planInfo: PlanInfo }) {
  return (
    <div
      className={cn(
        "rounded-md border border-matrix-gold/30 bg-black p-3 text-sm text-white shadow-gold",
        collapsed && "hidden lg:grid lg:h-10 lg:place-items-center lg:p-0"
      )}
      title={`${planInfo.planLabel} - Vencimento ${formatDate(planInfo.currentPeriodEnd)}`}
    >
      {collapsed ? (
        <PanelLeftClose className="h-4 w-4 text-matrix-gold" />
      ) : (
        <>
          <p className="font-semibold text-white">{planInfo.planLabel}</p>
          <p className="mt-1 text-xs text-matrix-gold">Vencimento {formatDate(planInfo.currentPeriodEnd)}</p>
        </>
      )}
    </div>
  );
}
