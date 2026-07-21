"use client";

import type { FormEvent, ReactNode } from "react";
import {
  Bell,
  Building2,
  CheckCircle2,
  CreditCard,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { isOfficialBlingAuthorizationUrl } from "@/lib/services/bling-oauth-url";
import { cn } from "@/lib/utils";

type Role = "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER";
type TabKey = "empresa" | "usuarios" | "plano" | "seguranca" | "integracoes" | "notificacoes" | "auditoria";

type SettingsData = {
  organization: {
    id: string;
    name: string;
    slug: string | null;
    document: string | null;
    documentField: "document";
    status: string;
    updatedAt: string;
  };
  currentUser: { id: string; role: Role; name: string | null; email: string };
  subscription: {
    status: string;
    enterpriseLimit: number | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    plan: {
      code: string;
      name: string;
      maxBlingConnections: number;
      maxMonthlyOperations: number;
      maxUsers: number;
      features: unknown;
    };
  } | null;
  usage: {
    blingConnections: number;
    blingConnectionLimit: { allowed: boolean; current: number; limit: number | null; unlimited: boolean };
    operations: number;
    periodStart: string;
    periodEnd: string;
    users: number;
  };
  users: Array<{
    id: string;
    userId: string;
    name: string | null;
    email: string;
    role: Role;
    status: string;
    joinedAt: string;
  }>;
};

type BlingConnection = {
  id: string;
  name: string;
  status: string;
  externalCompany: string | null;
  isDefault: boolean;
  lastSyncAt: string | null;
  lastTestAt: string | null;
  updatedAt: string;
  lastError: string | null;
  tokenValidInFuture: boolean;
  ready: boolean;
};

type NotificationItem = {
  id: string;
  type: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};

type AuditItem = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string | null;
  metadata: Record<string, unknown> | null;
  actor: string;
  actorName: string | null;
  createdAt: string;
};

type Notice = { tone: "success" | "error"; text: string } | null;
type ConfirmState = { title: string; description: string; confirmLabel: string; action: () => Promise<void> } | null;

const tabs: Array<{ key: TabKey; label: string; icon: typeof Building2 }> = [
  { key: "empresa", label: "Empresa", icon: Building2 },
  { key: "usuarios", label: "Usuários e Permissões", icon: Users },
  { key: "plano", label: "Plano e Limites", icon: CreditCard },
  { key: "seguranca", label: "Segurança", icon: ShieldCheck },
  { key: "integracoes", label: "Integrações", icon: Plug },
  { key: "notificacoes", label: "Notificações", icon: Bell },
  { key: "auditoria", label: "Auditoria", icon: ScrollText }
];

const roleLabels: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  VIEWER: "Leitura"
};

function isTabKey(value: string | null): value is TabKey {
  return tabs.some((tab) => tab.key === value);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: "Ativa",
    DISABLED: "Inativa",
    INACTIVE: "Inativa",
    SUSPENDED: "Suspensa",
    INVITED: "Convidado",
    EXPIRED: "Expirada",
    ERROR: "Com erro",
    DISCONNECTED: "Desconectada",
    PENDING: "Pendente",
    TRIALING: "Em avaliação",
    PAST_DUE: "Pagamento pendente",
    CANCELED: "Cancelada",
    SUCCESS: "Sucesso",
    FAILED: "Falha",
    BLOCKED: "Bloqueada"
  };
  return labels[status] ?? status;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Não disponível";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Não disponível" : date.toLocaleString("pt-BR");
}

function documentMask(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value ?? "";
}

