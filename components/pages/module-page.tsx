import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, DataTable, KpiCard, PageHeader } from "@/components/ui";

type ModulePageProps = {
  title: string;
  description: string;
  kpis?: Array<{ label: string; value: string; hint: string; tone?: "success" | "info" | "warning" | "danger" | "purple" }>;
  cards?: Array<{ title: string; detail: string; badge?: string; tone?: "success" | "info" | "warning" | "danger" | "muted" | "purple" }>;
  table?: { title: string; columns: string[]; rows: ReactNode[][] };
};

export function ModulePage({ title, description, kpis = [], cards = [], table }: ModulePageProps) {
  return (
    <AppShell>
      <PageHeader title={title} description={description} />
      {kpis.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>
      ) : null}
      {cards.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {cards.map((card) => (
            <Card key={card.title} className="min-h-28">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-matrix-fg">{card.title}</h3>
                {card.badge ? <Badge tone={card.tone ?? "info"}>{card.badge}</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-matrix-muted">{card.detail}</p>
              <div className="mt-4 h-2 rounded-full bg-matrix-panel2">
                <div className="h-2 w-2/3 rounded-full bg-matrix-gold" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      {table ? (
        <Card className="mt-4">
          <h3 className="mb-3 font-semibold text-matrix-fg">{table.title}</h3>
          <DataTable columns={table.columns} rows={table.rows} />
        </Card>
      ) : null}
    </AppShell>
  );
}
