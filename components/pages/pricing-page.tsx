import { AppShell } from "@/components/app-shell";
import { Button, Card, DataTable, KpiCard, PageHeader } from "@/components/ui";

export function PricingPage() {
  return (
    <AppShell>
      <PageHeader title="Precificacao" description="Calculo de markup, margem e envio de precos para conexoes Bling." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <KpiCard label="Margem media" value="0%" hint="Sem catalogo ativo" tone="success" />
        <KpiCard label="Sem preco" value="0" hint="Nenhum produto cadastrado" tone="danger" />
        <KpiCard label="Atualizados" value="0" hint="Nenhuma atualizacao" />
        <KpiCard label="Sugestoes" value="0" hint="Sem sugestoes" tone="purple" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card>
          <DataTable columns={["Produto", "SKU", "Custo", "Taxas", "Frete", "Comissao", "Markup", "Sugerido", "Atual", "Margem", "Status", "Acoes"]} rows={[]} emptyMessage="Nenhum preco calculado ainda." />
        </Card>
        <Card>
          <h3 className="font-semibold text-white">Calculadora</h3>
          <div className="mt-4 grid gap-3">
            {["Custo", "Despesa operacional", "Taxa marketplace", "Comissao", "Frete", "Lucro desejado"].map((field) => (
              <input key={field} placeholder={field} className="rounded-md border border-matrix-border bg-white/[0.03] px-3 py-2 text-sm outline-none" />
            ))}
            <Button>Aplicar preco</Button>
            <Button variant="secondary">Enviar para Bling</Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
