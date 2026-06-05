import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Faturas"
      description="Faturas emitidas, abertas e historico financeiro."
      cards={[
        { title: "Faturas abertas", detail: "Nenhuma fatura emitida localmente.", badge: "0", tone: "muted" },
        { title: "Historico", detail: "Nenhum pagamento registrado.", badge: "Vazio", tone: "muted" }
      ]}
    />
  );
}
