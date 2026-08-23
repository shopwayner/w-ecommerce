import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShellBootstrapProvider } from "@/components/app-shell-bootstrap-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { loadAppShellBootstrap } from "@/lib/services/app-shell-bootstrap-service";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matrix Commerce Hub",
  description: "Central SaaS multi-Bling e multi-ERP para automacao de commerce.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const appShellBootstrap = await loadAppShellBootstrap();

  return (
    <html lang="pt-BR" data-theme="light">
      <body>
        <ThemeProvider>
          <AppShellBootstrapProvider initialValue={appShellBootstrap}>
            {children}
          </AppShellBootstrapProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
