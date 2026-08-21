import { ProductsPage } from "@/components/pages/products-page";
import { requirePermission } from "@/lib/auth/server";
import {
  buildProductListRequestParams,
  parseProductListFilters
} from "@/lib/product-list-filters";
import { loadProductListPage } from "@/lib/services/product-list-service";

type ProductsSearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(searchParams: ProductsSearchParams) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (value !== undefined) {
      result.set(key, value);
    }
  }
  return result;
}

export default async function Page({
  searchParams
}: {
  searchParams: Promise<ProductsSearchParams>;
}) {
  const authContext = await requirePermission("products:read");
  const requestSearchParams = toUrlSearchParams(await searchParams);
  const initialData = await loadProductListPage(authContext, requestSearchParams);
  const initialRequestKey = buildProductListRequestParams({
    filters: parseProductListFilters(requestSearchParams),
    limit: initialData.pagination.limit,
    page: initialData.pagination.page,
    query: requestSearchParams.get("q") ?? ""
  }).toString();
  const initialReturnTo = `/products${
    requestSearchParams.size ? `?${requestSearchParams.toString()}` : ""
  }`;

  return (
    <ProductsPage
      initialAccountContext={initialData.accountContext}
      initialData={initialData}
      initialRequestKey={initialRequestKey}
      initialReturnTo={initialReturnTo}
      initialSearchQuery={requestSearchParams.get("q") ?? ""}
      initialSession={{
        user: {
          name: authContext.user.name,
          email: authContext.user.email,
          role: authContext.role
        },
        organization: { name: authContext.organization.name }
      }}
    />
  );
}
