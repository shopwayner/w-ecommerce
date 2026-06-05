import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Marketplaces"
      description="Canais de venda preparados para publicacao e pedidos."
      cards={[
        { title: "Mercado Livre", detail: "Publicacao e pedidos marketplace.", badge: "Em breve", tone: "muted" },
        { title: "Shopee", detail: "Catalogo e pedidos.", badge: "Em breve", tone: "muted" },
        { title: "Amazon", detail: "Catalogo e fulfillment.", badge: "Em breve", tone: "muted" },
        { title: "Magalu", detail: "Marketplace nacional.", badge: "Em breve", tone: "muted" },
        { title: "Olist", detail: "Hub de canais em preparacao.", badge: "Preparado", tone: "info" }
      ]}
    />
  );
}
