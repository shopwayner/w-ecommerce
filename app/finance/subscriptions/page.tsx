import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Assinaturas"
      description="Controle assinaturas, planos e ciclos de renovacao."
      cards={[
        { title: "Plano atual", detail: "Assinatura local da organizacao master preservada.", badge: "Ativa", tone: "success" },
        { title: "Usuarios permitidos", detail: "Limite definido pelo plano atual.", badge: "Configurado", tone: "purple" }
      ]}
    />
  );
}
