import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matrix Commerce Hub",
  description: "Central SaaS multi-Bling e multi-ERP para automacao de commerce.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR" data-theme="light">
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
