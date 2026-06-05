import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="ERPS"
      description="Conectores ERP disponiveis e planejados."
      cards={[
        { title: "Bling", detail: "OAuth seguro preparado na Etapa 3.", badge: "Principal", tone: "success" },
        { title: "Tiny", detail: "Conector planejado.", badge: "Em breve", tone: "muted" },
        { title: "Omie", detail: "ERP financeiro e operacional.", badge: "Em breve", tone: "muted" },
        { title: "Conta Azul", detail: "Financeiro e faturamento.", badge: "Em breve", tone: "muted" },
        { title: "API personalizada", detail: "Webhooks e endpoints customizados.", badge: "Preparado", tone: "info" }
      ]}
    />
  );
}
