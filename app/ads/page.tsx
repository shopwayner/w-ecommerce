import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Anuncios"
      description="Gerencie anuncios, canais, status de publicacao e performance."
      cards={[
        { title: "Publicados", detail: "Nenhum anuncio publicado ainda.", badge: "0", tone: "muted" },
        { title: "Em revisao", detail: "Nenhum item aguardando ajuste.", badge: "0", tone: "muted" },
        { title: "Pausados", detail: "Nenhuma campanha pausada.", badge: "0", tone: "muted" },
        { title: "Performance", detail: "Sem dados de performance no periodo.", badge: "Vazio", tone: "purple" }
      ]}
    />
  );
}
