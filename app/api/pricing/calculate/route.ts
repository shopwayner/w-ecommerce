import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";

export async function POST() {
  const auth = await requireApiAuth("pricing:read");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ suggestedPrice: null, status: "no_product_data" });
}
