"use client";

import { useEffect, useState } from "react";
import { Cable, Clock, KeyRound, PlugZap, ShieldCheck, TestTube2, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, DataTable, PageHeader } from "@/components/ui";

type Connection = {
  id: string;
  name: string;
  role: "MATRIX" | "BRANCH" | "OTHER";
  status: "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED" | "PENDING";
  lastSyncAt: string | null;
  lastTestAt: string | null;
  lastError: string | null;
  createdAt: string;
};

type Limit = { allowed: boolean; current: number; limit: number | null; unlimited: boolean };
type MercadoLivreConnection = {
  id: string;
  siteId: string;
  status: "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED" | "PENDING";
  statusLabel: string;
  externalUserId: string | null;
  connectedAt: string;
  updatedAt: string;
  expiresAt: string;
  lastRefreshAt: string | null;
  lastError: string | null;
};
type MercadoLivreStatus = { configured: boolean; data: MercadoLivreConnection | null };
type MercadoLivreOwnerDiagnosticStatus = {
  enabled: boolean;
  searchEnabled: boolean;
  available: boolean;
  appIdMatches: boolean;
  configured: boolean;
  expectedAppId: string;
};
type MercadoLivreOwnerDiagnosticResult = {
  outcome: "OWNER_ACCESS_CONFIRMED" | "CALLER_NOT_USER" | "OAUTH_FAILED" | "DIAGNOSTIC_FAILED";
  usersMe: {
    http: number | null;
    userIdMasked: string | null;
    siteId: string | null;
    status: "active" | "inactive" | null;
    requestId: string | null;
    error: { code: string | null; message: string } | null;
  };
  application: {
    http: number | null;
    requestId: string | null;
    id: string | null;
    name: string | null;
    active: boolean | null;
    siteId: string | null;
    status: string | null;
    certification: string | boolean | null;
    redirectUris: string[];
    permissions: string[];
    error: { code: string | null; message: string } | null;
  };
  search: {
    http: number | null;
    requestId: string | null;
    total: number | null;
    returned: number;
    results: Array<{
      id: string;
      title: string | null;
      price: number | null;
      currencyId: string | null;
      permalink: string | null;
      seller: { idMasked: string | null; nickname: string | null } | null;
    }>;
    error: { code: string | null; message: string } | null;
  };
};

const roleLabels = { MATRIX: "Matriz", BRANCH: "Filial", OTHER: "Outra" };
const statusLabels = { ACTIVE: "Ativa", EXPIRED: "Expirada", ERROR: "Erro", DISCONNECTED: "Desconectada", PENDING: "Pendente" };

function isOfficialMercadoLivreOwnerAuthorizationUrl(value: unknown, expectedAppId: string) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.origin === "https://auth.mercadolivre.com.br"
      && url.pathname === "/authorization"
      && url.searchParams.get("response_type") === "code"
      && url.searchParams.get("client_id") === expectedAppId
      && Boolean(url.searchParams.get("state"));
  } catch {
    return false;
  }
}

