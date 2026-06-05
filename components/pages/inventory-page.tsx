import { Boxes, FileUp, RefreshCw, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, DataTable, EmptyState, KpiCard, PageHeader } from "@/components/ui";

export function InventoryPage() {
  return (
    <AppShell>
      <PageHeader title="Estoque" description="Saldos fisicos, reservados, seguranca e disponibilidade calculada sem estoque negativo." actions={<><Button><Boxes className="h-4 w-4" /> Ajuste manual</Button><Button variant="secondary"><FileUp className="h-4 w-4" /> Importar saldo</Button><Button variant="secondary"><RefreshCw className="h-4 w-4" /> Sincronizar</Button><Button variant="secondary"><Send className="h-4 w-4" /> Enviar filial</Button></>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-7">
        <KpiCard label="Estoque total" value="0" hint="Nenhum saldo sincronizado" />
        <KpiCard label="Baixo estoque" value="0" hint="Sem alertas" tone="warning" />
        <KpiCard label="Ruptura" value="0" hint="Sem ruptura" tone="danger" />
        <KpiCard label="Movimentacoes" value="0" hint="Nenhuma movimentacao" tone="purple" />
        <KpiCard label="Reservado" value="0" hint="Nenhum pedido aberto" tone="info" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <DataTable columns={["Produto", "SKU", "Bling", "Deposito", "Fisico", "Reservado", "Seguranca", "Disponivel", "Minimo", "Maximo", "Status", "Acoes"]} rows={[]} emptyMessage="Nenhum estoque sincronizado ainda." />
        </Card>
        <Card>
          <h3 className="font-semibold text-white">Reposicao sugerida</h3>
          <div className="mt-4"><EmptyState title="Sem reposicao sugerida." description="Alertas reais surgirao apos sincronizar estoque." /></div>
        </Card>
      </div>
    </AppShell>
  );
}
