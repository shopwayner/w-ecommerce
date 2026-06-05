import { AppShell } from "@/components/app-shell";
import { Card, DataTable, PageHeader } from "@/components/ui";

export function PublicationsPage() {
  return (
    <AppShell>
      <PageHeader title="Publicacoes" description="Fila de publicacao e sincronizacao para produtos, precos, estoque, imagens e pedidos." />
      <Card>
        <DataTable columns={["Tipo", "Origem", "Destino", "Status", "Tentativas", "Ultimo erro", "Criado em", "Processado em", "Acoes"]} rows={[]} emptyMessage="Nenhum job na fila." />
      </Card>
    </AppShell>
  );
}
