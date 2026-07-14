import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { intelligentProductPreviewApplySchema } from "@/lib/intelligent-product-preview-schema";
import { applyIntelligentProductRegistration } from "@/lib/services/intelligent-product-registration-service";

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const parsed = intelligentProductPreviewApplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nao foi possivel salvar o produto agora." }, { status: 400 });
  }

  const result = await applyIntelligentProductRegistration({
    authContext: auth.context,
    productId: parsed.data.productId,
    fields: parsed.data.fields,
    request
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Nao foi possivel salvar o produto agora." }, { status: result.status });
  }

  return NextResponse.json({
    productId: result.data.productId,
    changedFields: result.data.changedFields
  });
}
