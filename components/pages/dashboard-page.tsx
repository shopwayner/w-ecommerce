import { Activity, AlertTriangle, CalendarDays, Database, Package, PlayCircle, RefreshCw, ShoppingCart, SlidersHorizontal, Tags } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";

const icons = [Database, Package, ShoppingCart, AlertTriangle, Database, Tags, Activity, SlidersHorizontal];
const dashboardKpis = [
  { label: "Blings conectados", value: "0", hint: "Nenhuma conexao ativa" },
  { label: "Produtos sincronizados", value: "0", hint: "Nenhum produto sincronizado" },
  { label: "Pedidos importados hoje", value: "0", hint: "Nenhum pedido importado" },
  { label: "Erros de integracao", value: "0", hint: "Sem erros registrados" },
  { label: "Estoques atualizados", value: "0", hint: "Nenhum estoque sincronizado" },
  { label: "Precos atualizados", value: "0", hint: "Nenhum preco sincronizado" },
  { label: "Operacoes do plano", value: "0%", hint: "0 operacoes usadas" },
  { label: "Jobs em fila", value: "0", hint: "Nenhum job na fila" }
];

export function DashboardPage() {
  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description="Visao gerencial da matriz: filiais, sincronizacoes e uso do plano."
        actions={<><Button variant="secondary"><CalendarDays className="h-4 w-4" /> Ultimas 24 horas</Button><Button variant="secondary"><RefreshCw className="h-4 w-4" /></Button></>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {dashboardKpis.map((kpi, index) => {
          const Icon = icons[index] ?? Activity;
          return (
            <Card key={kpi.label} className="min-h-24 p-3">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-matrix-goldSoft/60 text-matrix-goldDark">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-matrix-muted">{kpi.label}</p>
                  <p className="mt-1 text-2xl font-bold text-matrix-fg">{kpi.value}</p>
                  <p className="mt-1 text-xs text-matrix-muted">{kpi.hint}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.75fr)]">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-matrix-fg">Sincronizacoes</h3>
              <p className="text-xs text-matrix-muted">Volume de sincronizacoes nas ultimas 12 horas</p>
            </div>
            <Badge tone="info">2 req/s por conexao</Badge>
          </div>
          <div className="relative h-[22rem] rounded-md border border-matrix-border bg-matrix-panel2/55 p-4 2xl:h-[24rem]">
            <div className="absolute inset-x-4 bottom-10 top-4 grid grid-rows-4">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="border-t border-matrix-border/70" />)}
            </div>
            <div className="relative flex h-full items-center justify-center pb-8">
              <div className="rounded-md border border-dashed border-matrix-border bg-matrix-panel/70 px-5 py-4 text-center">
                <p className="text-sm font-semibold text-matrix-fg">Nenhuma sincronizacao realizada ainda.</p>
                <p className="mt-1 text-xs text-matrix-muted">Conecte o Bling para iniciar a coleta de metricas reais.</p>
              </div>
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-5 text-xs text-matrix-muted">
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-matrix-gold" /> Produtos</span>
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-black dark:bg-white" /> Pedidos</span>
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-matrix-muted" /> Estoques</span>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-matrix-fg">Fila de automacao</h3>
            <Badge tone="muted">Agora</Badge>
          </div>
          <div className="space-y-2">
            <EmptyState title="Nenhum job na fila." description="As automacoes aparecerao aqui quando houver sincronizacoes reais." />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.75fr)_minmax(360px,0.9fr)]">
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-matrix-fg"><PlayCircle className="h-4 w-4 text-matrix-gold" /> Ultimos jobs</h3>
          <DataTable columns={["Tipo", "Origem", "Destino", "Status", "Criado em"]} rows={[]} emptyMessage="Nenhum job executado ainda." />
        </Card>
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-matrix-fg"><AlertTriangle className="h-4 w-4 text-orange-500" /> Problemas recentes</h3>
          <EmptyState title="Sem problemas recentes." description="Alertas reais surgirao quando houver integracoes conectadas." />
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold text-matrix-fg">Performance por filial</h3>
          <DataTable
            columns={["Filial", "Sync", "Sucesso", "Erros"]}
            rows={[]}
            emptyMessage="Nenhuma filial conectada ainda."
          />
        </Card>
      </div>
    </AppShell>
  );
}
