"use client";

import { useEffect, useMemo, useState } from "react";
import { Handshake, Lightbulb, Plus, ShoppingBag, Store, X } from "lucide-react";
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
  accent: string;
  logo: "handshake" | "m" | "bag" | "amazon" | "s" | "tiktok";
};

const marketplaces: Marketplace[] = [
  { key: "mercadolivre", name: "Mercado Livre", description: "Publicacao e pedidos marketplace.", accent: "from-blue-500 to-yellow-300", logo: "handshake" },
  { key: "magalu", name: "Magalu", description: "Catalogo e pedidos.", accent: "from-sky-400 to-blue-700", logo: "m" },
  { key: "shopee", name: "Shopee", description: "Catalogo e pedidos.", accent: "from-orange-500 to-red-500", logo: "bag" },
  { key: "shopeeAds", name: "Shopee ADS", description: "Campanhas e anuncios.", accent: "from-orange-500 to-red-500", logo: "bag" },
  { key: "amazon", name: "Amazon", description: "Catalogo e pedidos.", accent: "from-slate-100 to-slate-400", logo: "amazon" },
  { key: "shein", name: "Shein", description: "Hub de canais em preparacao.", accent: "from-black to-slate-700", logo: "s" },
  { key: "tiktok", name: "TikTok Shop", description: "Catalogo e pedidos.", accent: "from-cyan-400 via-black to-pink-500", logo: "tiktok" }
];

function MarketplaceLogo({ marketplace }: { marketplace: Marketplace }) {
  if (marketplace.logo === "amazon") {
    return (
      <div className="grid h-14 w-14 place-items-center rounded-xl bg-white text-3xl font-black text-black shadow-gold">
        a
      </div>
    );
  }

  if (marketplace.logo === "handshake") {
    return (
      <div className={`grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br ${marketplace.accent} text-lg font-black text-blue-950 shadow-gold`}>
        <Handshake className="h-8 w-8" />
      </div>
    );
  }

  if (marketplace.logo === "bag") {
    return (
      <div className={`grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br ${marketplace.accent} text-white shadow-gold`}>
        <ShoppingBag className="h-8 w-8" />
      </div>
    );
  }

  const label = marketplace.logo === "tiktok" ? "T" : marketplace.logo.toUpperCase();
  return (
    <div className={`grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br ${marketplace.accent} text-3xl font-black text-white shadow-gold`}>
      {marketplace.logo === "s" ? <Store className="h-8 w-8" /> : label}
    </div>
  );
}

function statusFor(marketplace: Marketplace, mercadoLivre: MercadoLivreStatus) {
  if (marketplace.key !== "mercadolivre") {
    return { label: "Nao integrado", tone: "muted" as const };
  }

  if (mercadoLivre.data?.status === "ACTIVE") return { label: "Integrado", tone: "success" as const };
  if (!mercadoLivre.configured) return { label: "Configuracao ausente", tone: "warning" as const };
  return { label: "Nao integrado", tone: "muted" as const };
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
      setMessage(payload.error ?? "Nao foi possivel iniciar a conexao Mercado Livre.");
      return;
    }

    window.location.assign(payload.authorizationUrl);
  }

  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-normal text-matrix-fg sm:text-4xl">Marketplaces</h1>
        <p className="mt-2 text-base text-matrix-muted">Canais de venda preparados para publicacao e pedidos.</p>
      </div>

      <Card className="border-matrix-gold/45 bg-matrix-panel/74 p-5">
        <div className="grid gap-4 md:grid-cols-[64px_1fr]">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-matrix-goldSoft/55 text-matrix-goldDark">
            <Lightbulb className="h-8 w-8" />
          </div>
          <div>
            <h3 className="font-semibold text-matrix-goldDark">Recomendacao: para uma configuracao mais rapida e completa</h3>
            <ul className="mt-4 grid gap-4 text-sm leading-6 text-matrix-fg">
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span><strong>Apelido da conta:</strong> use este campo para diferenciar contas do mesmo marketplace (ex.: &quot;Magalu - Loja A&quot;, &quot;Magalu - Loja B&quot;).</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span><strong>Aliquota de imposto (%):</strong> ao atualizar, a aliquota passa a ser aplicada nos calculos dos pedidos importados a partir da atualizacao.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span>Os pedidos serao importados apenas com data igual ou posterior as datas de cada integracao.</span></li>
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
                Nova integracao {marketplace.name}
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
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Nova integracao</p>
                  <h3 className="mt-1 text-2xl font-bold text-matrix-fg">{selected.name}</h3>
                </div>
              </div>
              <button
                aria-label="Fechar nova integracao"
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
                      <p className="mt-1 font-semibold text-matrix-fg">{mercadoLivre.data?.statusLabel ?? selectedStatus?.label ?? "Nao integrado"}</p>
                    </div>
                    {selectedStatus ? <Badge tone={selectedStatus.tone}>{selectedStatus.label}</Badge> : null}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-matrix-muted sm:grid-cols-2">
                    <span>Site ID: {mercadoLivre.data?.siteId ?? "MLB"}</span>
                    <span>Ultima atualizacao: {mercadoLivre.data ? new Date(mercadoLivre.data.updatedAt).toLocaleString("pt-BR") : "-"}</span>
                  </div>
                  {mercadoLivre.data?.lastError ? <p className="mt-3 text-sm text-red-200">{mercadoLivre.data.lastError}</p> : null}
                </div>

                {!mercadoLivre.configured ? (
                  <div className="rounded-lg border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
                    Configuracao ausente. Configure MERCADOLIVRE_CLIENT_ID, MERCADOLIVRE_CLIENT_SECRET e MERCADOLIVRE_REDIRECT_URI no servidor.
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
                  Integracao em preparacao. A conexao real sera ativada em uma proxima etapa.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Marketplace", selected.name],
                    ["Apelido da conta", ""],
                    ["Aliquota de imposto (%)", ""],
                    ["Data inicial de importacao de pedidos", ""]
                  ].map(([label, value]) => (
                    <label key={label} className="grid gap-2 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3 text-sm text-matrix-muted">
                      {label}
                      <input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" defaultValue={value} disabled={label === "Marketplace"} />
                    </label>
                  ))}
                  <label className="grid gap-2 rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3 text-sm text-matrix-muted sm:col-span-2">
                    Status
                    <select className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" defaultValue="PREPARING">
                      <option value="NOT_CONNECTED">Nao integrado</option>
                      <option value="PREPARING">Em preparacao</option>
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
