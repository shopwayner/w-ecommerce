import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("publications:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  return NextResponse.json({ id, status: "not_found" }, { status: 404 });
}
