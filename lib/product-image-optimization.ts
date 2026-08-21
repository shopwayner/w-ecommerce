import productImageHosts from "@/lib/product-image-hosts.json";

const optimizableProductImageHosts = new Set(
  productImageHosts.map((hostname) => hostname.toLowerCase())
);

export function isOptimizableProductImageUrl(value: string | null | undefined) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && optimizableProductImageHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
