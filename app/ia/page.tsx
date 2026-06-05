import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="IA"
      description="Recursos inteligentes para catalogo, anuncios e operacao."
      cards={[
        { title: "Geracao de titulos", detail: "Sugestoes otimizadas por canal.", badge: "Preparado", tone: "info" },
        { title: "Descricoes inteligentes", detail: "Texto estruturado para produtos.", badge: "Preparado", tone: "info" },
        { title: "Classificacao automatica", detail: "Categorias e atributos sugeridos.", badge: "Em breve", tone: "muted" },
        { title: "Sugestao de preco", detail: "Apoio para margem e competitividade.", badge: "Preparado", tone: "purple" },
        { title: "Diagnostico de anuncios", detail: "Sinais de qualidade e performance.", badge: "Em breve", tone: "muted" }
      ]}
    />
  );
}
