import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAuth("dashboard:read");
  if (!auth.ok) return auth.response;

  const [connections, products, orders, failedJobs, inventory, priceUpdates, pendingJobs, usage, subscription] = await Promise.all([
    prisma.blingConnection.count({ where: { organizationId: auth.context.organizationId } }),
    prisma.product.count({ where: { organizationId: auth.context.organizationId } }),
    prisma.order.count({ where: { organizationId: auth.context.organizationId } }),
    prisma.syncJob.count({ where: { organizationId: auth.context.organizationId, status: "FAILED" } }),
    prisma.inventoryBalance.count({ where: { organizationId: auth.context.organizationId } }),
    prisma.productPriceHistory.count({ where: { organizationId: auth.context.organizationId } }),
    prisma.syncJob.count({ where: { organizationId: auth.context.organizationId, status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.usageCounter.findMany({ where: { organizationId: auth.context.organizationId } }),
    prisma.subscription.findUnique({ where: { organizationId: auth.context.organizationId }, include: { plan: true } })
  ]);
  const operations = usage.reduce((total, item) => total + item.value, 0);
  const operationLimit = subscription?.plan.maxMonthlyOperations ?? 0;

  return NextResponse.json({
    kpis: [
      { label: "Blings conectados", value: String(connections), hint: "Conexoes reais cadastradas", tone: "info" },
      { label: "Produtos sincronizados", value: String(products), hint: "Produtos reais no catalogo", tone: "info" },
      { label: "Pedidos importados hoje", value: String(orders), hint: "Pedidos reais importados", tone: "purple" },
      { label: "Erros de integracao", value: String(failedJobs), hint: "Falhas reais registradas", tone: failedJobs ? "danger" : "success" },
      { label: "Estoques atualizados", value: String(inventory), hint: "Saldos reais sincronizados", tone: "info" },
      { label: "Precos atualizados", value: String(priceUpdates), hint: "Historico real de precos", tone: "info" },
      { label: "Operacoes do plano", value: operationLimit ? `${Math.round((operations / operationLimit) * 100)}%` : "0%", hint: `${operations}/${operationLimit}`, tone: "warning" },
      { label: "Jobs em fila", value: String(pendingJobs), hint: "Jobs reais pendentes", tone: "purple" }
    ],
    chart: Array.from({ length: 12 }, () => 0)
  });
}
