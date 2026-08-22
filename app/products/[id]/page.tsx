import { notFound } from "next/navigation";
import { ProductDetailsPage } from "@/components/pages/product-details-page";
import { requirePermission } from "@/lib/auth/server";
import { normalizeProductReturnTo } from "@/lib/product-details-navigation";
import {
  isValidProductDetailsId,
  loadProductDetails,
  toProductDetailsInitialProduct
} from "@/lib/services/product-details-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string | string[]; returnTo?: string | string[] }>;
}) {
  const [{ id }, query, authContext] = await Promise.all([
    params,
    searchParams,
    requirePermission("products:read")
  ]);
  if (!isValidProductDetailsId(id)) notFound();

  const result = await loadProductDetails(authContext, id);
  if (!result) notFound();

  const returnTo = normalizeProductReturnTo(
    typeof query.returnTo === "string" ? query.returnTo : undefined
  );

  return (
    <ProductDetailsPage
      canEditProduct={result.permissions.canEdit}
      initialAccountContext={result.accountContext}
      initialMode="edit"
      initialProduct={toProductDetailsInitialProduct(result.data)}
      initialSession={{
        user: {
          name: authContext.user.name,
          email: authContext.user.email,
          role: authContext.role
        },
        organization: { name: authContext.organization.name }
      }}
      returnTo={returnTo}
    />
  );
}
