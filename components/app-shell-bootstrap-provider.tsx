"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  TopbarAccountContextView,
  TopbarSessionView
} from "@/components/topbar";

export type AppShellPlanInfo = {
  planCode: string | null;
  currentPeriodEnd: string | null;
};

export type AppShellBootstrapView = {
  session: TopbarSessionView;
  accountContext: TopbarAccountContextView;
  planInfo: AppShellPlanInfo;
};

type AppShellBootstrapContextValue = AppShellBootstrapView & {
  setAccountContext: (context: TopbarAccountContextView) => void;
};

const AppShellBootstrapContext = createContext<AppShellBootstrapContextValue | null>(null);

export function AppShellBootstrapProvider({
  children,
  initialValue
}: {
  children: ReactNode;
  initialValue: AppShellBootstrapView | null;
}) {
  const [accountContext, setAccountContext] = useState(
    initialValue?.accountContext ?? null
  );

  useEffect(() => {
    setAccountContext(initialValue?.accountContext ?? null);
  }, [initialValue]);

  const value = useMemo<AppShellBootstrapContextValue | null>(
    () =>
      initialValue && accountContext
        ? { ...initialValue, accountContext, setAccountContext }
        : null,
    [accountContext, initialValue]
  );

  return (
    <AppShellBootstrapContext.Provider value={value}>
      {children}
    </AppShellBootstrapContext.Provider>
  );
}

export function useAppShellBootstrap() {
  return useContext(AppShellBootstrapContext);
}