async function responsePayload(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function payloadError(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.error === "string" ? payload.error : fallback;
}

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const urlTab: TabKey = isTabKey(requestedTab) ? requestedTab : "empresa";
  const [activeTab, setActiveTab] = useState<TabKey>(urlTab);
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [companyEditing, setCompanyEditing] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: "", document: "" });
  const [memberRoles, setMemberRoles] = useState<Record<string, Role>>({});
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [connections, setConnections] = useState<BlingConnection[] | null>(null);
  const [connectionsError, setConnectionsError] = useState("");
  const [connectionBusy, setConnectionBusy] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[] | null>(null);
  const [auditError, setAuditError] = useState("");
  const [auditFilters, setAuditFilters] = useState({ action: "", status: "", actor: "", date: "" });
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.data) throw new Error(payloadError(payload, "Não foi possível carregar as configurações."));
      const nextData = payload.data as SettingsData;
      setData(nextData);
      setCompanyForm({ name: nextData.organization.name, document: documentMask(nextData.organization.document) });
      setMemberRoles(Object.fromEntries(nextData.users.map((user) => [user.id, user.role])));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar as configurações.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const companyDirty = Boolean(
    data
    && companyEditing
    && (companyForm.name.trim() !== data.organization.name || companyForm.document !== documentMask(data.organization.document))
  );

  useEffect(() => {
    if (isTabKey(requestedTab)) return;
    router.replace("/settings?tab=empresa", { scroll: false });
  }, [requestedTab, router]);

  useEffect(() => {
    if (urlTab === activeTab) return;
    if (companyDirty && !window.confirm("Existem alterações não salvas. Deseja sair sem salvar?")) {
      router.replace(`/settings?tab=${activeTab}`, { scroll: false });
      return;
    }
    setCompanyEditing(false);
    setActiveTab(urlTab);
  }, [activeTab, companyDirty, router, urlTab]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!companyDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [companyDirty]);

  function changeTab(tab: TabKey) {
    if (tab === activeTab) return;
    if (companyDirty && !window.confirm("Existem alterações não salvas. Deseja sair sem salvar?")) return;
    setCompanyEditing(false);
    setActiveTab(tab);
    router.push(`/settings?tab=${tab}`, { scroll: false });
  }

  const loadConnections = useCallback(async () => {
    setConnectionsError("");
    try {
      const response = await fetch("/api/integrations", { cache: "no-store" });
      const payload = await responsePayload(response);
      if (!response.ok || !Array.isArray(payload.data)) throw new Error(payloadError(payload, "Não foi possível carregar as integrações."));
      setConnections(payload.data as BlingConnection[]);
    } catch (error) {
      setConnectionsError(error instanceof Error ? error.message : "Não foi possível carregar as integrações.");
      setConnections([]);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotificationsError("");
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const payload = await responsePayload(response);
      if (!response.ok || !Array.isArray(payload.notifications)) throw new Error(payloadError(payload, "Não foi possível carregar as notificações."));
      setNotifications(payload.notifications as NotificationItem[]);
      setUnreadCount(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "Não foi possível carregar as notificações.");
      setNotifications([]);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAuditError("");
    try {
      const response = await fetch("/api/audit-logs", { cache: "no-store" });
      const payload = await responsePayload(response);
      if (!response.ok || !Array.isArray(payload.data)) throw new Error(payloadError(payload, "Não foi possível carregar a auditoria."));
      setAuditItems(payload.data as AuditItem[]);
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "Não foi possível carregar a auditoria.");
      setAuditItems([]);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "integracoes" && connections === null) void loadConnections();
    if (activeTab === "notificacoes" && notifications === null) void loadNotifications();
    if (activeTab === "auditoria" && auditItems === null) void loadAudit();
  }, [activeTab, auditItems, connections, loadAudit, loadConnections, loadNotifications, notifications]);

  async function saveCompany(event: FormEvent) {
    event.preventDefault();
    if (!data || companySaving) return;
    setCompanySaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: companyForm.name, document: companyForm.document || null })
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.data) throw new Error(payloadError(payload, "Não foi possível salvar a empresa."));
      const updated = payload.data as SettingsData["organization"];
      setData((current) => current ? { ...current, organization: { ...current.organization, ...updated } } : current);
      setCompanyForm({ name: updated.name, document: documentMask(updated.document) });
      setCompanyEditing(false);
      setNotice({ tone: "success", text: "Dados da empresa atualizados com sucesso." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível salvar a empresa." });
    } finally {
      setCompanySaving(false);
    }
  }

  function cancelCompanyEdit() {
    if (!data) return;
    if (companyDirty && !window.confirm("Descartar as alterações da empresa?")) return;
    setCompanyForm({ name: data.organization.name, document: documentMask(data.organization.document) });
    setCompanyEditing(false);
    setNotice(null);
  }

  async function saveMemberRole(memberId: string) {
    const member = data?.users.find((item) => item.id === memberId);
    const role = memberRoles[memberId];
    if (!member || !role || role === member.role || memberBusy) return;
    if (!window.confirm(`Alterar o papel de ${member.name ?? member.email} para ${roleLabels[role]}?`)) return;
    setMemberBusy(memberId);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.data) throw new Error(payloadError(payload, "Não foi possível alterar o papel."));
      const updated = payload.data as SettingsData["users"][number];
      setData((current) => current ? { ...current, users: current.users.map((item) => item.id === memberId ? updated : item) } : current);
      setMemberRoles((current) => ({ ...current, [memberId]: updated.role }));
      setNotice({ tone: "success", text: "Papel atualizado com sucesso." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível alterar o papel." });
    } finally {
      setMemberBusy(null);
    }
  }

  function askRemoveMember(memberId: string) {
    const member = data?.users.find((item) => item.id === memberId);
    if (!member) return;
    setConfirmState({
      title: "Remover membro",
      description: `${member.name ?? member.email} perderá o acesso a esta organização. O usuário global não será excluído.`,
      confirmLabel: "Remover da organização",
      action: async () => {
        setMemberBusy(memberId);
        const response = await fetch(`/api/settings/members/${encodeURIComponent(memberId)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true })
        });
        const payload = await responsePayload(response);
        if (!response.ok) throw new Error(payloadError(payload, "Não foi possível remover o membro."));
        setData((current) => current ? { ...current, users: current.users.filter((item) => item.id !== memberId), usage: { ...current.usage, users: current.usage.users - 1 } } : current);
        setNotice({ tone: "success", text: "Membro removido da organização." });
        setMemberBusy(null);
      }
    });
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordBusy) return;
    setPasswordBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm)
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payloadError(payload, "Não foi possível alterar a senha."));
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice({ tone: "success", text: "Senha alterada com sucesso." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível alterar a senha." });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function testConnection(connectionId: string) {
    if (connectionBusy) return;
    setConnectionBusy(connectionId);
    setNotice(null);
    try {
      const response = await fetch(`/api/integrations/${encodeURIComponent(connectionId)}/test`, { method: "POST" });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payloadError(payload, "Não foi possível testar a conexão."));
      setNotice({ tone: "success", text: typeof payload.message === "string" ? payload.message : "Conexão testada com sucesso." });
      await loadConnections();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível testar a conexão." });
    } finally {
      setConnectionBusy(null);
    }
  }

  function askReconnect(connection: BlingConnection) {
    setConfirmState({
      title: "Reconectar conta Bling",
      description: `Você será direcionado ao fluxo oficial para autorizar novamente “${connection.name}”. Nenhuma reconexão ocorre automaticamente.`,
      confirmLabel: "Continuar para o Bling",
      action: async () => {
        setConnectionBusy(connection.id);
        const response = await fetch(`/api/integrations/${encodeURIComponent(connection.id)}/reconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true })
        });
        const payload = await responsePayload(response);
        if (!response.ok || typeof payload.authorizationUrl !== "string") {
          throw new Error(payloadError(payload, "Não foi possível iniciar a reconexão."));
        }
        if (!isOfficialBlingAuthorizationUrl(payload.authorizationUrl, window.location.origin)) {
          throw new Error("O endereço de autorização recebido não é válido.");
        }
        window.location.assign(payload.authorizationUrl);
      }
    });
  }

  async function markAllRead() {
    if (notificationsBusy || unreadCount === 0) return;
    setNotificationsBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payloadError(payload, "Não foi possível atualizar as notificações."));
      setNotifications((current) => current?.map((item) => ({ ...item, read: true })) ?? current);
      setUnreadCount(0);
      setNotice({ tone: "success", text: "Todas as notificações foram marcadas como lidas." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível atualizar as notificações." });
    } finally {
      setNotificationsBusy(false);
    }
  }

  const filteredAudit = useMemo(() => {
    if (!auditItems) return [];
    return auditItems.filter((item) => {
      const actionMatches = item.action.toLowerCase().includes(auditFilters.action.toLowerCase());
      const statusMatches = !auditFilters.status || item.status === auditFilters.status;
      const actorMatches = `${item.actorName ?? ""} ${item.actor}`.toLowerCase().includes(auditFilters.actor.toLowerCase());
      const dateMatches = !auditFilters.date || item.createdAt.slice(0, 10) === auditFilters.date;
      return actionMatches && statusMatches && actorMatches && dateMatches;
    });
  }, [auditFilters, auditItems]);

  async function runConfirmation() {
    if (!confirmState || confirmBusy) return;
    setConfirmBusy(true);
    setNotice(null);
    try {
      await confirmState.action();
      setConfirmState(null);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível concluir a ação." });
      setMemberBusy(null);
      setConnectionBusy(null);
      setConfirmState(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  const currentRole = data?.currentUser.role;
  const canEditCompany = currentRole === "OWNER" || currentRole === "ADMIN";
  const canManageConnections = currentRole === "OWNER" || currentRole === "ADMIN";

  return (
    <AppShell>
      <PageHeader title="Configurações" description="Administre sua empresa, acessos, segurança e integrações em um só lugar." />

      {notice ? (
        <div
          className={cn(
            "mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            notice.tone === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-200"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200"
          )}
          role="status"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice.text}</span>
        </div>
      ) : null}

      <div className="mb-4 lg:hidden">
        <label className="grid gap-1.5 text-sm font-medium text-matrix-muted" htmlFor="settings-tab-select">
          Seção
          <select
            id="settings-tab-select"
            className="w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none focus:border-matrix-gold"
            onChange={(event) => changeTab(event.target.value as TabKey)}
            value={activeTab}
          >
            {tabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="hidden self-start p-2 lg:block">
          <nav aria-label="Seções das configurações" className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  aria-current={activeTab === tab.key ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-matrix-gold",
                    activeTab === tab.key ? "bg-matrix-goldSoft/55 text-matrix-goldDark" : "text-matrix-muted hover:bg-white/[0.04] hover:text-matrix-fg"
                  )}
                  onClick={() => changeTab(tab.key)}
                  type="button"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </Card>

        <main className="min-w-0">
          {loading ? <SettingsSkeleton /> : null}
          {!loading && loadError ? (
            <EmptyState
              title="Não foi possível carregar as configurações"
              description={loadError}
              action={<Button onClick={() => void loadSettings()} type="button"><RefreshCw className="h-4 w-4" />Tentar novamente</Button>}
            />
          ) : null}
          {!loading && data ? (
            <>
              {activeTab === "empresa" ? (
                <Card>
                  <SectionHeader
                    title="Empresa"
                    description="Dados básicos usados para identificar esta organização."
                    action={canEditCompany && !companyEditing ? <Button onClick={() => setCompanyEditing(true)} type="button" variant="secondary">Editar</Button> : null}
                  />
                  <form className="mt-5" onSubmit={saveCompany}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <InputField
                        disabled={!companyEditing}
                        label="Nome da empresa"
                        maxLength={120}
                        onChange={(value) => setCompanyForm((current) => ({ ...current, name: value }))}
                        required
                        value={companyForm.name}
                      />
                      <InputField
                        disabled={!companyEditing}
                        inputMode="numeric"
                        label="CNPJ/CPF"
                        maxLength={18}
                        onChange={(value) => setCompanyForm((current) => ({ ...current, document: value }))}
                        placeholder="Não informado"
                        value={companyForm.document}
                      />
                      <ReadOnlyField label="Status" value={statusLabel(data.organization.status)} />
                      <ReadOnlyField label="Identificador interno" value={data.organization.slug ?? "Não disponível"} />
                    </div>
                    <p className="mt-3 text-xs text-matrix-muted">O campo CNPJ/CPF usa `Organization.document`; `Organization.cnpj` é apenas fallback legado de leitura.</p>
                    {companyEditing ? (
                      <div className="mt-5 flex flex-wrap justify-end gap-2">
                        <Button disabled={companySaving} onClick={cancelCompanyEdit} type="button" variant="secondary">Cancelar</Button>
                        <Button disabled={companySaving || !companyDirty || !companyForm.name.trim()} type="submit">
                          {companySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {companySaving ? "Salvando..." : "Salvar alterações"}
                        </Button>
                      </div>
                    ) : null}
                  </form>
                </Card>
              ) : null}

              {activeTab === "usuarios" ? (
                <Card>
                  <SectionHeader
                    title="Usuários e Permissões"
                    description="Membros vinculados a esta organização e seus níveis de acesso."
                    action={<Button disabled title="A infraestrutura segura de convites será adicionada em uma etapa futura." type="button" variant="secondary"><UserPlus className="h-4 w-4" />Convites — Em breve</Button>}
                  />
                  {data.users.length === 0 ? <div className="mt-5"><EmptyState title="Nenhum membro encontrado" /></div> : (
                    <div className="matrix-scroll mt-5 overflow-x-auto rounded-md border border-matrix-border">
                      <table className="min-w-[780px] w-full text-left text-sm">
                        <thead className="bg-matrix-panel2 text-xs uppercase text-matrix-muted">
                          <tr><th className="px-3 py-2.5">Membro</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Vínculo</th><th className="px-3 py-2.5">Papel</th><th className="px-3 py-2.5 text-right">Ações</th></tr>
                        </thead>
                        <tbody className="divide-y divide-matrix-border">
                          {data.users.map((member) => {
                            const canManage = currentRole === "OWNER" || (currentRole === "ADMIN" && member.role !== "OWNER");
                            const availableRoles: Role[] = currentRole === "OWNER" ? ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] : ["ADMIN", "OPERATOR", "VIEWER"];
                            return (
                              <tr key={member.id} className="align-top">
                                <td className="px-3 py-3"><p className="font-medium text-matrix-fg">{member.name ?? "Sem nome"}</p><p className="mt-1 text-xs text-matrix-muted">{member.email}</p></td>
                                <td className="px-3 py-3"><Badge tone={member.status === "ACTIVE" ? "success" : "muted"}>{statusLabel(member.status)}</Badge></td>
                                <td className="px-3 py-3 text-matrix-muted">{formatDate(member.joinedAt)}</td>
                                <td className="px-3 py-3">
                                  <select
                                    aria-label={`Papel de ${member.name ?? member.email}`}
                                    className="rounded-md border border-matrix-border bg-matrix-panel px-2.5 py-2 text-matrix-fg outline-none disabled:opacity-60"
                                    disabled={!canManage || memberBusy === member.id}
                                    onChange={(event) => setMemberRoles((current) => ({ ...current, [member.id]: event.target.value as Role }))}
                                    value={memberRoles[member.id] ?? member.role}
                                  >
                                    {availableRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                                  </select>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex justify-end gap-2">
                                    <Button disabled={!canManage || memberBusy === member.id || memberRoles[member.id] === member.role} onClick={() => void saveMemberRole(member.id)} type="button" variant="secondary">
                                      {memberBusy === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}Salvar papel
                                    </Button>
                                    <Button disabled={!canManage || memberBusy === member.id} onClick={() => askRemoveMember(member.id)} title="Remover somente o vínculo com esta organização" type="button" variant="danger"><Trash2 className="h-4 w-4" />Remover</Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ) : null}

              {activeTab === "plano" ? <PlanSection data={data} /> : null}

              {activeTab === "seguranca" ? (
                <div className="space-y-4">
                  <Card>
                    <SectionHeader title="Alterar minha senha" description="A alteração afeta somente o usuário autenticado." />
                    <form className="mt-5 grid max-w-2xl gap-4" onSubmit={changePassword}>
                      <PasswordField autoComplete="current-password" label="Senha atual" onChange={(value) => setPasswordForm((current) => ({ ...current, currentPassword: value }))} value={passwordForm.currentPassword} />
                      <PasswordField autoComplete="new-password" label="Nova senha" onChange={(value) => setPasswordForm((current) => ({ ...current, newPassword: value }))} value={passwordForm.newPassword} />
                      <PasswordField autoComplete="new-password" label="Confirmar nova senha" onChange={(value) => setPasswordForm((current) => ({ ...current, confirmPassword: value }))} value={passwordForm.confirmPassword} />
                      <p className="text-xs text-matrix-muted">Use pelo menos 12 caracteres, com letras maiúsculas, minúsculas e número.</p>
                      <div><Button disabled={passwordBusy || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword} type="submit">{passwordBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{passwordBusy ? "Alterando..." : "Alterar senha"}</Button></div>
                    </form>
                  </Card>
                  <div className="grid gap-4 md:grid-cols-3">
                    <UnavailableCard title="Sessões ativas" />
                    <UnavailableCard title="Autenticação em dois fatores" />
                    <UnavailableCard title="Histórico de login" />
                  </div>
                </div>
              ) : null}

              {activeTab === "integracoes" ? (
                <Card>
                  <SectionHeader title="Integrações Bling" description="Estado sanitizado das conexões desta organização." action={<Button disabled={connections === null} onClick={() => void loadConnections()} type="button" variant="secondary"><RefreshCw className="h-4 w-4" />Atualizar</Button>} />
                  {connections === null ? <div className="mt-5"><InlineLoading text="Carregando integrações..." /></div> : null}
                  {connectionsError ? <div className="mt-5"><InlineError message={connectionsError} retry={() => void loadConnections()} /></div> : null}
                  {connections && !connectionsError && connections.length === 0 ? <div className="mt-5"><EmptyState title="Nenhuma conexão Bling encontrada" /></div> : null}
                  {connections && connections.length > 0 ? (
                    <div className="mt-5 grid gap-3 xl:grid-cols-2">
                      {connections.map((connection) => (
                        <article key={connection.id} className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div><h3 className="font-semibold text-matrix-fg">{connection.name}</h3><p className="mt-1 text-sm text-matrix-muted">{connection.externalCompany ?? "Empresa externa não disponível"}</p></div>
                            <div className="flex gap-2"><Badge tone={connection.status === "ACTIVE" ? "success" : connection.status === "ERROR" ? "danger" : "warning"}>{statusLabel(connection.status)}</Badge>{connection.isDefault ? <Badge tone="info">Padrão</Badge> : null}</div>
                          </div>
                          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                            <Definition label="READY" value={connection.ready ? "Sim" : "Não"} />
                            <Definition label="Token com validade futura" value={connection.tokenValidInFuture ? "Sim" : "Não"} />
                            <Definition label="Última atualização" value={formatDate(connection.updatedAt)} />
                            <Definition label="Último teste" value={formatDate(connection.lastTestAt)} />
                            <Definition label="Última sincronização" value={formatDate(connection.lastSyncAt)} />
                            <Definition label="Último erro" value={connection.lastError ?? "Nenhum erro recente"} />
                          </dl>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button disabled={!canManageConnections || Boolean(connectionBusy)} onClick={() => void testConnection(connection.id)} type="button" variant="secondary">{connectionBusy === connection.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Testar conexão</Button>
                            <Button disabled={!canManageConnections || Boolean(connectionBusy)} onClick={() => askReconnect(connection)} type="button">Reconectar</Button>
                          </div>
                          {!canManageConnections ? <p className="mt-3 text-xs text-matrix-muted">Seu acesso a integrações é somente leitura.</p> : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </Card>
              ) : null}

              {activeTab === "notificacoes" ? (
                <Card>
                  <SectionHeader title="Notificações" description={`${unreadCount} não lida${unreadCount === 1 ? "" : "s"}.`} action={<Button disabled={notificationsBusy || unreadCount === 0} onClick={() => void markAllRead()} type="button" variant="secondary">{notificationsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Marcar todas como lidas</Button>} />
                  {notifications === null ? <div className="mt-5"><InlineLoading text="Carregando notificações..." /></div> : null}
                  {notificationsError ? <div className="mt-5"><InlineError message={notificationsError} retry={() => void loadNotifications()} /></div> : null}
                  {notifications && !notificationsError && notifications.length === 0 ? <div className="mt-5"><EmptyState title="Nenhuma notificação" description="Não há mensagens administrativas para esta organização." /></div> : null}
                  {notifications && notifications.length > 0 ? (
                    <div className="mt-5 divide-y divide-matrix-border rounded-md border border-matrix-border">
                      {notifications.map((item) => (
                        <article key={item.id} className={cn("p-4", !item.read && "bg-matrix-goldSoft/18")}>
                          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium text-matrix-fg">{item.title}</h3><p className="mt-1 text-sm leading-6 text-matrix-muted">{item.message}</p></div><Badge tone={item.read ? "muted" : item.type === "ERROR" ? "danger" : item.type === "WARNING" ? "warning" : "info"}>{item.read ? "Lida" : "Não lida"}</Badge></div>
                          <p className="mt-2 text-xs text-matrix-muted">{formatDate(item.createdAt)}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-4 text-xs text-matrix-muted">Preferências de e-mail, webhook e push não estão disponíveis nesta etapa.</p>
                </Card>
              ) : null}

              {activeTab === "auditoria" ? (
                <Card>
                  <SectionHeader title="Auditoria" description="Últimos registros administrativos sanitizados desta organização." action={<Button disabled={auditItems === null} onClick={() => void loadAudit()} type="button" variant="secondary"><RefreshCw className="h-4 w-4" />Atualizar</Button>} />
                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <FilterField label="Ação" onChange={(value) => setAuditFilters((current) => ({ ...current, action: value }))} value={auditFilters.action} />
                    <label className="grid gap-1.5 text-sm text-matrix-muted">Status<select className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" onChange={(event) => setAuditFilters((current) => ({ ...current, status: event.target.value }))} value={auditFilters.status}><option value="">Todos</option><option value="SUCCESS">Sucesso</option><option value="FAILED">Falha</option><option value="BLOCKED">Bloqueada</option></select></label>
                    <FilterField label="Usuário" onChange={(value) => setAuditFilters((current) => ({ ...current, actor: value }))} value={auditFilters.actor} />
                    <label className="grid gap-1.5 text-sm text-matrix-muted">Data<input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" onChange={(event) => setAuditFilters((current) => ({ ...current, date: event.target.value }))} type="date" value={auditFilters.date} /></label>
                  </div>
                  {auditItems === null ? <div className="mt-5"><InlineLoading text="Carregando auditoria..." /></div> : null}
                  {auditError ? <div className="mt-5"><InlineError message={auditError} retry={() => void loadAudit()} /></div> : null}
                  {auditItems && !auditError && filteredAudit.length === 0 ? <div className="mt-5"><EmptyState title="Nenhum registro encontrado" /></div> : null}
                  {filteredAudit.length > 0 ? (
                    <div className="matrix-scroll mt-5 overflow-x-auto rounded-md border border-matrix-border">
                      <table className="min-w-[820px] w-full text-left text-sm"><thead className="bg-matrix-panel2 text-xs uppercase text-matrix-muted"><tr><th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Usuário</th><th className="px-3 py-2.5">Ação</th><th className="px-3 py-2.5">Recurso</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Risco</th><th className="px-3 py-2.5">Detalhes</th></tr></thead><tbody className="divide-y divide-matrix-border">{filteredAudit.map((item) => <tr key={item.id} className="align-top"><td className="whitespace-nowrap px-3 py-3 text-matrix-muted">{formatDate(item.createdAt)}</td><td className="px-3 py-3"><p className="text-matrix-fg">{item.actorName ?? "Sistema"}</p><p className="text-xs text-matrix-muted">{item.actor}</p></td><td className="px-3 py-3 font-medium text-matrix-fg">{item.action}</td><td className="px-3 py-3 text-matrix-muted">{item.entity ?? "Não disponível"}</td><td className="px-3 py-3"><Badge tone={item.status === "SUCCESS" ? "success" : item.status === "FAILED" ? "danger" : "warning"}>{statusLabel(item.status)}</Badge></td><td className="px-3 py-3 text-matrix-muted">{item.riskLevel}</td><td className="max-w-[260px] px-3 py-3"><p className="break-words text-matrix-muted">{item.summary ?? "Sem detalhes"}</p>{item.metadata ? <details className="mt-1"><summary className="cursor-pointer text-xs text-matrix-goldDark">Metadados sanitizados</summary><pre className="mt-2 max-w-[250px] whitespace-pre-wrap break-all text-xs text-matrix-muted">{JSON.stringify(item.metadata, null, 2)}</pre></details> : null}</td></tr>)}</tbody></table>
                    </div>
                  ) : null}
                </Card>
              ) : null}
            </>
          ) : null}
        </main>
      </div>

      {confirmState ? (
        <ConfirmDialog
          busy={confirmBusy}
          confirmLabel={confirmState.confirmLabel}
          description={confirmState.description}
          onCancel={() => !confirmBusy && setConfirmState(null)}
          onConfirm={() => void runConfirmation()}
          title={confirmState.title}
        />
      ) : null}
    </AppShell>
  );
}

function PlanSection({ data }: { data: SettingsData }) {
  const subscription = data.subscription;
  if (!subscription) return <Card><EmptyState title="Plano não disponível" description="Esta organização não possui uma assinatura registrada." /></Card>;
  const plan = subscription.plan;
  const operationPercent = plan.maxMonthlyOperations > 0 ? Math.min(100, Math.round((data.usage.operations / plan.maxMonthlyOperations) * 100)) : 0;
  const userPercent = plan.maxUsers > 0 ? Math.min(100, Math.round((data.usage.users / plan.maxUsers) * 100)) : 0;
  const connectionLimit = data.usage.blingConnectionLimit.unlimited ? null : data.usage.blingConnectionLimit.limit;
  const connectionPercent = connectionLimit && connectionLimit > 0 ? Math.min(100, Math.round((data.usage.blingConnections / connectionLimit) * 100)) : 0;
  const featureNames = Array.isArray(plan.features)
    ? plan.features.filter((item): item is string => typeof item === "string")
    : plan.features && typeof plan.features === "object"
      ? Object.entries(plan.features as Record<string, unknown>).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name)
      : [];

  return (
    <Card>
      <SectionHeader title="Plano e Limites" description="Consumo do período atual com base nos dados registrados." action={<Badge tone="purple">{plan.name}</Badge>} />
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DefinitionCard label="Assinatura" value={statusLabel(subscription.status)} />
        <DefinitionCard label="Vencimento do período" value={formatDate(subscription.currentPeriodEnd)} />
        <DefinitionCard label="Início do período" value={formatDate(subscription.currentPeriodStart)} />
        <DefinitionCard label="Preço e cobrança" value="Não disponível" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <UsageCard label="Conexões Bling" percent={connectionPercent} value={data.usage.blingConnectionLimit.unlimited ? `${data.usage.blingConnections} / Ilimitado` : `${data.usage.blingConnections} / ${connectionLimit ?? 0}`} />
        <UsageCard label="Operações" percent={operationPercent} value={`${data.usage.operations} / ${plan.maxMonthlyOperations}`} />
        <UsageCard label="Usuários" percent={userPercent} value={`${data.usage.users} / ${plan.maxUsers}`} />
      </div>
      {Math.max(operationPercent, userPercent, connectionPercent) >= 80 ? <p className="mt-4 rounded-md border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-sm text-orange-700 dark:text-orange-200">Um ou mais limites estão próximos da capacidade.</p> : null}
      <div className="mt-5"><h3 className="font-medium text-matrix-fg">Recursos registrados</h3>{featureNames.length ? <ul className="mt-2 grid gap-2 text-sm text-matrix-muted sm:grid-cols-2">{featureNames.map((feature) => <li key={feature}>• {feature}</li>)}</ul> : <p className="mt-2 text-sm text-matrix-muted">Não disponível</p>}</div>
      <div className="mt-5"><Button disabled title="A gestão de cobrança ainda não está integrada." type="button" variant="secondary">Gerenciar plano — Em breve</Button></div>
    </Card>
  );
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-semibold text-matrix-fg">{title}</h2><p className="mt-1 text-sm text-matrix-muted">{description}</p></div>{action ? <div className="shrink-0">{action}</div> : null}</div>;
}

function InputField({ label, value, onChange, ...props }: { label: string; value: string; onChange: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <label className="grid gap-1.5 text-sm font-medium text-matrix-muted">{label}<input {...props} className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none transition focus:border-matrix-gold disabled:bg-matrix-panel2/40 disabled:text-matrix-muted" onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  return <InputField autoComplete={autoComplete} label={label} maxLength={128} minLength={1} onChange={onChange} required type="password" value={value} />;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1.5 text-sm font-medium text-matrix-muted"><span>{label}</span><div className="min-h-10 rounded-md border border-matrix-border bg-matrix-panel2/40 px-3 py-2 text-matrix-fg">{value}</div></div>;
}

function FilterField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1.5 text-sm text-matrix-muted">{label}<input className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-matrix-fg outline-none" onChange={(event) => onChange(event.target.value)} type="search" value={value} /></label>;
}

function Definition({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-matrix-muted">{label}</dt><dd className="mt-1 break-words text-matrix-fg">{value}</dd></div>;
}

function DefinitionCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-4"><p className="text-xs text-matrix-muted">{label}</p><p className="mt-2 font-semibold text-matrix-fg">{value}</p></div>;
}

function UsageCard({ label, value, percent }: { label: string; value: string; percent: number }) {
  return <div className="rounded-md border border-matrix-border bg-matrix-panel2/45 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-matrix-fg">{label}</p><span className="text-sm text-matrix-muted">{value}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className={cn("h-full rounded-full", percent >= 90 ? "bg-red-500" : percent >= 80 ? "bg-orange-500" : "bg-matrix-gold")} style={{ width: `${percent}%` }} /></div></div>;
}

function UnavailableCard({ title }: { title: string }) {
  return <Card><p className="font-medium text-matrix-fg">{title}</p><p className="mt-2 text-sm text-matrix-muted">Não disponível nesta etapa.</p></Card>;
}

function InlineLoading({ text }: { text: string }) {
  return <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-matrix-muted"><Loader2 className="h-5 w-5 animate-spin" />{text}</div>;
}

function InlineError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="rounded-md border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200"><p>{message}</p><Button className="mt-3" onClick={retry} type="button" variant="secondary"><RefreshCw className="h-4 w-4" />Tentar novamente</Button></div>;
}

function SettingsSkeleton() {
  return <Card><div className="animate-pulse space-y-4" aria-label="Carregando configurações"><div className="h-6 w-48 rounded bg-white/[0.07]" /><div className="grid gap-4 md:grid-cols-2"><div className="h-20 rounded bg-white/[0.05]" /><div className="h-20 rounded bg-white/[0.05]" /></div><div className="h-10 w-36 rounded bg-white/[0.07]" /></div></Card>;
}

function ConfirmDialog({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div aria-labelledby="settings-confirm-title" aria-modal="true" className="fixed inset-0 z-[80] grid place-items-center bg-black/65 px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onCancel()} role="dialog">
      <div className="w-full max-w-md rounded-md border border-matrix-border bg-matrix-panel p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-matrix-fg" id="settings-confirm-title">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-matrix-muted">{description}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={onCancel} type="button" variant="secondary">Cancelar</Button><Button disabled={busy} onClick={onConfirm} type="button" variant="danger">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{busy ? "Processando..." : confirmLabel}</Button></div>
      </div>
    </div>
  );
}
