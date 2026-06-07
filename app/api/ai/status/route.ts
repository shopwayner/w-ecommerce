import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { getAIStatus } from "@/lib/services/ai/ai-service";

export async function GET() {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ data: getAIStatus() });
}
