"use client";

import { useEffect, useMemo, useState } from "react";
import { Lightbulb, Plus, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card } from "@/components/ui";

type MarketplaceKey = "mercadolivre" | "magalu" | "shopee" | "shopeeAds" | "amazon" | "shein" | "tiktok";

type MercadoLivreStatus = {
  configured: boolean;
  data: null | {
    id: string;
    siteId: string;
    status: "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED" | "PENDING";
    statusLabel: string;
    connectedAt: string;
    updatedAt: string;
    lastError: string | null;
  };
};

type Marketplace = {
  key: MarketplaceKey;
  name: string;
  description: string;
  logo: "mercadolivre" | "magalu" | "shopee" | "shopeeAds" | "amazon" | "shein" | "tiktok";
};

const marketplaces: Marketplace[] = [
  { key: "mercadolivre", name: "Mercado Livre", description: "Publicação e pedidos marketplace.", logo: "mercadolivre" },
  { key: "magalu", name: "Magalu", description: "Catálogo e pedidos.", logo: "magalu" },
  { key: "shopee", name: "Shopee", description: "Catálogo e pedidos.", logo: "shopee" },
  { key: "shopeeAds", name: "Shopee ADS", description: "Campanhas e anúncios.", logo: "shopeeAds" },
  { key: "amazon", name: "Amazon", description: "Catálogo e pedidos.", logo: "amazon" },
  { key: "shein", name: "Shein", description: "Hub de canais em preparação.", logo: "shein" },
  { key: "tiktok", name: "TikTok Shop", description: "Catálogo e pedidos.", logo: "tiktok" }
];

function LogoFrame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`grid h-14 w-14 shrink-0 place-items-center shadow-gold ${className}`}>{children}</div>;
}

function MercadoLivreLogo() {
  return (
    <LogoFrame className="rounded-full bg-[#fff159]">
      <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 64 64">
        <ellipse cx="32" cy="32" rx="28" ry="20" fill="#2d6cdf" />
        <path d="M13 32c7-9 15-12 23-10 7 2 12 6 15 10-6 8-14 12-23 10-7-2-12-5-15-10Z" fill="#fff159" />
        <path d="M19 31c6 4 11 5 16 1l4-3c2-1 4-1 6 1l3 3" fill="none" stroke="#173b82" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <path d="M18 33l9 8c2 2 5 2 7 0l12-10" fill="none" stroke="#173b82" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <path d="M27 28l5 4m-1 4 5 4m2-8 5 4" stroke="#173b82" strokeLinecap="round" strokeWidth="2" />
      </svg>
    </LogoFrame>
  );
}

function MagaluLogo() {
  return (
    <LogoFrame className="rounded-xl bg-gradient-to-br from-[#20a7ff] to-[#0057ff]">
      <span className="text-4xl font-black leading-none text-white">M</span>
    </LogoFrame>
  );
}

function ShopeeLogo({ ads = false }: { ads?: boolean }) {
  return (
    <LogoFrame className="relative rounded-xl bg-gradient-to-br from-[#ff6a3a] to-[#ee2f18]">
      <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 64 64">
        <path d="M18 22h28l4 31H14l4-31Z" fill="#ff4f25" stroke="#ffdfd7" strokeWidth="2" />
        <path d="M24 22c0-7 4-11 8-11s8 4 8 11" fill="none" stroke="#ffdfd7" strokeLinecap="round" strokeWidth="4" />
        <text x="32" y="45" fill="white" fontFamily="Arial, sans-serif" fontSize="25" fontWeight="800" textAnchor="middle">S</text>
      </svg>
      {ads ? <span className="absolute -right-1 -top-1 rounded bg-matrix-gold px-1.5 py-0.5 text-[9px] font-black text-black shadow-gold">ADS</span> : null}
    </LogoFrame>
  );
}

function AmazonLogo() {
  return (
    <LogoFrame className="rounded-xl bg-white">
      <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 64 64">
        <text x="28" y="38" fill="#111" fontFamily="Arial, sans-serif" fontSize="36" fontWeight="800" textAnchor="middle">a</text>
        <path d="M16 44c10 7 23 7 34 0" fill="none" stroke="#ff9900" strokeLinecap="round" strokeWidth="4" />
        <path d="M45 41l7 3-6 4" fill="none" stroke="#ff9900" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      </svg>
    </LogoFrame>
  );
}

