"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  ProductDetailsView,
  type ProductDetailsProduct
} from "@/components/product-details-view";
import { Button } from "@/components/ui";
import { normalizeProductReturnTo } from "@/lib/product-details-navigation";

type ProductDetailsResponse = {
  data?: ProductDetailsProduct;
  error?: string;
  permissions?: { canEdit?: boolean };
};

export function ProductDetailsPage({
  initialMode,
  productId,
  returnTo
}: {
  initialMode: "edit" | "view";
  productId: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const backHref = normalizeProductReturnTo(returnTo);
  const [product, setProduct] = useState<ProductDetailsProduct | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    router.replace(backHref);
  }, [backHref, router]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProduct() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/products/${encodeURIComponent(productId)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as ProductDetailsResponse;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Nao foi possivel carregar o produto.");
        }
        setProduct(payload.data);
        setCanEdit(payload.permissions?.canEdit === true);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar o produto.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadProduct();
    return () => controller.abort();
  }, [productId]);

  return (
    <AppShell>
      {loading ? (
        <section
          aria-busy="true"
          className="grid min-h-[calc(100dvh-7rem)] w-full min-w-0 max-w-none place-items-center rounded-xl border border-matrix-border bg-matrix-panel p-6 text-matrix-muted"
        >
          Carregando produto...
        </section>
      ) : error || !product ? (
        <section className="mx-auto min-h-[18rem] w-full max-w-3xl rounded-xl border border-red-500/25 bg-matrix-panel p-6">
          <div className="flex items-start gap-3 text-red-400">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h1 className="text-lg font-bold">Produto indisponivel</h1>
              <p className="mt-2 text-sm text-matrix-muted">{error ?? "Produto nao encontrado."}</p>
            </div>
          </div>
          <Button className="mt-6" onClick={goBack} type="button" variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Voltar para produtos
          </Button>
        </section>
      ) : (
        <ProductDetailsView
          canEditProduct={canEdit}
          initialEditing={initialMode === "edit"}
          onBack={goBack}
          onProductUpdated={setProduct}
          product={product}
        />
      )}
    </AppShell>
  );
}
