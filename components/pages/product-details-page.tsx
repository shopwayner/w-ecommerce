"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  ProductDetailsView,
  type ProductDetailsProduct
} from "@/components/product-details-view";
import type {
  TopbarAccountContextView,
  TopbarSessionView
} from "@/components/topbar";
import { normalizeProductReturnTo } from "@/lib/product-details-navigation";

export function ProductDetailsPage({
  canEditProduct,
  initialAccountContext,
  initialMode,
  initialProduct,
  initialSession,
  returnTo
}: {
  canEditProduct: boolean;
  initialAccountContext: TopbarAccountContextView;
  initialMode: "edit" | "view";
  initialProduct: ProductDetailsProduct;
  initialSession: TopbarSessionView;
  returnTo?: string;
}) {
  const router = useRouter();
  const backHref = normalizeProductReturnTo(returnTo);
  const [product, setProduct] = useState(initialProduct);

  const goBack = useCallback(() => {
    router.replace(backHref);
  }, [backHref, router]);

  return (
    <AppShell
      initialAccountContext={initialAccountContext}
      initialSession={initialSession}
    >
      <ProductDetailsView
        canEditProduct={canEditProduct}
        initialEditing={initialMode === "edit"}
        onBack={goBack}
        onProductUpdated={setProduct}
        product={product}
      />
    </AppShell>
  );
}
