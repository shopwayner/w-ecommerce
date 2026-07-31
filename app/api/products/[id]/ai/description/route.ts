import { requireApiAuth } from "@/lib/auth/api";
import { createProductDescriptionAiPost } from "@/lib/services/openai-product-description-route";

const postProductDescriptionAi = createProductDescriptionAiPost({
  authenticate: () => requireApiAuth("products:write")
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return postProductDescriptionAi(request, context);
}