export function IntegrationsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [limit, setLimit] = useState<Limit>({ allowed: false, current: 0, limit: 0, unlimited: false });
  const [mercadoLivre, setMercadoLivre] = useState<MercadoLivreStatus>({ configured: false, data: null });
  const [ownerDiagnosticStatus, setOwnerDiagnosticStatus] = useState<MercadoLivreOwnerDiagnosticStatus | null>(null);
  const [ownerDiagnosticResult, setOwnerDiagnosticResult] = useState<MercadoLivreOwnerDiagnosticResult | null>(null);
  const [ownerDiagnosticLoading, setOwnerDiagnosticLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("Bling");
  const [role, setRole] = useState<Connection["role"]>("MATRIX");
  const [message, setMessage] = useState("");

  async function load() {
    const [response, mercadoLivreResponse, ownerDiagnosticResponse] = await Promise.all([
      fetch("/api/integrations"),
      fetch("/api/integrations/mercadolivre"),
      fetch("/api/marketplaces/mercado-livre/owner-diagnostic/status", { cache: "no-store" })
    ]);
    if (response.ok) {
      const payload = await response.json();
      setConnections(payload.data ?? []);
      setLimit(payload.limit ?? { allowed: false, current: 0, limit: 0, unlimited: false });
    }
    if (mercadoLivreResponse.ok) {
      const payload = (await mercadoLivreResponse.json()) as MercadoLivreStatus;
      setMercadoLivre(payload);
    }
    if (ownerDiagnosticResponse.ok) {
      setOwnerDiagnosticStatus((await ownerDiagnosticResponse.json()) as MercadoLivreOwnerDiagnosticStatus);
    }
  }

  useEffect(() => {
    void load();
    const url = new URL(window.location.href);
    const diagnosticStatus = url.searchParams.get("mlOwnerDiagnostic");
    if (diagnosticStatus === "complete") {
      void loadOwnerDiagnosticResult();
    } else if (diagnosticStatus === "error" || diagnosticStatus === "auth-error") {
      setMessage("Nao foi possivel concluir o diagnostico da conta proprietaria.");
    }
    if (diagnosticStatus) {
      url.searchParams.delete("mlOwnerDiagnostic");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  async function loadOwnerDiagnosticResult() {
    setOwnerDiagnosticLoading(true);
    try {
      const response = await fetch("/api/marketplaces/mercado-livre/owner-diagnostic/result", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.result) {
        setMessage(payload?.error ?? "Resultado do diagnostico indisponivel.");
        return;
      }
      setOwnerDiagnosticResult(payload.result as MercadoLivreOwnerDiagnosticResult);
      setMessage(
        payload.result.outcome === "OWNER_ACCESS_CONFIRMED"
          ? "A conta autorizada possui acesso administrativo ao aplicativo."
          : payload.result.outcome === "CALLER_NOT_USER"
            ? "A conta autorizada nao foi reconhecida como proprietaria ou administradora do aplicativo."
            : "O diagnostico foi concluido com uma resposta que exige revisao."
      );
    } finally {
      setOwnerDiagnosticLoading(false);
    }
  }

  async function startOAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/integrations/bling/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role })
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Nao foi possivel iniciar OAuth Bling.");
      return;
    }
    window.location.assign(payload.authorizationUrl);
  }

  async function testConnection(id: string) {
    setMessage("");
    const response = await fetch(`/api/integrations/${id}/test`, { method: "POST" });
    setMessage(response.ok ? "Teste de conexao concluido." : "Nao foi possivel testar a conexao.");
    await load();
  }

  async function disconnect(id: string) {
    setMessage("");
    const response = await fetch(`/api/integrations/${id}`, { method: "DELETE" });
    setMessage(response.ok ? "Conexao desconectada localmente." : "Nao foi possivel desconectar.");
    await load();
  }

  async function connectMercadoLivre() {
    setMessage("");
    const response = await fetch("/api/integrations/mercadolivre/auth-url");
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Nao foi possivel iniciar OAuth Mercado Livre.");
      return;
    }

    window.location.assign(payload.authorizationUrl);
  }

  async function disconnectMercadoLivre() {
    setMessage("");
    const response = await fetch("/api/integrations/mercadolivre", { method: "DELETE" });
    setMessage(response.ok ? "Mercado Livre desconectado localmente." : "Nao foi possivel desconectar Mercado Livre.");
    await load();
  }

  async function startOwnerDiagnostic() {
    if (!ownerDiagnosticStatus?.available) return;
    setMessage("");
    setOwnerDiagnosticResult(null);
    setOwnerDiagnosticLoading(true);
    try {
      const response = await fetch("/api/marketplaces/mercado-livre/owner-diagnostic/connect", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !isOfficialMercadoLivreOwnerAuthorizationUrl(payload?.authorizationUrl, ownerDiagnosticStatus.expectedAppId)) {
        setMessage(payload?.error ?? "Nao foi possivel iniciar o diagnostico seguro.");
        return;
      }
      window.location.assign(payload.authorizationUrl);
    } finally {
      setOwnerDiagnosticLoading(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Integracoes"
        description="Conecte contas Bling por organizacao. Tokens ficam criptografados e nunca aparecem no frontend."
        actions={
          <Button disabled={!limit.allowed} onClick={() => setModalOpen(true)}>
            <Cable className="h-4 w-4" />
            Conectar Bling
          </Button>
        }
      />

      {message ? <div className="mb-4 rounded-md border border-matrix-border bg-white/[0.03] px-4 py-3 text-sm text-slate-300">{message}</div> : null}
      {!limit.allowed ? (
        <div className="mb-4 rounded-md border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
          Limite de conexoes Bling atingido: {limit.current}/{limit.limit}.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)] 2xl:grid-cols-[minmax(0,1.55fr)_minmax(420px,0.55fr)]">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-white">Conexoes Bling</h3>
            <Badge tone={limit.allowed ? "success" : "warning"}>{limit.unlimited ? `${limit.current} / Ilimitado` : `${limit.current}/${limit.limit}`}</Badge>
          </div>
          {connections.length ? (
            <DataTable
              columns={["Nome", "Tipo", "Status", "Ultimo teste", "Acoes"]}
              rows={connections.map((connection) => [
                connection.name,
                roleLabels[connection.role],
                <Badge key={`${connection.id}-status`} tone={connection.status === "ACTIVE" ? "success" : connection.status === "ERROR" ? "danger" : "muted"}>{statusLabels[connection.status]}</Badge>,
                connection.lastTestAt ? new Date(connection.lastTestAt).toLocaleString("pt-BR") : "-",
                <div key={`${connection.id}-actions`} className="flex gap-2">
                  <button className="grid h-9 w-9 place-items-center rounded-md border border-matrix-border bg-white/[0.03] text-slate-300" onClick={() => testConnection(connection.id)} title="Testar conexao">
                    <TestTube2 className="h-4 w-4" />
                  </button>
                  <button className="grid h-9 w-9 place-items-center rounded-md border border-matrix-border bg-white/[0.03] text-red-200" onClick={() => disconnect(connection.id)} title="Desconectar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ])}
            />
          ) : (
            <div className="rounded-md border border-matrix-border bg-white/[0.02] p-6 text-sm text-slate-400">
              Nenhuma conexao Bling real cadastrada para esta organizacao.
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white"><PlugZap className="h-4 w-4 text-yellow-300" /> Mercado Livre</h3>
                <p className="mt-1 text-sm text-slate-400">OAuth por organizacao para o Cadastro Inteligente.</p>
              </div>
              <Badge tone={mercadoLivre.data?.status === "ACTIVE" ? "success" : mercadoLivre.data?.status === "ERROR" ? "danger" : "muted"}>
                {mercadoLivre.data?.statusLabel ?? "Nao conectado"}
              </Badge>
            </div>
            {!mercadoLivre.configured ? (
              <div className="mb-4 rounded-md border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
                Configure MERCADOLIVRE_CLIENT_ID, MERCADOLIVRE_CLIENT_SECRET e MERCADOLIVRE_REDIRECT_URI no servidor.
              </div>
            ) : null}
            {mercadoLivre.data ? (
              <div className="grid gap-2 text-sm text-slate-400">
                <span>Site ID: <strong className="text-slate-200">{mercadoLivre.data.siteId}</strong></span>
                <span>Conectado em: {new Date(mercadoLivre.data.connectedAt).toLocaleString("pt-BR")}</span>
                <span>Ultima atualizacao: {new Date(mercadoLivre.data.updatedAt).toLocaleString("pt-BR")}</span>
                {mercadoLivre.data.lastRefreshAt ? <span>Ultimo refresh: {new Date(mercadoLivre.data.lastRefreshAt).toLocaleString("pt-BR")}</span> : null}
                {mercadoLivre.data.lastError ? <span className="text-red-200">Erro: {mercadoLivre.data.lastError}</span> : null}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Nenhuma conta Mercado Livre conectada para esta organizacao.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={connectMercadoLivre} disabled={!mercadoLivre.configured}>
                <PlugZap className="h-4 w-4" />
                Conectar Mercado Livre
              </Button>
              {mercadoLivre.data ? (
                <Button variant="secondary" onClick={disconnectMercadoLivre}>
                  <Trash2 className="h-4 w-4" />
                  Desconectar
                </Button>
              ) : null}
            </div>
            {ownerDiagnosticStatus?.available ? (
              <div className="mt-4 border-t border-matrix-border pt-4">
                <p className="text-xs text-slate-400">
                  Autorize somente a conta proprietaria do aplicativo. O token temporario sera usado para uma unica busca de teste e nao sera salvo.
                </p>
                <Button className="mt-3" disabled={ownerDiagnosticLoading} onClick={startOwnerDiagnostic} variant="secondary">
                  <ShieldCheck className="h-4 w-4" />
                  {ownerDiagnosticLoading ? "Iniciando diagnostico..." : "Diagnosticar busca com a conta proprietaria"}
                </Button>
              </div>
            ) : null}
            {ownerDiagnosticStatus?.enabled && !ownerDiagnosticStatus.available ? (
              <p className="mt-4 rounded-md border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs text-orange-200">
                O diagnostico temporario esta habilitado, mas a configuracao segura ou o App ID nao corresponde ao esperado.
              </p>
            ) : null}
            {ownerDiagnosticResult ? (
              <div className="mt-4 space-y-3 border-t border-matrix-border pt-4 text-xs text-slate-400">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-slate-200">Resultado do diagnostico</strong>
                  <Badge tone={ownerDiagnosticResult.outcome === "OWNER_ACCESS_CONFIRMED" ? "success" : "warning"}>
                    {ownerDiagnosticResult.outcome === "OWNER_ACCESS_CONFIRMED" ? "Acesso confirmado" : "Revisao necessaria"}
                  </Badge>
                </div>
                <div className="grid gap-1 rounded-md border border-matrix-border bg-white/[0.02] p-3">
                  <strong className="text-slate-200">Conta autorizada</strong>
                  <span>HTTP: {ownerDiagnosticResult.usersMe.http ?? "-"}</span>
                  <span>Usuario: {ownerDiagnosticResult.usersMe.userIdMasked ?? "-"}</span>
                  <span>Site: {ownerDiagnosticResult.usersMe.siteId ?? "-"}</span>
                  <span>Status: {ownerDiagnosticResult.usersMe.status ?? "-"}</span>
                  <span>Request ID: {ownerDiagnosticResult.usersMe.requestId ?? "-"}</span>
                  {ownerDiagnosticResult.usersMe.error ? <span className="text-orange-200">{ownerDiagnosticResult.usersMe.error.message}</span> : null}
                </div>
                <div className="grid gap-1 rounded-md border border-matrix-border bg-white/[0.02] p-3">
                  <strong className="text-slate-200">Aplicativo</strong>
                  <span>HTTP: {ownerDiagnosticResult.application.http ?? "-"}</span>
                  <span>ID: {ownerDiagnosticResult.application.id ?? "-"}</span>
                  <span>Nome: {ownerDiagnosticResult.application.name ?? "-"}</span>
                  <span>Ativo: {ownerDiagnosticResult.application.active === null ? "-" : ownerDiagnosticResult.application.active ? "Sim" : "Nao"}</span>
                  <span>Site: {ownerDiagnosticResult.application.siteId ?? "-"}</span>
                  <span>Status: {ownerDiagnosticResult.application.status ?? "-"}</span>
                  <span>Certificacao: {ownerDiagnosticResult.application.certification === null ? "-" : String(ownerDiagnosticResult.application.certification)}</span>
                  <span>Request ID: {ownerDiagnosticResult.application.requestId ?? "-"}</span>
                  {ownerDiagnosticResult.application.redirectUris.length ? <span>Redirecionamentos: {ownerDiagnosticResult.application.redirectUris.join(", ")}</span> : null}
                  {ownerDiagnosticResult.application.permissions.length ? <span>Permissoes: {ownerDiagnosticResult.application.permissions.join(", ")}</span> : null}
                  {ownerDiagnosticResult.application.error ? <span className="text-orange-200">{ownerDiagnosticResult.application.error.message}</span> : null}
                </div>
                <div className="grid gap-2 rounded-md border border-matrix-border bg-white/[0.02] p-3">
                  <strong className="text-slate-200">Busca global de teste</strong>
                  <span>HTTP: {ownerDiagnosticResult.search.http ?? "-"}</span>
                  <span>Total: {ownerDiagnosticResult.search.total ?? "-"}</span>
                  <span>Retornados: {ownerDiagnosticResult.search.returned}</span>
                  <span>Request ID: {ownerDiagnosticResult.search.requestId ?? "-"}</span>
                  {ownerDiagnosticResult.search.error ? <span className="text-orange-200">{ownerDiagnosticResult.search.error.message}</span> : null}
                  {ownerDiagnosticResult.search.results.length ? (
                    <div className="mt-1 space-y-2">
                      {ownerDiagnosticResult.search.results.map((item) => (
                        <div className="rounded border border-matrix-border px-2 py-2" key={item.id}>
                          <div className="font-medium text-slate-200">{item.id} - {item.title ?? "Titulo indisponivel"}</div>
                          <div>{item.price === null ? "Preco indisponivel" : `${item.currencyId ?? ""} ${item.price}`.trim()}</div>
                          {item.seller ? <div>Vendedor: {item.seller.nickname ?? item.seller.idMasked ?? "-"}</div> : null}
                          {item.permalink ? <div className="break-all">Link: {item.permalink}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </Card>
          <Card>
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-white"><KeyRound className="h-4 w-4 text-cyan-300" /> OAuth Bling</h3>
            <div className="space-y-3 text-sm text-slate-400">
              <p>Authorization Code roda somente no backend.</p>
              <p>Tokens sao criptografados com AES-256-GCM.</p>
              <p>Rate limit inicial: 2 requisicoes por segundo por conexao.</p>
            </div>
          </Card>
          <Card>
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-white"><Clock className="h-4 w-4 text-purple-300" /> Proximas etapas</h3>
            <p className="text-sm text-slate-400">Produtos, pedidos, estoque e filas BullMQ/Redis serao liberados nas proximas etapas.</p>
          </Card>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <form className="w-full max-w-md rounded-md border border-matrix-border bg-matrix-panel p-5 shadow-glow" onSubmit={startOAuth}>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-semibold text-white">Conectar Bling</h3>
              <button className="grid h-9 w-9 place-items-center rounded-md border border-matrix-border text-slate-300" onClick={() => setModalOpen(false)} type="button">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="grid gap-2 text-sm text-slate-300">
              Nome da conexao
              <input className="rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-matrix-fg outline-none" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="mt-4 grid gap-2 text-sm text-slate-300">
              Tipo
              <select className="rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-matrix-fg outline-none" value={role} onChange={(event) => setRole(event.target.value as Connection["role"])}>
                <option value="MATRIX">Matriz</option>
                <option value="BRANCH">Filial</option>
                <option value="OTHER">Outra</option>
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button type="submit"><PlugZap className="h-4 w-4" /> Autorizar</Button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
