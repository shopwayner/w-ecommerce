import { Download, Plus, RefreshCw, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, DataTable, EmptyState, KpiCard, PageHeader } from "@/components/ui";

export function OrdersPage() {
  return (
    <AppShell>
      <PageHeader title="Pedidos" description="Importacao, criacao manual, envio para Bling e acompanhamento de status." actions={<><Button variant="secondary"><RefreshCw className="h-4 w-4" /> Atualizar pedidos</Button><Button><Plus className="h-4 w-4" /> Criar pedido</Button><Button variant="secondary"><Send className="h-4 w-4" /> Enviar para Bling</Button><Button variant="secondary"><Download className="h-4 w-4" /> Exportar</Button></>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-8">
        <KpiCard label="Pedidos hoje" value="0" hint="Nenhum pedido importado" />
        <KpiCard label="Faturamento" value="R$ 0" hint="Sem pedidos no periodo" tone="success" />
        <KpiCard label="Em separacao" value="0" hint="Operacao vazia" tone="warning" />
        <KpiCard label="Enviados" value="0" hint="Nenhum envio" tone="info" />
        <KpiCard label="Cancelados" value="0" hint="Sem cancelamentos" tone="danger" />
        <KpiCard label="Aguardando pagamento" value="0" hint="Sem pendencias" tone="purple" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <DataTable columns={["Pedido", "Cliente", "Bling", "Canal", "Itens", "Valor", "Pagamento", "Envio", "Status", "Data", "Acoes"]} rows={[]} emptyMessage="Nenhum pedido importado ainda." />
        </Card>
        <Card>
          <h3 className="font-semibold text-white">Painel lateral</h3>
          <div className="mt-4 space-y-3">
            <EmptyState title="Sem atividade de pedidos." description="A timeline sera preenchida quando pedidos reais forem importados." />
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
