"use client";

import { useEffect, useState } from "react";
import { Cable, Clock, KeyRound, PlugZap, TestTube2, Trash2, X } from "lucide-react";
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

type Limit = { allowed: boolean; current: number; limit: number };

const roleLabels = { MATRIX: "Matriz", BRANCH: "Filial", OTHER: "Outra" };
const statusLabels = { ACTIVE: "Ativa", EXPIRED: "Expirada", ERROR: "Erro", DISCONNECTED: "Desconectada", PENDING: "Pendente" };

export function IntegrationsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [limit, setLimit] = useState<Limit>({ allowed: false, current: 0, limit: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("Bling");
  const [role, setRole] = useState<Connection["role"]>("MATRIX");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/integrations");
    if (!response.ok) return;
    const payload = await response.json();
    setConnections(payload.data ?? []);
    setLimit(payload.limit ?? { allowed: false, current: 0, limit: 0 });
  }

  useEffect(() => {
    load();
  }, []);

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
            <Badge tone={limit.allowed ? "success" : "warning"}>{limit.current}/{limit.limit}</Badge>
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
