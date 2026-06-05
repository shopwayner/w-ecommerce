import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Cobrancas"
      description="Status de cobrancas, tentativas e notificacoes financeiras."
      cards={[
        { title: "Cartao", detail: "Estrutura preparada para processador futuro.", badge: "Preparado", tone: "info" },
        { title: "Boleto", detail: "Cobrancas manuais no roadmap.", badge: "Em breve", tone: "muted" }
      ]}
    />
  );
}
