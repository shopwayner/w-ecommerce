import sanitizeHtml from "sanitize-html";

export const PRODUCT_DESCRIPTION_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "ul",
  "ol",
  "li"
] as const;

const productDescriptionSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [...PRODUCT_DESCRIPTION_ALLOWED_TAGS],
  allowedAttributes: {},
  allowedSchemes: [],
  disallowedTagsMode: "discard",
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  transformTags: {
    b: "strong",
    i: "em",
    div: "p",
    section: "p",
    article: "p",
    h1: "p",
    h2: "p",
    h3: "p",
    h4: "p",
    h5: "p",
    h6: "p"
  }
};

const markedParagraphSequencePattern =
  /(?:<p>\s*[\u2022*-](?:\s|&nbsp;)+[\s\S]*?<\/p>\s*)+/g;
const markedParagraphPattern =
  /<p>\s*[\u2022*-](?:\s|&nbsp;)+([\s\S]*?)<\/p>/g;

function normalizeMarkedParagraphLists(value: string) {
  return value.replace(markedParagraphSequencePattern, (sequence) => {
    const items = Array.from(sequence.matchAll(markedParagraphPattern), ([, item]) => item.trim());
    return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
  });
}

export function sanitizeProductDescription(value: string | null | undefined) {
  if (!value) return "";
  const sanitized = sanitizeHtml(
    value.replace(/\r\n?/g, "\n"),
    productDescriptionSanitizeOptions
  ).trim();
  return normalizeMarkedParagraphLists(sanitized);
}

export function productDescriptionHasVisibleContent(value: string | null | undefined) {
  const sanitized = sanitizeProductDescription(value);
  if (!sanitized) return false;
  const text = sanitizeHtml(sanitized, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard"
  })
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\u200b/g, "")
    .trim();
  return Boolean(text);
}

export function normalizeProductDescriptionForStorage(
  value: string | null | undefined
) {
  const sanitized = sanitizeProductDescription(value);
  return productDescriptionHasVisibleContent(sanitized) ? sanitized : null;
}
