export const BLING_PRODUCT_IMAGE_LIMIT = 13;

export type BlingProductImageDescriptor = {
  url: string;
  remoteId?: string | null;
  officialName?: string | null;
  contentFingerprint?: string | null;
  width?: number | null;
  height?: number | null;
};

export type BlingProductImageAppendViolation =
  | "REMOTE_GALLERY_INCOMPLETE"
  | "REMOTE_IMAGE_INVALID"
  | "SELECTED_IMAGE_INVALID"
  | "REMOTE_GALLERY_HAS_DUPLICATES"
  | "NO_NEW_IMAGES"
  | "EMPTY_FINAL_GALLERY"
  | "IMAGE_LIMIT_EXCEEDED"
  | "REMOTE_GALLERY_NOT_PRESERVED"
  | "REMOTE_ORDER_NOT_PRESERVED"
  | "REMOTE_PRINCIPAL_NOT_PRESERVED";

export type BlingProductImageAppendPlan = {
  status: "READY" | "UNCHANGED" | "BLOCKED";
  remoteImages: BlingProductImageDescriptor[];
  selectedImages: BlingProductImageDescriptor[];
  newImages: BlingProductImageDescriptor[];
  duplicateImages: BlingProductImageDescriptor[];
  finalImages: BlingProductImageDescriptor[];
  remoteImageCount: number;
  selectedImageCount: number;
  newImageCount: number;
  duplicateImageCount: number;
  finalImageCount: number;
  appendOnly: boolean;
  remoteOrderPreserved: boolean;
  remotePrincipalPreserved: boolean;
  violations: BlingProductImageAppendViolation[];
};

function normalizedIdentity(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function resolutionArea(image: BlingProductImageDescriptor) {
  const width = typeof image.width === "number" && image.width > 0 ? image.width : 0;
  const height = typeof image.height === "number" && image.height > 0 ? image.height : 0;
  return width * height;
}

function isPrivateImageHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (/^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^(fc|fd)/.test(host) || host.startsWith("fe80:");
}

export function normalizeBlingProductAppendImageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 2_000) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
      || isPrivateImageHost(url.hostname)
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function deriveBlingProductImageOfficialName(value: unknown) {
  const normalizedUrl = normalizeBlingProductAppendImageUrl(value);
  if (!normalizedUrl) return null;
  const url = new URL(normalizedUrl);
  if (
    url.hostname !== "mlstatic.com"
    && !url.hostname.endsWith(".mlstatic.com")
  ) {
    return null;
  }
  const fileName = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const match = fileName.match(
    /^(?:D_NQ_NP(?:_\d+X)?_)?(.+?)(?:-[A-Z])?\.(?:avif|jpe?g|png|webp)$/i
  );
  return match?.[1]?.trim() || null;
}

export function normalizeBlingProductImageDescriptor(
  image: BlingProductImageDescriptor
): BlingProductImageDescriptor | null {
  const url = normalizeBlingProductAppendImageUrl(image.url);
  if (!url) return null;
  const officialName =
    image.officialName?.trim() || deriveBlingProductImageOfficialName(url);
  return {
    url,
    ...(image.remoteId?.trim() ? { remoteId: image.remoteId.trim() } : {}),
    ...(officialName ? { officialName } : {}),
    ...(image.contentFingerprint?.trim()
      ? { contentFingerprint: image.contentFingerprint.trim().toLowerCase() }
      : {}),
    ...(typeof image.width === "number" && image.width > 0 ? { width: image.width } : {}),
    ...(typeof image.height === "number" && image.height > 0 ? { height: image.height } : {})
  };
}

export function sameBlingProductImageIdentity(
  left: BlingProductImageDescriptor,
  right: BlingProductImageDescriptor
) {
  if (left.remoteId && right.remoteId && left.remoteId === right.remoteId) return true;
  if (left.url === right.url) return true;
  if (
    left.officialName
    && right.officialName
    && normalizedIdentity(left.officialName) === normalizedIdentity(right.officialName)
  ) {
    return true;
  }
  return Boolean(
    left.contentFingerprint
    && right.contentFingerprint
    && left.contentFingerprint === right.contentFingerprint
  );
}

function sameImageSequence(
  left: readonly BlingProductImageDescriptor[],
  right: readonly BlingProductImageDescriptor[]
) {
  return left.length === right.length
    && left.every((image, index) => Boolean(right[index] && sameBlingProductImageIdentity(image, right[index])));
}