function SheinLogo() {
  return (
    <LogoFrame className="rounded-xl bg-black ring-1 ring-white/10">
      <span className="text-4xl font-black leading-none text-white">S</span>
    </LogoFrame>
  );
}

function TikTokShopLogo() {
  return (
    <LogoFrame className="rounded-xl bg-black">
      <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 64 64">
        <path d="M19 22h26l4 30H15l4-30Z" fill="#0b0b0b" stroke="#24f4ee" strokeWidth="3" />
        <path d="M23 22c0-6 4-10 9-10s9 4 9 10" fill="none" stroke="#fe2c55" strokeLinecap="round" strokeWidth="3" />
        <path d="M35 20v17a8 8 0 1 1-7-8" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        <path d="M35 20c3 5 6 7 11 7" fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="4" />
      </svg>
    </LogoFrame>
  );
}

function MarketplaceLogo({ marketplace }: { marketplace: Marketplace }) {
  if (marketplace.logo === "mercadolivre") return <MercadoLivreLogo />;
  if (marketplace.logo === "magalu") return <MagaluLogo />;
  if (marketplace.logo === "shopee") return <ShopeeLogo />;
  if (marketplace.logo === "shopeeAds") return <ShopeeLogo ads />;
  if (marketplace.logo === "amazon") return <AmazonLogo />;
  if (marketplace.logo === "shein") return <SheinLogo />;
  return <TikTokShopLogo />;
}

function statusFor(marketplace: Marketplace, mercadoLivre: MercadoLivreStatus) {
  if (marketplace.key !== "mercadolivre") {
    return { label: "Não integrado", tone: "muted" as const };
  }

  if (mercadoLivre.data?.status === "ACTIVE") return { label: "Integrado", tone: "success" as const };
  if (!mercadoLivre.configured) return { label: "Configuração ausente", tone: "warning" as const };
  return { label: "Não integrado", tone: "muted" as const };
}

