import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  blingProductSyncCategories,
  type BlingProductSyncReportFilter
} from "@/lib/bling-product-sync-report";
import { getBlingSyncReportPage } from "@/lib/services/notification-service";

type Params = {
  params: Promise<{ jobId: string }>;
};

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function reportFilter(value: string | null): BlingProductSyncReportFilter {
  if (value === "FAILURES") return value;
  if (blingProductSyncCategories.includes(value as (typeof blingProductSyncCategories)[number])) {
    return value as BlingProductSyncReportFilter;
  }
  return "ALL";
}

export async function GET(request: Request, { params }: Params) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const { jobId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const result = await getBlingSyncReportPage({
    organizationId: auth.context.organizationId,
    jobId,
    page: positiveInteger(searchParams.get("page"), 1),
    pageSize: positiveInteger(searchParams.get("pageSize"), 20),
    filter: reportFilter(searchParams.get("category"))
  });
  if (!result) {
    return NextResponse.json({ error: "Relatorio nao encontrado." }, { status: 404 });
  }
  return NextResponse.json(result);
}
