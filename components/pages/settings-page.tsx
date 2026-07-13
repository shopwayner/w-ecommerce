"use client";

import type { ReactNode } from "react";
import { CreditCard, KeyRound, Shield, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, DataTable, PageHeader } from "@/components/ui";

type SettingsData = {
  organization: {
    name: string;
    document: string | null;
    status: string;
  };
  subscription: {
    status: string;
    plan: {
      code: string;
      name: string;
      maxBlingConnections: number;
      maxMonthlyOperations: number;
      maxUsers: number;
    };
  } | null;
  usage: {
    blingConnections: number;
    blingConnectionLimit: {
      allowed: boolean;
      current: number;
      limit: number | null;
      unlimited: boolean;
    };
    operations: number;
  };
  users: Array<{
    id: string;
    name: string | null;
    email: string;
    role: string;
    status: string;
  }>;
};

const fallback: SettingsData = {
  organization: { name: "Wayner Commerce Master", document: null, status: "ACTIVE" },
  subscription: null,
  usage: { blingConnections: 0, blingConnectionLimit: { allowed: false, current: 0, limit: 0, unlimited: false }, operations: 0 },
  users: []
};

export function SettingsPage() {
  const [data, setData] = useState<SettingsData>(fallback);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.data) setData(payload.data);
      })
      .catch(() => undefined);
  }, []);

  const plan = data.subscription?.plan;
  const operationLimit = plan?.maxMonthlyOperations ?? 0;
  const operationUsage = operationLimit ? Math.min(100, Math.round((data.usage.operations / operationLimit) * 100)) : 0;

  return (
    <AppShell>
      <PageHeader title="Configuracoes" description="Empresa, usuarios, plano, seguranca e permissoes da organizacao." />
      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card>
          <div className="space-y-2">
            {["Empresa", "Usuarios e Permissoes", "Plano e Limites", "Seguranca"].map((tab) => (
              <button key={tab} className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/[0.04]">
                {tab}
              </button>
            ))}
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <h3 className="mb-4 font-semibold text-white">Empresa</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Nome da empresa" value={data.organization.name} />
              <Field label="Documento" value={data.organization.document ?? "Nao informado"} />
              <Field label="Status" value={data.organization.status} />
            </div>
          </Card>
          <Card>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-white">Usuarios e Permissoes</h3>
                <p className="mt-1 text-sm text-slate-400">Membros vinculados a esta organizacao.</p>
              </div>
              <Button variant="secondary">
                <UserPlus className="h-4 w-4" />
                Convidar
              </Button>
            </div>
            <DataTable
              columns={["Nome", "E-mail", "Papel", "Status"]}
              rows={data.users.map((user) => [
                user.name ?? "-",
                user.email,
                <Badge key={`${user.id}-role`} tone={user.role === "OWNER" ? "purple" : "info"}>{user.role}</Badge>,
                <Badge key={`${user.id}-status`} tone={user.status === "ACTIVE" ? "success" : "muted"}>{user.status}</Badge>
              ])}
            />
          </Card>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-white">Plano e Limites</h3>
                <p className="mt-1 text-sm text-slate-400">Uso mensal e limites preparados para integracoes futuras.</p>
              </div>
              <Badge tone="purple">{plan?.name ?? "Sem plano"}</Badge>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Info
                icon={<CreditCard className="h-5 w-5" />}
                title="Blings"
                detail={data.usage.blingConnectionLimit.unlimited ? `${data.usage.blingConnections} / Ilimitado` : `${data.usage.blingConnections}/${data.usage.blingConnectionLimit.limit ?? 0}`}
              />
              <Info icon={<Shield className="h-5 w-5" />} title="Operacoes" detail={`${data.usage.operations}/${operationLimit}`} />
              <Info icon={<Users className="h-5 w-5" />} title="Usuarios" detail={`${data.users.length}/${plan?.maxUsers ?? 0}`} />
            </div>
            <div className="mt-5 h-3 rounded-full bg-white/[0.06]">
              <div className="h-3 rounded-full bg-purple-400" style={{ width: `${operationUsage}%` }} />
            </div>
            <div className="mt-5">
              <Button variant="secondary">Gerenciar plano</Button>
            </div>
          </Card>
          <Card>
            <h3 className="mb-4 font-semibold text-white">Seguranca</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <Info icon={<KeyRound className="h-5 w-5" />} title="Sessao" detail="Cookie httpOnly assinado" />
              <Info icon={<Shield className="h-5 w-5" />} title="Tokens Bling" detail="Nao configurados nesta etapa" />
              <Info icon={<Users className="h-5 w-5" />} title="Permissoes" detail="OWNER, ADMIN, OPERATOR, VIEWER" />
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="grid gap-2 text-sm text-slate-400">
      {label}
      <input value={value} readOnly className="rounded-md border border-matrix-border bg-white/[0.03] px-3 py-2 text-slate-200 outline-none" />
    </label>
  );
}

function Info({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="rounded-md border border-matrix-border bg-white/[0.02] p-4 text-slate-300">
      {icon}
      <p className="mt-3 font-medium text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}
