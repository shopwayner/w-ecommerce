"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Eye, EyeOff, Lightbulb, Plus, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card } from "@/components/ui";

type MarketplaceKey = "mercadolivre" | "magalu" | "shopee" | "shopee-ads" | "amazon" | "shein" | "tiktok-shop";

type MarketplaceField = {
  key: string;
  label: string;
  type?: "text" | "password" | "url" | "select";
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

type MarketplaceConnection = {
  provider: string;
  slug: MarketplaceKey;
  name: string;
  supportsOAuth: boolean;
  authUrlImplemented: boolean;
  approvalHint: string | null;
  accountAlias: string;
  status: string;
  statusLabel: string;
  configStatus: string;
  credentials: Record<string, string | null>;
  hasCredentials: boolean;
  fields: MarketplaceField[];
  taxRate: string;
  orderImportStartDate: string;
  internalNotes: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastConnectionTestAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
};

type Marketplace = {
  key: MarketplaceKey;
  name: string;
  description: string;
  logo: "mercadolivre" | "magalu" | "shopee" | "shopeeAds" | "amazon" | "shein" | "tiktok";
};

type FormState = {
  accountAlias: string;
  credentials: Record<string, string>;
  taxRate: string;
  orderImportStartDate: string;
  internalNotes: string;
};

const marketplaces: Marketplace[] = [
  { key: "mercadolivre", name: "Mercado Livre", description: "Publicação e pedidos marketplace.", logo: "mercadolivre" },
  { key: "magalu", name: "Magalu", description: "Catálogo e pedidos.", logo: "magalu" },
  { key: "shopee", name: "Shopee", description: "Catálogo e pedidos.", logo: "shopee" },
  { key: "shopee-ads", name: "Shopee ADS", description: "Campanhas e anúncios.", logo: "shopeeAds" },
  { key: "amazon", name: "Amazon", description: "Catálogo e pedidos.", logo: "amazon" },
  { key: "shein", name: "Shein", description: "Hub de canais em preparação.", logo: "shein" },
  { key: "tiktok-shop", name: "TikTok Shop", description: "Catálogo e pedidos.", logo: "tiktok" }
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
  return <LogoFrame className="rounded-xl bg-gradient-to-br from-[#20a7ff] to-[#0057ff]"><span className="text-4xl font-black leading-none text-white">M</span></LogoFrame>;
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
  return <LogoFrame className="rounded-xl bg-black ring-1 ring-white/10"><span className="text-4xl font-black leading-none text-white">S</span></LogoFrame>;
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

function badgeTone(status: string, configStatus: string) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "ERROR" || status === "EXPIRED") return "danger" as const;
  if (status === "AWAITING_APPROVAL") return "warning" as const;
  if (configStatus === "READY" || status === "PENDING") return "info" as const;
  return "muted" as const;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}

