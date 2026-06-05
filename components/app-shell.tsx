"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { cn } from "@/lib/utils";

const sidebarStorageKey = "matrix-sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem(sidebarStorageKey) === "1");
    } catch {
      setSidebarCollapsed(false);
    } finally {
      setHydrated(true);
    }
  }, []);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(sidebarStorageKey, next ? "1" : "0");
      } catch {
        // Visual preference only; ignore storage errors.
      }
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen bg-matrix-bg text-matrix-fg">
      <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={closeMobileSidebar}
        onToggleCollapsed={toggleSidebarCollapsed}
      />
      <div className={cn("min-h-screen w-full transition-[padding] duration-150", hydrated && sidebarCollapsed ? "lg:pl-20" : "lg:pl-72")}>
        <Topbar onMenuClick={openMobileSidebar} sidebarCollapsed={hydrated && sidebarCollapsed} />
        <main className="min-h-[calc(100vh-4rem)] w-full px-3 pb-4 pt-[4.75rem] sm:px-4 lg:px-5 2xl:px-6">{children}</main>
      </div>
    </div>
  );
}
