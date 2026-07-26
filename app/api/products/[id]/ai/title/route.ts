import { requireApiAuth } from "@/lib/auth/api";
import { createProductTitleAiPost } from "@/lib/services/openai-product-title-route";

const postProductTitleAi = createProductTitleAiPost({
  authenticate: () => requireApiAuth("products:write")
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return postProductTitleAi(request, context);
}
