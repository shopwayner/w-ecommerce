import { ModulePage } from "@/components/pages/module-page";

export default function Page() {
  return (
    <ModulePage
      title="Operacoes"
      description="Central de rotinas, filas, logs e automacoes operacionais."
      cards={[
        { title: "Central Matrix", detail: "Nenhum Bling conectado ainda.", badge: "Vazio", tone: "muted" },
        { title: "Automacoes", detail: "Nenhuma automacao executada ainda.", badge: "0", tone: "muted" },
        { title: "Publicacoes", detail: "Nenhum job na fila.", badge: "0", tone: "muted" },
        { title: "Logs", detail: "Eventos sanitizados de sincronizacao e auditoria.", badge: "Seguro", tone: "success" }
      ]}
    />
  );
}
