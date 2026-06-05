import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Fila de Jobs"
      description="Acompanhe jobs operacionais preparados para sincronizacoes futuras."
      table={{ title: "Jobs recentes", columns: ["Tipo", "Origem", "Destino", "Status", "Tentativas", "Data"], rows: [] }}
    />
  );
}
