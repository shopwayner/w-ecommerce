import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Logs de Sincronizacao"
      description="Eventos sanitizados de sincronizacao e auditoria."
      table={{ title: "Logs recentes", columns: ["Acao", "Modulo", "Status", "Usuario", "Data"], rows: [] }}
    />
  );
}
