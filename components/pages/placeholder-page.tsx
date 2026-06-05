import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader } from "@/components/ui";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <AppShell>
      <PageHeader title={title} description="Modulo reservado na fundacao. A tela operacional sera detalhada nas proximas etapas." />
      <Card>
        <Badge tone="purple">Roadmap</Badge>
        <p className="mt-4 text-sm text-slate-400">Estrutura de navegacao pronta, sem expor dados sensiveis no frontend.</p>
      </Card>
    </AppShell>
  );
}
