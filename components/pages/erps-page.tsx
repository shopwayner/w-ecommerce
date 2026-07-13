"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AlertTriangle, Braces, CalendarClock, CheckCircle2, Copy, Eye, EyeOff, Link2, MoreVertical, Plus, ReceiptText, Settings, ShieldCheck, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card } from "@/components/ui";

type ERPKey = "bling" | "olist" | "omie" | "conta-azul" | "custom-api";

type ERPField = {
  key: string;
  label: string;
  type?: "text" | "password" | "url" | "select";
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

type ERPConnection = {
  slug: ERPKey;
  name: string;
  supportsOAuth: boolean;
  authUrlImplemented: boolean;
  accountAlias: string;
  status: string;
  statusLabel: string;
  configStatus: string;
  credentials: Record<string, string | null>;
  hasCredentials: boolean;
  fields: ERPField[];
  taxRate: string;
  orderImportStartDate: string;
  internalNotes: string;
  productSyncEnabled: boolean;
  orderSyncEnabled: boolean;
  stockSyncEnabled: boolean;
  invoiceSyncEnabled: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastConnectionTestAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
};

type BlingIntegratedConnection = {
  id: string;
  name: string;
  role: string;
  status: string;
  lastSyncAt: string | null;
  lastTestAt: string | null;
  lastError: string | null;
  createdAt: string;
};

type ERP = {
  key: ERPKey;
  name: string;
  description: string;
  icon: "bling" | "olist" | "omie" | "conta" | "api";
};

type FormState = {
  accountAlias: string;
  credentials: Record<string, string>;
  taxRate: string;
  orderImportStartDate: string;
  internalNotes: string;
  productSyncEnabled: boolean;
  orderSyncEnabled: boolean;
  stockSyncEnabled: boolean;
  invoiceSyncEnabled: boolean;
};

const erps: ERP[] = [
  { key: "bling", name: "Bling", description: "OAuth seguro e integração ERP.", icon: "bling" },
  { key: "olist", name: "Olist", description: "ERP e hub de vendas.", icon: "olist" },
  { key: "omie", name: "Omie", description: "ERP financeiro e operacional.", icon: "omie" },
  { key: "conta-azul", name: "Conta Azul", description: "Financeiro e faturamento.", icon: "conta" },
  { key: "custom-api", name: "API personalizada", description: "Endpoints customizados com autenticação segura.", icon: "api" }
];

function ERPLogo({ erp, size = "card" }: { erp: ERP; size?: "card" | "account" }) {
  if (erp.icon === "bling") {
    return (
      <div className={size === "account" ? "flex h-16 w-28 shrink-0 items-center" : "flex h-14 w-28 shrink-0 items-center"}>
        <Image alt="Bling ERP" className="max-h-full w-full object-contain" height={73} src="/integrations/bling-erp-logo.png" width={180} />
      </div>
    );
  }
  const base = "grid h-14 w-14 shrink-0 place-items-center rounded-xl shadow-gold";
  if (erp.icon === "olist") return <div className={`${base} bg-gradient-to-br from-violet-500 to-orange-400 text-2xl font-black text-white`}>O</div>;
  if (erp.icon === "omie") return <div className={`${base} bg-gradient-to-br from-blue-500 to-indigo-700 text-2xl font-black text-white`}>Om</div>;
  if (erp.icon === "conta") return <div className={`${base} bg-gradient-to-br from-sky-400 to-blue-700 text-white`}><ReceiptText className="h-7 w-7" /></div>;
  return <div className={`${base} bg-matrix-panel2 text-matrix-goldDark ring-1 ring-matrix-gold/25`}><Braces className="h-7 w-7" /></div>;
}

function connectorBadge(connection: ERPConnection | undefined) {
  if (connection?.configStatus === "READY" || connection?.hasCredentials) {
    return { label: "Configuração pronta", tone: "info" as const };
  }
  return { label: "Configuração ausente", tone: "muted" as const };
}

function blingStatusLabel(status: string) {
  if (status === "ACTIVE") return "Conectado";
  if (status === "EXPIRED") return "Token expirado";
  if (status === "ERROR") return "Erro";
  if (status === "DISCONNECTED") return "Desconectado";
  return "Pendente";
}

function blingStatusTone(status: string) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "ERROR" || status === "EXPIRED") return "danger" as const;
  if (status === "DISCONNECTED") return "muted" as const;
  return "warning" as const;
}

