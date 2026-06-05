import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Clientes"
      description="Gerencie clientes, empresas e contas vinculadas ao SaaS."
      kpis={[
        { label: "Clientes ativos", value: "0", hint: "Nenhum cliente cadastrado", tone: "success" },
        { label: "Novos clientes", value: "0", hint: "Sem entradas recentes", tone: "info" },
        { label: "Em atencao", value: "0", hint: "Sem pendencias operacionais", tone: "warning" },
        { label: "Plano empresarial", value: "0", hint: "Nenhum cliente externo", tone: "purple" }
      ]}
    />
  );
}
