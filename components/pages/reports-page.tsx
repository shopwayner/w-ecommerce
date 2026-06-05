import { AppShell } from "@/components/app-shell";
import { Card, DataTable, KpiCard, PageHeader } from "@/components/ui";

const reportKpis = [
  { label: "Receita sincronizada", value: "R$ 0", hint: "Sem dados para o periodo", tone: "info" as const },
  { label: "Produtos top", value: "0", hint: "Nenhum produto vendido", tone: "info" as const },
  { label: "Falhas", value: "0", hint: "Sem falhas registradas", tone: "success" as const },
  { label: "Exportacoes", value: "0", hint: "Nenhuma exportacao", tone: "purple" as const }
];

export function ReportsPage() {
  return (
    <AppShell>
      <PageHeader title="Relatorios" description="KPIs, filtros, graficos, top produtos, top erros e historico de sincronizacoes." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        {reportKpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold text-white">Top produtos</h3>
          <DataTable columns={["Produto", "SKU", "Vendas", "Margem"]} rows={[]} emptyMessage="Sem dados para o periodo." />
        </Card>
        <Card>
          <h3 className="mb-4 font-semibold text-white">Top erros</h3>
          <DataTable columns={["Erro", "Origem", "Status"]} rows={[]} emptyMessage="Sem dados para o periodo." />
        </Card>
      </div>
    </AppShell>
  );
}
