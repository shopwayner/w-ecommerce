import { ProductDetailsPage } from "@/components/pages/product-details-page";
import { normalizeProductReturnTo } from "@/lib/product-details-navigation";

export default async function ProductPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string | string[]; returnTo?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const returnTo = normalizeProductReturnTo(
    typeof query.returnTo === "string" ? query.returnTo : undefined
  );

  return (
    <ProductDetailsPage
      initialMode="edit"
      productId={id}
      returnTo={returnTo}
    />
  );
}