export function MarketplacesPage() {
  const [mercadoLivre, setMercadoLivre] = useState<MercadoLivreStatus>({ configured: false, data: null });
  const [selected, setSelected] = useState<Marketplace | null>(null);
  const [message, setMessage] = useState("");
  const selectedStatus = useMemo(() => (selected ? statusFor(selected, mercadoLivre) : null), [selected, mercadoLivre]);

  async function loadMercadoLivre() {
    const response = await fetch("/api/integrations/mercadolivre");
    if (!response.ok) return;
    const payload = (await response.json()) as MercadoLivreStatus;
    setMercadoLivre(payload);
  }

  useEffect(() => {
    void loadMercadoLivre();
  }, []);

  async function connectMercadoLivre() {
    setMessage("");
    const response = await fetch("/api/integrations/mercadolivre/auth-url");
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Não foi possível iniciar a conexão Mercado Livre.");
      return;
    }

    window.location.assign(payload.authorizationUrl);
  }

  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-normal text-matrix-fg sm:text-4xl">Marketplaces</h1>
        <p className="mt-2 text-base text-matrix-muted">Canais de venda preparados para publicação e pedidos.</p>
      </div>

      <Card className="border-matrix-gold/45 bg-matrix-panel/74 p-5">
        <div className="grid gap-4 md:grid-cols-[64px_1fr]">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-matrix-goldSoft/55 text-matrix-goldDark">
            <Lightbulb className="h-8 w-8" />
          </div>
          <div>
            <h3 className="font-semibold text-matrix-goldDark">Recomendação: para uma configuração mais rápida e completa</h3>
            <ul className="mt-4 grid gap-4 text-sm leading-6 text-matrix-fg">
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span><strong>Apelido da conta:</strong> use este campo para diferenciar contas do mesmo marketplace (ex.: &quot;Magalu - Loja A&quot;, &quot;Magalu - Loja B&quot;).</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span><strong>Alíquota de imposto (%):</strong> ao atualizar, a alíquota passa a ser aplicada nos cálculos dos pedidos importados a partir da atualização.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span>Os pedidos serão importados apenas com data igual ou posterior às datas de cada integração.</span></li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7">
        {marketplaces.map((marketplace) => {
          const status = statusFor(marketplace, mercadoLivre);
          return (
            <Card
              key={marketplace.key}
              className="group flex min-h-[280px] flex-col bg-matrix-panel/78 p-4 transition hover:border-matrix-gold/55 hover:shadow-gold"
            >
              <div className="flex items-start justify-between gap-3">
                <MarketplaceLogo marketplace={marketplace} />
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <div className="mt-5 min-h-[96px]">
                <h3 className="text-lg font-semibold text-matrix-fg">{marketplace.name}</h3>
                <p className="mt-3 text-sm leading-6 text-matrix-muted">{marketplace.description}</p>
              </div>
              <Button className="mt-auto w-full border-matrix-gold/70 bg-transparent text-matrix-goldDark hover:bg-matrix-goldSoft/35" variant="secondary" onClick={() => setSelected(marketplace)}>
                <Plus className="h-4 w-4" />
                Nova integração {marketplace.name}
              </Button>
            </Card>
          );
        })}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <section
            aria-modal="true"
            className="matrix-scroll max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <MarketplaceLogo marketplace={selected} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Nova integração</p>
                  <h3 className="mt-1 text-2xl font-bold text-matrix-fg">{selected.name}</h3>
                </div>
              </div>
              <button
                aria-label="Fechar nova integração"
                className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:border-matrix-gold/45 hover:text-matrix-goldDark"
                onClick={() => setSelected(null)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {selected.key === "mercadolivre" ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-matrix-muted">Status atual</p>
                      <p className="mt-1 font-semibold text-matrix-fg">{mercadoLivre.data?.statusLabel ?? selectedStatus?.label ?? "Não integrado"}</p>
                    </div>
                    {selectedStatus ? <Badge tone={selectedStatus.tone}>{selectedStatus.label}</Badge> : null}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-matrix-muted sm:grid-cols-2">
                    <span>Site ID: {mercadoLivre.data?.siteId ?? "MLB"}</span>
                    <span>Última atualização: {mercadoLivre.data ? new Date(mercadoLivre.data.updatedAt).toLocaleString("pt-BR") : "-"}</span>
                  </div>
                  {mercadoLivre.data?.lastError ? <p className="mt-3 text-sm text-red-200">{mercadoLivre.data.lastError}</p> : null}
                </div>

                {!mercadoLivre.configured ? (
                  <div className="rounded-lg border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
                    Configuração ausente. Configure MERCADOLIVRE_CLIENT_ID, MERCADOLIVRE_CLIENT_SECRET e MERCADOLIVRE_REDIRECT_URI no servidor.
                  </div>
                ) : null}

                {message ? <p className="rounded-lg border border-matrix-border bg-matrix-panel2/60 px-3 py-2 text-sm text-matrix-muted">{message}</p> : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
                  <Button onClick={connectMercadoLivre} disabled={!mercadoLivre.configured}>Conectar Mercado Livre</Button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-lg border border-matrix-gold/25 bg-matrix-goldSoft/25 px-3 py-2 text-sm font-semibold text-matrix-goldDark">
                  Integração em preparação. A conexão real será ativada em uma próxima etapa.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Marketplace", selected.name],
                    ["Apelido da conta", ""],
                    ["Alíquota de imposto (%)", ""],
                    ["Data inicial de importação de pedidos", ""]
                  ].map(([label, value]) => (
                    <label key={label} className="grid gap-2 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3 text-sm text-matrix-muted">
                      {label}
                      <input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" defaultValue={value} disabled={label === "Marketplace"} />
                    </label>
                  ))}
                  <label className="grid gap-2 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3 text-sm text-matrix-muted sm:col-span-2">
                    Status
                    <select className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" defaultValue="PREPARING">
                      <option value="NOT_CONNECTED">Não integrado</option>
                      <option value="PREPARING">Em preparação</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
                  <Button disabled>Salvar rascunho</Button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
