import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Financeiro"
      description="Visao geral financeira do SaaS."
      kpis={[
        { label: "Receita mensal", value: "R$ 0", hint: "Sem faturamento registrado", tone: "success" },
        { label: "Faturas abertas", value: "0", hint: "Nenhuma fatura aberta", tone: "warning" },
        { label: "Inadimplencia", value: "0%", hint: "Sem cobrancas vencidas", tone: "danger" },
        { label: "Uso do plano", value: "0", hint: "Operacoes usadas no ciclo", tone: "purple" }
      ]}
    />
  );
}
