import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";

export async function POST() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ status: "prepared" }, { status: 201 });
}
