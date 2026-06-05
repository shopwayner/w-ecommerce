"use client";

import { useEffect, useState } from "react";
import { Cable, RefreshCw, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

type Connection = { id: string; name: string; role: "MATRIX" | "BRANCH" | "OTHER"; status: string; lastSyncAt: string | null; lastTestAt: string | null };
type Rule = { id: string; productsEnabled: boolean; pricesEnabled: boolean; inventoryEnabled: boolean; ordersEnabled: boolean };

const roleLabels = { MATRIX: "Matriz", BRANCH: "Filial", OTHER: "Outra" };

export function MatrixPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [limit, setLimit] = useState({ current: 0, limit: 0 });

  useEffect(() => {
    fetch("/api/matrix")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        setConnections(payload?.connections ?? []);
        setRules(payload?.syncRules ?? []);
        setLimit(payload?.limit ?? { current: 0, limit: 0 });
      })
      .catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Central Matrix"
        description="Acompanhe Blings conectados e a base de sincronizacao que sera ativada nas proximas etapas."
        actions={<><Button onClick={() => window.location.assign("/integrations")}><Cable className="h-4 w-4" /> Conectar Bling</Button><Button variant="secondary"><RefreshCw className="h-4 w-4" /> Sincronizar agora</Button></>}
      />
      <div className="mb-4 rounded-md border border-matrix-border bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
        Blings usados no plano: {limit.current}/{limit.limit}. Produtos, pedidos e estoque ainda nao sincronizam nesta etapa.
      </div>
      {connections.length ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {connections.map((connection) => (
            <Card key={connection.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge tone={connection.role === "MATRIX" ? "purple" : "info"}>{roleLabels[connection.role]}</Badge>
                  <h3 className="mt-4 text-xl font-semibold text-white">{connection.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">{connection.status} | ultimo teste {connection.lastTestAt ? new Date(connection.lastTestAt).toLocaleString("pt-BR") : "-"}</p>
                </div>
                <ShieldCheck className="h-6 w-6 text-green-300" />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <h3 className="font-semibold text-white">Nenhum Bling conectado</h3>
          <p className="mt-2 text-sm text-slate-400">Conecte uma conta Bling em Integracoes para preparar a matriz de sincronizacao.</p>
        </Card>
      )}
      <Card className="mt-6">
        <h3 className="mb-4 font-semibold text-white">Regras preparadas</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {["Produtos", "Precos", "Estoque", "Pedidos"].map((label, index) => (
            <div key={label} className="rounded-md border border-matrix-border bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">{label}</span>
                <Badge tone={rules.length && index < 3 ? "success" : "muted"}>{rules.length && index < 3 ? "Preparado" : "Pendente"}</Badge>
              </div>
              <p className="mt-3 text-xs text-slate-500">Execucao real sera liberada depois do OAuth e dos mappers oficiais.</p>
            </div>
          ))}
        </div>
      </Card>
    </AppShell>
  );
}
