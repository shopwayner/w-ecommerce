import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";

export async function GET() {
  const auth = await requireApiAuth("reports:read");
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    kpis: [
      { label: "Receita sincronizada", value: "R$ 0", hint: "Sem dados para o periodo", tone: "info" },
      { label: "Produtos top", value: "0", hint: "Nenhum produto vendido", tone: "info" },
      { label: "Falhas", value: "0", hint: "Sem falhas registradas", tone: "success" },
      { label: "Exportacoes", value: "0", hint: "Nenhuma exportacao", tone: "purple" }
    ],
    topProducts: [],
    topErrors: []
  });
}