function tone(status: string, configStatus: string) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "ERROR" || status === "EXPIRED") return "danger" as const;
  if (status === "AWAITING_APPROVAL") return "warning" as const;
  if (configStatus === "READY" || status === "PENDING") return "info" as const;
  return "muted" as const;
}

function buildRedirectUri(slug: ERPKey) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/api/erps/connections/${slug}/callback`;
}

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}

function createForm(connection: ERPConnection | null, erp: ERP | null): FormState {
  const credentials: Record<string, string> = {};
  connection?.fields.forEach((field) => {
    const saved = connection.credentials[field.key];
    credentials[field.key] = field.secret ? "" : saved ?? "";
    if (field.key === "redirectUri" && !credentials[field.key] && erp) credentials[field.key] = buildRedirectUri(erp.key);
    if (field.options?.length && !credentials[field.key]) credentials[field.key] = field.options[0].value;
  });
  return {
    accountAlias: connection?.accountAlias ?? (erp ? `${erp.name} - Loja Principal` : ""),
    credentials,
    taxRate: connection?.taxRate ?? "",
    orderImportStartDate: connection?.orderImportStartDate ?? "",
    internalNotes: connection?.internalNotes ?? "",
    productSyncEnabled: connection?.productSyncEnabled ?? false,
    orderSyncEnabled: connection?.orderSyncEnabled ?? false,
    stockSyncEnabled: connection?.stockSyncEnabled ?? false,
    invoiceSyncEnabled: connection?.invoiceSyncEnabled ?? false
  };
}

export function ERPsPage() {
  const [connections, setConnections] = useState<ERPConnection[]>([]);
  const [blingAccounts, setBlingAccounts] = useState<BlingIntegratedConnection[]>([]);
  const [selected, setSelected] = useState<ERP | null>(null);
  const [form, setForm] = useState<FormState>({ accountAlias: "", credentials: {}, taxRate: "", orderImportStartDate: "", internalNotes: "", productSyncEnabled: false, orderSyncEnabled: false, stockSyncEnabled: false, invoiceSyncEnabled: false });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const selectedConnection = useMemo(() => connections.find((connection) => connection.slug === selected?.key) ?? null, [connections, selected]);
  const blingErp = useMemo(() => erps.find((erp) => erp.key === "bling") ?? null, []);
  const integratedEmptyErps = useMemo(() => erps.filter((erp) => erp.key !== "bling" || blingAccounts.length === 0), [blingAccounts.length]);

  async function loadConnections() {
    const response = await fetch("/api/erps/connections");
    if (!response.ok) return;
    const payload = (await response.json()) as { connections: ERPConnection[] };
    setConnections(payload.connections);
  }

  async function loadBlingAccounts() {
    const response = await fetch("/api/integrations");
    if (!response.ok) return;
    const payload = (await response.json()) as { data?: BlingIntegratedConnection[] };
    setBlingAccounts(payload.data ?? []);
  }

  useEffect(() => {
    void loadConnections();
    void loadBlingAccounts();
  }, []);

  useEffect(() => {
    setMessage("");
    setCopyMessage("");
    setShowSecrets({});
    setForm(createForm(selectedConnection, selected));
  }, [selected, selectedConnection]);

  function replaceConnection(connection: ERPConnection) {
    setConnections((current) => current.map((item) => (item.slug === connection.slug ? connection : item)));
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/erps/connections/${selected.key}/config`, {
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
    replaceConnection(payload.connection as ERPConnection);
    setMessage("Configuração salva com segurança.");
  }

  async function testConnection() {
    if (!selected) return;
    setTesting(true);
    setMessage("");
    const response = await fetch(`/api/erps/connections/${selected.key}/test`, { method: "POST" });
    const payload = await response.json();
    setTesting(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Não foi possível testar a conexão.");
      return;
    }
    replaceConnection(payload.connection as ERPConnection);
    setMessage(payload.message ?? "Teste registrado.");
  }

  async function connectProvider() {
    if (!selected) return;
    setMessage("");
    const response = await fetch(`/api/erps/connections/${selected.key}/auth-url`);
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Autorização ainda não disponível para este ERP.");
      return;
    }
    window.location.assign(payload.authorizationUrl);
  }

  async function disconnectProvider() {
    if (!selected) return;
    const response = await fetch(`/api/erps/connections/${selected.key}/disconnect`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Não foi possível desconectar.");
      return;
    }
    replaceConnection(payload.connection as ERPConnection);
    setMessage("Integração desconectada. A configuração foi mantida.");
  }

  async function copyRedirectUri() {
    if (!selected) return;
    await navigator.clipboard.writeText(form.credentials.redirectUri || buildRedirectUri(selected.key));
    setCopyMessage("Redirect URI copiada.");
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  const canSave = Boolean(selectedConnection && form.accountAlias.trim());
  const canTest = Boolean(selectedConnection?.hasCredentials);
  const canConnect = Boolean(selectedConnection?.supportsOAuth && selectedConnection.authUrlImplemented && selectedConnection.hasCredentials);

  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-normal text-matrix-fg sm:text-4xl">ERPs</h1>
        <p className="mt-2 text-base text-matrix-muted">Conectores ERP preparados para configuração segura e integração real.</p>
      </div>

      <Card className="border-matrix-gold/45 bg-matrix-panel/74 p-5">
        <div className="grid gap-4 md:grid-cols-[64px_1fr]">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-matrix-goldSoft/55 text-matrix-goldDark">
            <Link2 className="h-8 w-8" />
          </div>
          <div>
            <h3 className="font-semibold text-matrix-goldDark">Integrações ERP com credenciais seguras</h3>
            <ul className="mt-4 grid gap-4 text-sm leading-6 text-matrix-fg">
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-matrix-gold" /><span>Tokens, app secrets, senhas e chaves são salvos criptografados.</span></li>
              <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-matrix-gold" /><span>Nesta etapa nenhuma importação, sincronização, estoque, preço ou NF é executado automaticamente.</span></li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {erps.map((erp) => {
          const connection = connections.find((item) => item.slug === erp.key);
          const badge = connectorBadge(connection);
          return (
            <Card key={erp.key} className="group flex min-h-[230px] flex-col border-matrix-gold/20 bg-matrix-panel/78 p-4 transition hover:border-matrix-gold/55 hover:shadow-gold">
              <div className="flex items-start justify-between gap-3">
                <ERPLogo erp={erp} />
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
              <div className="mt-5 min-h-[82px]">
                <h3 className="text-lg font-semibold text-matrix-fg">{erp.name}</h3>
                <p className="mt-3 text-sm leading-6 text-matrix-muted">{erp.description}</p>
              </div>
              <Button className="mt-auto w-full border-matrix-gold/70 bg-transparent text-matrix-goldDark hover:bg-matrix-goldSoft/35" variant="secondary" onClick={() => setSelected(erp)}>
                <Plus className="h-4 w-4" />
                Nova integração {erp.name}
              </Button>
            </Card>
          );
        })}
      </div>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-matrix-fg">Contas integradas</h2>
          <p className="mt-2 text-sm text-matrix-muted">Contas conectadas com seus respectivos ERPs.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {blingAccounts.map((account) => (
            <Card key={account.id} className="flex min-h-[300px] flex-col border-matrix-border bg-matrix-panel/82 p-5">
              <div className="flex items-start justify-between gap-4">
                {blingErp ? <ERPLogo erp={blingErp} size="account" /> : null}
                <Badge tone="success">Produção</Badge>
              </div>
              <div className="mt-4">
                <h3 className="text-lg font-bold text-matrix-fg">Bling</h3>
                <p className="mt-1 text-base font-semibold text-matrix-fg">{account.name}</p>
              </div>

              <div className="mt-5 border-t border-matrix-border pt-5">
                <dl className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 font-semibold text-matrix-muted"><ShieldCheck className="h-4 w-4 text-matrix-goldDark" />Ambiente</dt>
                    <dd><Badge tone="success">Produção</Badge></dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 font-semibold text-matrix-muted"><CheckCircle2 className="h-4 w-4 text-matrix-goldDark" />Status</dt>
                    <dd className="flex items-center gap-2 text-matrix-fg"><span className="h-2 w-2 rounded-full bg-emerald-400" />{blingStatusLabel(account.status)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 font-semibold text-matrix-muted"><CalendarClock className="h-4 w-4 text-matrix-goldDark" />Última sincronização</dt>
                    <dd className="text-right text-matrix-fg">{formatDate(account.lastSyncAt)}</dd>
                  </div>
                </dl>
                {account.status !== "ACTIVE" ? <div className="mt-3"><Badge tone={blingStatusTone(account.status)}>{blingStatusLabel(account.status)}</Badge></div> : null}
              </div>

              <div className="mt-auto grid grid-cols-[1fr_40px] gap-2 pt-5">
                <Button className="justify-center border-matrix-gold/70 bg-transparent text-matrix-goldDark hover:bg-matrix-goldSoft/35" disabled={!blingErp} onClick={() => blingErp && setSelected(blingErp)} type="button" variant="secondary">
                  <Settings className="h-4 w-4" />
                  Gerenciar conta
                </Button>
                <Button aria-label="Mais opções da conta Bling" className="px-0" disabled title="Opções em breve" type="button" variant="secondary">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}

          {integratedEmptyErps.map((erp) => (
            <Card key={`empty-${erp.key}`} className="flex min-h-[300px] flex-col items-center justify-center border-matrix-border bg-matrix-panel/72 p-5 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-matrix-gold/45 text-matrix-goldDark">
                <Plus className="h-8 w-8" />
              </div>
              <h3 className="mt-6 font-bold text-matrix-goldDark">Nenhuma conta integrada</h3>
              <p className="mt-4 max-w-48 text-sm leading-6 text-matrix-muted">Conecte uma conta para começar a sincronizar seus dados.</p>
              <Button className="mt-auto w-full justify-center border-matrix-gold/70 bg-transparent text-matrix-goldDark hover:bg-matrix-goldSoft/35" onClick={() => setSelected(erp)} type="button" variant="secondary">
                <Plus className="h-4 w-4" />
                Conectar conta
              </Button>
            </Card>
          ))}
        </div>
      </section>

      {selected && selectedConnection ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <section aria-modal="true" className="matrix-scroll max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-matrix-gold/35 bg-matrix-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.35)]" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <ERPLogo erp={selected} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Configurar ERP</p>
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
                  <Badge tone={tone(selectedConnection.status, selectedConnection.configStatus)}>{selectedConnection.statusLabel}</Badge>
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
                <div className="mb-4 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-matrix-goldDark" /><h4 className="font-semibold text-matrix-fg">Configuração da conta</h4></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-matrix-muted">Apelido da conta<input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" value={form.accountAlias} onChange={(event) => setForm((current) => ({ ...current, accountAlias: event.target.value }))} /></label>
                  <label className="grid gap-2 text-sm text-matrix-muted">Status<input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" value={selectedConnection.statusLabel} disabled /></label>
                </div>
              </section>

              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <h4 className="font-semibold text-matrix-fg">Credenciais da API</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {selectedConnection.fields.map((field) => (
                    <label key={field.key} className={field.key === "redirectUri" || field.key === "baseUrl" ? "grid gap-2 text-sm text-matrix-muted sm:col-span-2" : "grid gap-2 text-sm text-matrix-muted"}>
                      {field.label}{field.required ? " *" : ""}
                      {field.type === "select" ? (
                        <select className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" value={form.credentials[field.key] ?? ""} onChange={(event) => setForm((current) => ({ ...current, credentials: { ...current.credentials, [field.key]: event.target.value } }))}>
                          {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : (
                        <div className={field.secret ? "flex rounded-md border border-matrix-border bg-matrix-panel focus-within:border-matrix-gold/60" : field.key === "redirectUri" ? "flex flex-col gap-2 sm:flex-row" : ""}>
                          <input className={field.secret ? "min-w-0 flex-1 bg-transparent px-3 py-2 text-matrix-fg outline-none" : "min-w-0 flex-1 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60"} placeholder={field.secret && selectedConnection.credentials[field.key] ? "Digite novo valor para substituir" : field.placeholder} type={field.secret && !showSecrets[field.key] ? "password" : field.type === "url" ? "url" : "text"} value={form.credentials[field.key] ?? ""} onChange={(event) => setForm((current) => ({ ...current, credentials: { ...current.credentials, [field.key]: event.target.value } }))} />
                          {field.secret ? <button className="grid w-10 place-items-center text-matrix-muted hover:text-matrix-goldDark" type="button" onClick={() => setShowSecrets((current) => ({ ...current, [field.key]: !current[field.key] }))}>{showSecrets[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button> : null}
                          {field.key === "redirectUri" ? <Button className="shrink-0" type="button" variant="secondary" onClick={copyRedirectUri}><Copy className="h-4 w-4" />Copiar Redirect URI</Button> : null}
                        </div>
                      )}
                      {field.secret ? <span className="text-xs text-matrix-muted">Salvo: {selectedConnection.credentials[field.key] ?? "Não salvo"}</span> : null}
                    </label>
                  ))}
                </div>
                {copyMessage ? <p className="mt-2 text-xs text-green-300">{copyMessage}</p> : null}
              </section>

              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <h4 className="font-semibold text-matrix-fg">Sincronizações futuras</h4>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["productSyncEnabled", "Produtos"],
                    ["orderSyncEnabled", "Pedidos"],
                    ["stockSyncEnabled", "Estoque"],
                    ["invoiceSyncEnabled", "Fiscal/NF"]
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm text-matrix-muted">
                      <input type="checkbox" checked={Boolean(form[key as keyof FormState])} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))} />
                      {label}
                    </label>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
                <h4 className="font-semibold text-matrix-fg">Configurações comerciais</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-matrix-muted">Alíquota de imposto (%)<input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" inputMode="decimal" value={form.taxRate} onChange={(event) => setForm((current) => ({ ...current, taxRate: event.target.value }))} /></label>
                  <label className="grid gap-2 text-sm text-matrix-muted">Data inicial de importação de pedidos<input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" type="date" value={form.orderImportStartDate} onChange={(event) => setForm((current) => ({ ...current, orderImportStartDate: event.target.value }))} /></label>
                  <label className="grid gap-2 text-sm text-matrix-muted sm:col-span-2">Observações internas<textarea className="min-h-20 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold/60" value={form.internalNotes} onChange={(event) => setForm((current) => ({ ...current, internalNotes: event.target.value }))} /></label>
                </div>
              </section>

              <section className="space-y-2 rounded-lg border border-matrix-gold/25 bg-matrix-goldSoft/20 px-3 py-3 text-sm text-matrix-goldDark">
                <p>Nesta etapa o sistema salva credenciais reais com segurança, mas não importa produtos, pedidos, estoque, preço, NF ou dispara webhooks.</p>
                {selectedConnection.supportsOAuth && !selectedConnection.authUrlImplemented ? <p>Conectar/Autorizar será liberado quando a URL OAuth oficial deste ERP estiver implementada.</p> : null}
                {isLocalhost() ? <p className="flex gap-2 text-orange-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Para OAuth real, use domínio HTTPS público, como ngrok ou domínio de produção.</p> : null}
              </section>

              {message ? <p className="rounded-lg border border-matrix-border bg-matrix-panel2/60 px-3 py-2 text-sm text-matrix-muted">{message}</p> : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setSelected(null)}>Cancelar</Button>
                {selectedConnection.status === "ACTIVE" ? <Button variant="danger" type="button" onClick={disconnectProvider}>Desconectar</Button> : null}
                <Button type="submit" disabled={!canSave || saving}>{saving ? "Salvando..." : "Salvar configuração"}</Button>
                <Button type="button" variant="secondary" onClick={testConnection} disabled={!canTest || testing}>{testing ? "Testando..." : "Testar conexão"}</Button>
                {selectedConnection.supportsOAuth ? <Button type="button" onClick={connectProvider} disabled={!canConnect}>Conectar/Autorizar</Button> : null}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