export function createBlingProductImageAppendPlan(input: {
  remoteImages: readonly BlingProductImageDescriptor[];
  selectedImages: readonly BlingProductImageDescriptor[];
  remoteGalleryComplete?: boolean;
  maximumImages?: number;
}): BlingProductImageAppendPlan {
  const maximumImages = input.maximumImages ?? BLING_PRODUCT_IMAGE_LIMIT;
  const violations = new Set<BlingProductImageAppendViolation>();
  const remoteImages: BlingProductImageDescriptor[] = [];
  const selectedImages: BlingProductImageDescriptor[] = [];

  if (input.remoteGalleryComplete === false) {
    violations.add("REMOTE_GALLERY_INCOMPLETE");
  }

  for (const image of input.remoteImages) {
    const normalized = normalizeBlingProductImageDescriptor(image);
    if (!normalized) {
      violations.add("REMOTE_IMAGE_INVALID");
      continue;
    }
    if (remoteImages.some((candidate) => sameBlingProductImageIdentity(candidate, normalized))) {
      violations.add("REMOTE_GALLERY_HAS_DUPLICATES");
    }
    remoteImages.push(normalized);
  }

  for (const image of input.selectedImages) {
    const normalized = normalizeBlingProductImageDescriptor(image);
    if (!normalized) {
      violations.add("SELECTED_IMAGE_INVALID");
      continue;
    }
    selectedImages.push(normalized);
  }

  const newImages: BlingProductImageDescriptor[] = [];
  const duplicateImages: BlingProductImageDescriptor[] = [];
  for (const selected of selectedImages) {
    if (remoteImages.some((remote) => sameBlingProductImageIdentity(remote, selected))) {
      duplicateImages.push(selected);
      continue;
    }
    const duplicateIndex = newImages.findIndex((candidate) => sameBlingProductImageIdentity(candidate, selected));
    if (duplicateIndex >= 0) {
      duplicateImages.push(selected);
      if (resolutionArea(selected) > resolutionArea(newImages[duplicateIndex])) {
        newImages[duplicateIndex] = selected;
      }
      continue;
    }
    newImages.push(selected);
  }

  const finalImages = [...remoteImages, ...newImages];
  const remotePrefix = finalImages.slice(0, remoteImages.length);
  const remoteOrderPreserved = sameImageSequence(remoteImages, remotePrefix);
  const remotePrincipalPreserved = !remoteImages.length
    || Boolean(finalImages[0] && sameBlingProductImageIdentity(remoteImages[0], finalImages[0]));
  const appendOnly = finalImages.length >= remoteImages.length
    && remoteImages.every((image, index) => Boolean(finalImages[index]
      && sameBlingProductImageIdentity(image, finalImages[index])));

  if (!newImages.length) violations.add("NO_NEW_IMAGES");
  if (!finalImages.length) violations.add("EMPTY_FINAL_GALLERY");
  if (finalImages.length > maximumImages) violations.add("IMAGE_LIMIT_EXCEEDED");
  if (!appendOnly) violations.add("REMOTE_GALLERY_NOT_PRESERVED");
  if (!remoteOrderPreserved) violations.add("REMOTE_ORDER_NOT_PRESERVED");
  if (!remotePrincipalPreserved) violations.add("REMOTE_PRINCIPAL_NOT_PRESERVED");

  const blockingViolations = [...violations].filter((violation) => violation !== "NO_NEW_IMAGES");
  return {
    status: blockingViolations.length ? "BLOCKED" : newImages.length ? "READY" : "UNCHANGED",
    remoteImages,
    selectedImages,
    newImages,
    duplicateImages,
    finalImages,
    remoteImageCount: remoteImages.length,
    selectedImageCount: selectedImages.length,
    newImageCount: newImages.length,
    duplicateImageCount: duplicateImages.length,
    finalImageCount: finalImages.length,
    appendOnly,
    remoteOrderPreserved,
    remotePrincipalPreserved,
    violations: [...violations]
  };
}

export function verifyBlingProductImageAppendResult(input: {
  expected: BlingProductImageAppendPlan;
  actualImages: readonly BlingProductImageDescriptor[];
}) {
  const actual = input.actualImages
    .map(normalizeBlingProductImageDescriptor)
    .filter((image): image is BlingProductImageDescriptor => Boolean(image));
  const expected = input.expected.finalImages;
  const duplicates = actual.some((image, index) =>
    actual.slice(0, index).some((candidate) => sameBlingProductImageIdentity(candidate, image))
  );
  return {
    matches: !duplicates && sameImageSequence(expected, actual),
    duplicates,
    remoteImagesPreserved: sameImageSequence(
      input.expected.remoteImages,
      actual.slice(0, input.expected.remoteImages.length)
    ),
    finalCountMatches: actual.length === expected.length
  };
}
