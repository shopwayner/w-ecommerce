import type {
  BlingFullProductSyncPreview,
  BlingFullProductSyncResult
} from "@/lib/services/bling-full-product-sync-service";

export async function runBlingFullProductSyncFromEditor<T>(input: {
  currentProduct: T;
  hasLocalChanges: boolean;
  saveLocal: () => Promise<T>;
  preview: (savedProduct: T) => Promise<BlingFullProductSyncPreview>;
  confirm: (
    savedProduct: T,
    preview: BlingFullProductSyncPreview
  ) => Promise<BlingFullProductSyncResult>;
}) {
  const savedProduct = input.hasLocalChanges
    ? await input.saveLocal()
    : input.currentProduct;
  const preview = await input.preview(savedProduct);
  if (preview.blockers.length) throw new Error(preview.blockers[0]);
  const result = await input.confirm(savedProduct, preview);
  return { savedProduct, preview, result };
}
