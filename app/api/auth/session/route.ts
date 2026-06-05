import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    user: {
      id: auth.context.user.id,
      name: auth.context.user.name,
      email: auth.context.user.email,
      role: auth.context.role,
      status: auth.context.user.status
    },
    organization: {
      id: auth.context.organization.id,
      name: auth.context.organization.name,
      slug: auth.context.organization.slug,
      status: auth.context.organization.status
    }
  });
}