function buildRedirectUri(slug: MarketplaceKey) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/api/marketplaces/connections/${slug}/callback`;
}

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isPublicHttps() {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:" && !isLocalhost();
}

function createForm(connection: MarketplaceConnection | null, marketplace: Marketplace | null): FormState {
  const credentials: Record<string, string> = {};
  connection?.fields.forEach((field) => {
    const value = connection.credentials[field.key];
    credentials[field.key] = field.secret ? "" : value ?? "";
    if (field.key === "redirectUri" && !credentials[field.key] && marketplace) credentials[field.key] = buildRedirectUri(marketplace.key);
    if (field.options?.length && !credentials[field.key]) credentials[field.key] = field.options[0].value;
    if (field.placeholder && !credentials[field.key]) credentials[field.key] = field.placeholder;
  });

  return {
    accountAlias: connection?.accountAlias ?? (marketplace ? `${marketplace.name} - Loja Principal` : ""),
    credentials,
    taxRate: connection?.taxRate ?? "",
    orderImportStartDate: connection?.orderImportStartDate ?? "",
    internalNotes: connection?.internalNotes ?? ""
  };
}

export function MarketplacesPage() {
  const [connections, setConnections] = useState<MarketplaceConnection[]>([]);
  const [selected, setSelected] = useState<Marketplace | null>(null);
  const [form, setForm] = useState<FormState>({ accountAlias: "", credentials: {}, taxRate: "", orderImportStartDate: "", internalNotes: "" });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const selectedConnection = useMemo(() => connections.find((connection) => connection.slug === selected?.key) ?? null, [connections, selected]);

  async function loadConnections() {
    const response = await fetch("/api/marketplaces/connections");
    if (!response.ok) return;
    const payload = (await response.json()) as { connections: MarketplaceConnection[] };
    setConnections(payload.connections);
  }

  useEffect(() => {
    void loadConnections();
  }, []);

  useEffect(() => {
    setMessage("");
    setCopyMessage("");
    setShowSecrets({});
    setForm(createForm(selectedConnection, selected));
  }, [selected, selectedConnection]);

  function updateCredential(key: string, value: string) {
    setForm((current) => ({ ...current, credentials: { ...current.credentials, [key]: value } }));
  }

  function replaceConnection(connection: MarketplaceConnection) {
    setConnections((current) => current.map((item) => (item.slug === connection.slug ? connection : item)));
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/marketplaces/connections/${selected.key}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Não foi possível salvar a configuração.");
      return;
    }
    replaceConnection(payload.connection as MarketplaceConnection);
    setMessage("Configuração salva com segurança.");
  }

  async function testConnection() {
    if (!selected) return;
    setTesting(true);
    setMessage("");
    const response = await fetch(`/api/marketplaces/connections/${selected.key}/test`, { method: "POST" });
    const payload = await response.json();
    setTesting(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Não foi possível testar a conexão.");
      return;
    }
    replaceConnection(payload.connection as MarketplaceConnection);
    setMessage(payload.message ?? "Teste registrado.");
  }

  async function connectProvider() {
    if (!selected) return;
    setMessage("");
    if (selected.key === "mercadolivre") {
      window.location.assign("/api/marketplaces/mercado-livre/client/connect");
      return;
    }
    const response = await fetch(`/api/marketplaces/connections/${selected.key}/auth-url`);
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Autorização ainda não disponível para este marketplace.");
      return;
    }
    window.location.assign(payload.authorizationUrl);
  }

  async function disconnectProvider() {
    if (!selected) return;
    setMessage("");
    const response = await fetch(`/api/marketplaces/connections/${selected.key}/disconnect`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Não foi possível desconectar.");
      return;
    }
    replaceConnection(payload.connection as MarketplaceConnection);
    setMessage("Integração desconectada. A configuração foi mantida.");
  }

  async function copyRedirectUri() {
    if (!selected) return;
    const redirectUri = form.credentials.redirectUri || buildRedirectUri(selected.key);
    await navigator.clipboard.writeText(redirectUri);
    setCopyMessage("Redirect URI copiada.");
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  const canSave = Boolean(selectedConnection && form.accountAlias.trim());
  const canConnect = Boolean(selectedConnection?.supportsOAuth && selectedConnection.authUrlImplemented && selectedConnection.hasCredentials);

  function connectMercadoLivreClient() {
    window.location.assign("/api/marketplaces/mercado-livre/client/connect");
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
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span><strong>Apelido da conta:</strong> use este campo para diferenciar contas do mesmo marketplace.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span><strong>Credenciais:</strong> secrets e tokens são salvos criptografados e nunca retornam completos ao frontend.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-matrix-gold" /><span>Nenhuma publicação, importação, estoque ou preço é alterado nesta etapa.</span></li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7">
        {marketplaces.map((marketplace) => {
          const connection = connections.find((item) => item.slug === marketplace.key);
          const statusLabel = connection?.statusLabel ?? "Configuração ausente";
          return (
            <Card key={marketplace.key} className="group flex min-h-[280px] flex-col bg-matrix-panel/78 p-4 transition hover:border-matrix-gold/55 hover:shadow-gold">
              <div className="flex items-start justify-between gap-3">
                <MarketplaceLogo marketplace={marketplace} />
                <Badge tone={badgeTone(connection?.status ?? "NOT_CONFIGURED", connection?.configStatus ?? "MISSING")}>{statusLabel}</Badge>
              </div>
              <div className="mt-5 min-h-[96px]">
                <h3 className="text-lg font-semibold text-matrix-fg">{marketplace.name}</h3>
                <p className="mt-3 text-sm leading-6 text-matrix-muted">{marketplace.description}</p>
              </div>
              <div className="mt-auto grid gap-2">
                {marketplace.key === "mercadolivre" ? (
                  <Button className="w-full" variant="secondary" onClick={() => window.location.assign("/marketplaces/mercado-livre")}>
                    <ExternalLink className="h-4 w-4" />
                    Abrir gestao
                  </Button>
                ) : null}
                <Button
                  className="w-full border-matrix-gold/70 bg-transparent text-matrix-goldDark hover:bg-matrix-goldSoft/35"
                  variant="secondary"
                  onClick={marketplace.key === "mercadolivre" ? connectMercadoLivreClient : () => setSelected(marketplace)}
                >
                  <Plus className="h-4 w-4" />
                  Nova integração {marketplace.name}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {selected && selectedConnection ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <section aria-modal="true" className="matrix-scroll max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.35)]" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <MarketplaceLogo marketplace={selected} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Configurar integração</p>
                  <h3 className="mt-1 text-2xl font-bold text-matrix-fg">{selected.name}</h3>
                </div>
              </div>
              <button aria-label="Fechar nova integração" className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:border-matrix-gold/45 hover:text-matrix-goldDark" onClick={() => setSelected(null)} type="button">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="mt-5 space-y-4" onSubmit={saveConfig}>
              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-matrix-muted">Status atual</p>
                    <p className="mt-1 font-semibold text-matrix-fg">{selectedConnection.statusLabel}</p>
                  </div>
                  <Badge tone={badgeTone(selectedConnection.status, selectedConnection.configStatus)}>{selectedConnection.statusLabel}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-matrix-muted sm:grid-cols-2 lg:grid-cols-4">
                  <span>Última atualização: {formatDate(selectedConnection.updatedAt)}</span>
                  <span>Último teste: {formatDate(selectedConnection.lastConnectionTestAt)}</span>
                  <span>Conectado em: {formatDate(selectedConnection.connectedAt)}</span>
                  <span>Status: {selectedConnection.status}</span>
                </div>
                {selectedConnection.lastError ? <p className="mt-3 text-sm text-orange-200">{selectedConnection.lastError}</p> : null}
              </section>

              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-matrix-goldDark" />
                  <h4 className="font-semibold text-matrix-fg">Configuração da conta</h4>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-matrix-muted">
                    Apelido da conta
                    <input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" value={form.accountAlias} onChange={(event) => setForm((current) => ({ ...current, accountAlias: event.target.value }))} />
                  </label>
                  <label className="grid gap-2 text-sm text-matrix-muted">
                    Status
                    <input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" value={selectedConnection.statusLabel} disabled />
                  </label>
                </div>
              </section>

              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <h4 className="font-semibold text-matrix-fg">Credenciais da API</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {selectedConnection.fields.map((field) => (
                    <label key={field.key} className={field.key === "redirectUri" ? "grid gap-2 text-sm text-matrix-muted sm:col-span-2" : "grid gap-2 text-sm text-matrix-muted"}>
                      {field.label}{field.required ? " *" : ""}
                      {field.type === "select" ? (
                        <select className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" value={form.credentials[field.key] ?? ""} onChange={(event) => updateCredential(field.key, event.target.value)}>
                          {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : (
                        <div className={field.secret ? "flex rounded-md border border-matrix-border bg-matrix-panel focus-within:border-matrix-gold/60" : field.key === "redirectUri" ? "flex flex-col gap-2 sm:flex-row" : ""}>
                          <input
                            className={field.secret ? "min-w-0 flex-1 bg-transparent px-3 py-2 text-matrix-fg outline-none" : "min-w-0 flex-1 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60"}
                            placeholder={field.secret && selectedConnection.credentials[field.key] ? "Digite novo valor para substituir" : field.placeholder}
                            type={field.secret && !showSecrets[field.key] ? "password" : field.type === "url" ? "url" : "text"}
                            value={form.credentials[field.key] ?? ""}
                            onChange={(event) => updateCredential(field.key, event.target.value)}
                          />
                          {field.secret ? (
                            <button className="grid w-10 place-items-center text-matrix-muted hover:text-matrix-goldDark" type="button" onClick={() => setShowSecrets((current) => ({ ...current, [field.key]: !current[field.key] }))}>
                              {showSecrets[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          ) : null}
                          {field.key === "redirectUri" ? (
                            <Button className="shrink-0" type="button" variant="secondary" onClick={copyRedirectUri}>
                              <Copy className="h-4 w-4" />
                              Copiar Redirect URI
                            </Button>
                          ) : null}
                        </div>
                      )}
                      {field.secret ? <span className="text-xs text-matrix-muted">Salvo: {selectedConnection.credentials[field.key] ?? "Não salvo"}</span> : null}
                    </label>
                  ))}
                </div>
                {copyMessage ? <p className="mt-2 text-xs text-green-300">{copyMessage}</p> : null}
              </section>

              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <h4 className="font-semibold text-matrix-fg">Configurações comerciais</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-matrix-muted">
                    Alíquota de imposto (%)
                    <input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" inputMode="decimal" value={form.taxRate} onChange={(event) => setForm((current) => ({ ...current, taxRate: event.target.value }))} />
                  </label>
                  <label className="grid gap-2 text-sm text-matrix-muted">
                    Data inicial de importação de pedidos
                    <input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" type="date" value={form.orderImportStartDate} onChange={(event) => setForm((current) => ({ ...current, orderImportStartDate: event.target.value }))} />
                  </label>
                  <label className="grid gap-2 text-sm text-matrix-muted sm:col-span-2">
                    Observações internas
                    <textarea className="min-h-20 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" value={form.internalNotes} onChange={(event) => setForm((current) => ({ ...current, internalNotes: event.target.value }))} />
                  </label>
                </div>
              </section>

              <section className="space-y-2 rounded-lg border border-matrix-gold/25 bg-matrix-goldSoft/20 px-3 py-3 text-sm text-matrix-goldDark">
                <p>Nesta etapa o sistema salva credenciais reais com segurança, mas não publica produtos, não importa pedidos, não altera estoque e não altera preços.</p>
                {selectedConnection.approvalHint ? <p>{selectedConnection.approvalHint}</p> : null}
                {selectedConnection.supportsOAuth && !selectedConnection.authUrlImplemented ? <p>Conectar/Autorizar será liberado quando a URL OAuth oficial deste provider estiver implementada.</p> : null}
                {isLocalhost() ? <p className="flex gap-2 text-orange-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Para OAuth real, use domínio HTTPS público, como ngrok ou domínio de produção.</p> : null}
                {isPublicHttps() ? <p>Domínio HTTPS público detectado. A Redirect URI sugerida usa este domínio.</p> : null}
              </section>

              {message ? <p className="rounded-lg border border-matrix-border bg-matrix-panel2/60 px-3 py-2 text-sm text-matrix-muted">{message}</p> : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setSelected(null)}>Cancelar</Button>
                {selectedConnection.status === "ACTIVE" ? <Button variant="danger" type="button" onClick={disconnectProvider}>Desconectar</Button> : null}
                <Button type="submit" disabled={!canSave || saving}>{saving ? "Salvando..." : "Salvar configuração"}</Button>
                <Button type="button" variant="secondary" onClick={testConnection} disabled={!selectedConnection.hasCredentials || testing}>{testing ? "Testando..." : "Testar conexão"}</Button>
                {selectedConnection.supportsOAuth ? <Button type="button" onClick={connectProvider} disabled={!canConnect}>Conectar/Autorizar</Button> : null}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
