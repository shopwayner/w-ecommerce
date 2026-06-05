import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, signSession } from "@/lib/auth/token";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "E-mail ou senha invalidos." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: {
      organizationUsers: {
        include: { organization: true },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  const membership = user?.organizationUsers.find((item) => item.organization.status === "ACTIVE");
  const passwordHash = user?.passwordHash;

  if (!user || user.status !== "ACTIVE" || !membership || !passwordHash) {
    return NextResponse.json({ error: "E-mail ou senha invalidos." }, { status: 401 });
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: "E-mail ou senha invalidos." }, { status: 401 });
  }

  const token = await signSession({
    userId: user.id,
    organizationId: membership.organizationId,
    role: membership.role
  });

  const response = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: membership.role },
    organization: { id: membership.organization.id, name: membership.organization.name, slug: membership.organization.slug }
  });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });

  return response;
}
