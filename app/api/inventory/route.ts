import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { loadInventoryListPage } from "@/lib/services/inventory-list-service";

export async function GET(request: Request) {
  const auth = await requireApiAuth("inventory:read");
  if (!auth.ok) return auth.response;

  const result = await loadInventoryListPage(
    auth.context,
    new URL(request.url).searchParams
  );
  return NextResponse.json(result);
}
