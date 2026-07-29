const productsPath = "/products";
const maxReturnToLength = 4096;
const encodedControlCharacter = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const rawControlCharacter = /[\u0000-\u001f\u007f]/;

export function normalizeProductReturnTo(value: string | null | undefined) {
  if (
    !value
    || value.length > maxReturnToLength
    || !value.startsWith("/")
    || value.startsWith("//")
    || rawControlCharacter.test(value)
    || encodedControlCharacter.test(value)
  ) {
    return productsPath;
  }

  try {
    const parsed = new URL(value, "https://matrix.local");
    if (
      parsed.origin !== "https://matrix.local"
      || parsed.pathname !== productsPath
      || parsed.hash
    ) {
      return productsPath;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return productsPath;
  }
}

export function buildProductDetailsHref(productId: string, returnTo: string) {
  const normalizedReturnTo = normalizeProductReturnTo(returnTo);
  return `/products/${encodeURIComponent(productId)}?returnTo=${encodeURIComponent(normalizedReturnTo)}`;
}

export function productListScrollStorageKey(returnTo: string) {
  return `matrix-products-scroll:${normalizeProductReturnTo(returnTo)}`;
}
