"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, ExternalLink, PackageSearch, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, DataTable, KpiCard } from "@/components/ui";

type MarketplaceConnection = {
  slug: string;
  name: string;
  accountAlias: string;
  status: string;
  statusLabel: string;
  configStatus: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
};

const kpis = [
  { label: "Ativos", value: "0", hint: "Anuncios ativos", tone: "success" as const },
  { label: "Pausados", value: "0", hint: "Anuncios pausados", tone: "warning" as const },
  { label: "Com erro", value: "0", hint: "Pendencias criticas", tone: "danger" as const },
  { label: "Sem estoque", value: "0", hint: "Sem disponibilidade", tone: "warning" as const },
  { label: "Vendas", value: "0", hint: "Periodo atual", tone: "info" as const },
  { label: "Visitas", value: "0", hint: "Periodo atual", tone: "purple" as const }
];

const tableColumns = ["Imagem", "Titulo", "ID ML", "SKU", "GTIN", "Status", "Tipo", "Preco", "Estoque", "Qualidade", "Acoes"];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}

export function MercadoLivreMarketplacePage() {
  const [connections, setConnections] = useState<MarketplaceConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch("/api/marketplaces/connections")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { connections?: MarketplaceConnection[] } | null) => {
        if (!mounted) return;
        setConnections(payload?.connections ?? []);
      })
      .catch(() => {
        if (mounted) setConnections([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const mercadoLivreConnection = useMemo(() => connections.find((connection) => connection.slug === "mercadolivre") ?? null, [connections]);
  const hasClientConnection = mercadoLivreConnection?.status === "ACTIVE";

  return (
    <AppShell>
      <div className="mb-5 flex flex-col gap-3 rounded-md border border-matrix-border bg-matrix-panel/74 px-4 py-4 shadow-glow lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-normal text-matrix-fg sm:text-4xl">Mercado Livre</h1>
            <Badge tone={hasClientConnection ? "success" : "muted"}>{hasClientConnection ? "Conta conectada" : "Configuracao ausente"}</Badge>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-matrix-muted">
            Gestao de anuncios, precos, estoque e pedidos do Mercado Livre.
          </p>
        </div>
        <Button type="button" onClick={() => window.location.assign("/marketplaces")}>
          <ExternalLink className="h-4 w-4" />
          Conectar conta Mercado Livre
        </Button>
      </div>

      {!hasClientConnection ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="border-matrix-gold/40 bg-matrix-panel/82 p-5">
            <div className="grid gap-5 md:grid-cols-[56px_1fr]">
              <div className="grid h-14 w-14 place-items-center rounded-md bg-matrix-goldSoft/55 text-matrix-goldDark">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Conta Mercado Livre ainda nao conectada</p>
                <h2 className="mt-2 text-2xl font-bold text-matrix-fg">Conecte uma conta do cliente para gerenciar anuncios reais.</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-matrix-muted">
                  Esta area gerencia anuncios reais do cliente. O Cadastro Inteligente usa uma busca read-only separada do sistema.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => window.location.assign("/marketplaces")}>
                    Conectar conta Mercado Livre
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => window.location.assign("/products/cadastro-inteligente")}>
                    Abrir Cadastro Inteligente
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="bg-matrix-panel/82 p-5">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-matrix-goldDark" />
              <h3 className="font-semibold text-matrix-fg">Separacao de seguranca</h3>
            </div>
            <div className="mt-4 grid gap-3 text-sm leading-6 text-matrix-muted">
              <p>
                Cadastro Inteligente: consulta catalogos e sugestoes com o app read-only do sistema.
              </p>
              <p>
                Marketplace Mercado Livre: usara somente MarketplaceConnection do cliente.
              </p>
              <p>
                Nenhum anuncio sera publicado ou alterado sem preview e confirmacao.
              </p>
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid gap-5">
          <Card className="border-matrix-gold/35 bg-matrix-panel/80 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Conta conectada</p>
                <h2 className="mt-1 text-xl font-bold text-matrix-fg">{mercadoLivreConnection.accountAlias}</h2>
                <p className="mt-1 text-sm text-matrix-muted">
                  Status: {mercadoLivreConnection.statusLabel} | Conectado em: {formatDate(mercadoLivreConnection.connectedAt)} | Ultima sincronizacao: {formatDate(mercadoLivreConnection.lastSyncAt)}
                </p>
              </div>
              <Badge tone="info">Tela em preparacao</Badge>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {kpis.map((kpi) => (
              <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} hint={kpi.hint} tone={kpi.tone} />
            ))}
          </div>

          <Card className="bg-matrix-panel/82 p-4">
            <div className="flex flex-col gap-3 xl:flex-row">
              <label className="min-w-0 flex-1 text-sm text-matrix-muted">
                Buscar por titulo, SKU, ID ML ou GTIN
                <input
                  className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60"
                  disabled
                  placeholder="Sincronizacao sera habilitada na proxima etapa"
                />
              </label>
              {["Status", "Tipo", "Estoque"].map((label) => (
                <label className="min-w-40 text-sm text-matrix-muted" key={label}>
                  {label}
                  <select className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" disabled>
                    <option>Todos</option>
                  </select>
                </label>
              ))}
            </div>
          </Card>

          <Card className="bg-matrix-panel/82 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PackageSearch className="h-5 w-5 text-matrix-goldDark" />
                <h3 className="font-semibold text-matrix-fg">Anuncios Mercado Livre</h3>
              </div>
              <Badge tone="muted">Read-only nesta fase</Badge>
            </div>
            <DataTable columns={tableColumns} rows={[]} emptyMessage="Sincronizacao de anuncios sera habilitada na proxima etapa." />
          </Card>

          <Card className="border-matrix-gold/30 bg-matrix-goldSoft/18 p-4">
            <div className="flex gap-3">
              <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-matrix-goldDark" />
              <p className="text-sm leading-6 text-matrix-muted">
                Esta primeira fase prepara a experiencia de gestao. Sync real, edicao de preco, estoque, imagens, dimensoes e status serao liberados em etapas futuras com preview, confirmacao e auditoria.
              </p>
            </div>
          </Card>
        </div>
      )}

      {loading ? <p className="mt-4 text-sm text-matrix-muted">Verificando conexao local do cliente...</p> : null}
    </AppShell>
  );
}
