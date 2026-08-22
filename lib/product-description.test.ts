import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeProductDescriptionForStorage,
  productDescriptionHasVisibleContent,
  sanitizeProductDescription
} from "./product-description";
import {
  buildProductDetailsPatch,
  createProductDetailsEditForm
} from "./product-details-edit";

const editorSource = readFileSync(
  new URL("../components/product-description-editor.tsx", import.meta.url),
  "utf8"
);
const detailsSource = readFileSync(
  new URL("../components/product-details-view.tsx", import.meta.url),
  "utf8"
);
const routeSource = readFileSync(
  new URL("../app/api/products/[id]/route.ts", import.meta.url),
  "utf8"
);

test("keeps an old plain-text description compatible", () => {
  assert.equal(sanitizeProductDescription("Descricao antiga simples."), "Descricao antiga simples.");
});

test("preserves multiple paragraphs and line breaks", () => {
  assert.equal(
    sanitizeProductDescription("Primeiro paragrafo.\n\nSegundo paragrafo."),
    "Primeiro paragrafo.\n\nSegundo paragrafo."
  );
});

test("preserves an explicit blank line created by the editor", () => {
  const result = sanitizeProductDescription("<div>Primeiro</div><div><br></div><div>Terceiro</div>");
  assert.match(result, /<p>Primeiro<\/p><p><br\s*\/?><\/p><p>Terceiro<\/p>/);
});

test("does not collapse meaningful repeated spaces", () => {
  assert.equal(sanitizeProductDescription("Medida:  10 cm"), "Medida:  10 cm");
});

test("preserves special characters as safe text", () => {
  assert.equal(
    sanitizeProductDescription("A & B < 10 > 2"),
    "A &amp; B &lt; 10 &gt; 2"
  );
});

test("keeps a long description without truncation", () => {
  const description = "Descricao longa.\n".repeat(600).trim();
  assert.equal(sanitizeProductDescription(description), description);
});

test("accepts restricted HTML pasted from Bling", () => {
  assert.equal(
    sanitizeProductDescription("<p>Descricao do Bling</p><ul><li>Item 1</li></ul>"),
    "<p>Descricao do Bling</p><ul><li>Item 1</li></ul>"
  );
});

test("normalizes legacy block and emphasis tags without destroying content", () => {
  assert.equal(
    sanitizeProductDescription("<div><b>Forte</b> e <i>leve</i></div>"),
    "<p><strong>Forte</strong> e <em>leve</em></p>"
  );
});

test("treats an empty description as empty", () => {
  assert.equal(sanitizeProductDescription(null), "");
  assert.equal(normalizeProductDescriptionForStorage(""), null);
});

test("treats whitespace-only content as empty", () => {
  assert.equal(productDescriptionHasVisibleContent("  \n  "), false);
  assert.equal(normalizeProductDescriptionForStorage("<p><br></p>"), null);
});

test("keeps bold, italic and underline in the restricted format", () => {
  assert.equal(
    sanitizeProductDescription("<strong>Negrito</strong> <em>Italico</em> <u>Sublinhado</u>"),
    "<strong>Negrito</strong> <em>Italico</em> <u>Sublinhado</u>"
  );
});

test("removes scripts, styles and embedded active content", () => {
  const result = sanitizeProductDescription(
    "<script>alert(1)</script><style>body{display:none}</style><iframe src='x'></iframe><p>Seguro</p>"
  );
  assert.equal(result, "<p>Seguro</p>");
});

test("removes event handlers, styles and arbitrary attributes", () => {
  assert.equal(
    sanitizeProductDescription("<p class='x' style='color:red' onclick='bad()'><strong id='y'>Seguro</strong></p>"),
    "<p><strong>Seguro</strong></p>"
  );
});

test("discards unsupported tags without showing them as raw text", () => {
  assert.equal(sanitizeProductDescription("<custom>Conteudo</custom>"), "Conteudo");
});

test("normalizes CRLF without removing blank lines", () => {
  assert.equal(sanitizeProductDescription("Um\r\n\r\nDois"), "Um\n\nDois");
});

test("normalizes a simple marked paragraph list as one compact list", () => {
  assert.equal(
    sanitizeProductDescription("<p>\u2022 Marca: Andaluz</p><p>\u2022 Material: PVC</p>"),
    "<ul><li>Marca: Andaluz</li><li>Material: PVC</li></ul>"
  );
});

test("normalizes a long list without adding paragraphs between items", () => {
  const input = Array.from(
    { length: 12 },
    (_, index) => `<p>- Item ${index + 1}</p>`
  ).join("");
  const result = sanitizeProductDescription(input);

  assert.equal(result.match(/<li>/g)?.length, 12);
  assert.doesNotMatch(result, /<\/li>\s*<p>/);
});

test("keeps a paragraph after a compact list", () => {
  assert.equal(
    sanitizeProductDescription("<p>* Item A</p><p>* Item B</p><p>Observacao final.</p>"),
    "<ul><li>Item A</li><li>Item B</li></ul><p>Observacao final.</p>"
  );
});

test("keeps a paragraph before a compact list", () => {
  assert.equal(
    sanitizeProductDescription("<p>Ficha Tecnica:</p><p>\u2022 Marca: Andaluz</p><p>\u2022 Material: PVC</p>"),
    "<p>Ficha Tecnica:</p><ul><li>Marca: Andaluz</li><li>Material: PVC</li></ul>"
  );
});

test("keeps two lists separated by a title", () => {
  assert.equal(
    sanitizeProductDescription(
      "<p>\u2022 Marca: Andaluz</p><p>\u2022 Material: PVC</p><p>Aplicacoes:</p><p>- Uso residencial</p><p>* Uso industrial</p>"
    ),
    "<ul><li>Marca: Andaluz</li><li>Material: PVC</li></ul><p>Aplicacoes:</p><ul><li>Uso residencial</li><li>Uso industrial</li></ul>"
  );
});

test("compacts a list pasted from Bling block elements", () => {
  assert.equal(
    sanitizeProductDescription(
      "<div>\u2022 Marca: Andaluz</div><div>\u2022 Modelo: Abracadeira</div><div>\u2022 Material: PVC</div>"
    ),
    "<ul><li>Marca: Andaluz</li><li>Modelo: Abracadeira</li><li>Material: PVC</li></ul>"
  );
});

test("preserves inline bold content inside compact list items", () => {
  assert.equal(
    sanitizeProductDescription(
      "<p>\u2022 <strong>Marca:</strong> Andaluz</p><p>\u2022 <strong>Material:</strong> PVC</p>"
    ),
    "<ul><li><strong>Marca:</strong> Andaluz</li><li><strong>Material:</strong> PVC</li></ul>"
  );
});

test("preserves real blank lines between list sections", () => {
  assert.equal(
    sanitizeProductDescription(
      "<p>Ficha Tecnica:</p><p>\u2022 Marca: Andaluz</p><p>\u2022 Material: PVC</p><p><br></p><p>Aplicacoes:</p><p>\u2022 Uso residencial</p><p>\u2022 Uso industrial</p>"
    ),
    "<p>Ficha Tecnica:</p><ul><li>Marca: Andaluz</li><li>Material: PVC</li></ul><p><br /></p><p>Aplicacoes:</p><ul><li>Uso residencial</li><li>Uso industrial</li></ul>"
  );
});

test("does not merge ordinary consecutive paragraphs", () => {
  assert.equal(
    sanitizeProductDescription("<p>Primeiro paragrafo.</p><p>Segundo paragrafo.</p>"),
    "<p>Primeiro paragrafo.</p><p>Segundo paragrafo.</p>"
  );
});

test("builds a local description patch with formatted content", () => {
  const baseline = createProductDetailsEditForm({ name: "Produto", description: "Texto" });
  assert.deepEqual(buildProductDetailsPatch(baseline, {
    ...baseline,
    description: "<p><strong>Texto formatado</strong></p>"
  }), {
    payload: { description: "<p><strong>Texto formatado</strong></p>" }
  });
});

test("the backend sanitizes the description before persistence", () => {
  assert.match(routeSource, /normalizeProductDescriptionForStorage\(parsed\.data\.description\)/);
  assert.match(routeSource, /productData\.description = description/);
});

test("the local description PATCH remains tenant-scoped and fail-closed", () => {
  const patchSource = routeSource.slice(routeSource.indexOf("export async function PATCH"));
  assert.match(
    patchSource,
    /where:\s*\{\s*id,\s*organizationId:\s*auth\.context\.organizationId\s*\}/
  );
  assert.match(patchSource, /Produto nao encontrado[\s\S]*status:\s*404/);
  assert.doesNotMatch(patchSource, /bling\/full-sync|openai|ErpSyncJob|SyncJob/);
});

test("the edit toolbar exposes compact B, I and U controls", () => {
  assert.match(editorSource, /command: "bold", label: "B"/);
  assert.match(editorSource, /command: "italic", label: "I"/);
  assert.match(editorSource, /command: "underline", label: "U"/);
  assert.match(editorSource, /role="toolbar"/);
});

test("Ctrl+B, Ctrl+I and Ctrl+U use the same formatting commands", () => {
  assert.match(editorSource, /b: "bold", i: "italic", u: "underline"/);
  assert.match(editorSource, /event\.preventDefault\(\)/);
  assert.match(editorSource, /document\.execCommand\(command, false\)/);
});

test("toolbar interaction preserves and restores the editor selection", () => {
  assert.match(editorSource, /savedRangeRef/);
  assert.match(editorSource, /range\.cloneRange\(\)/);
  assert.match(editorSource, /restoreSelection\(\)/);
  assert.match(editorSource, /onMouseDown=\{preserveSelectionOnToolbar\}/);
});

test("paste is converted to safe plain text while retaining line breaks", () => {
  assert.match(editorSource, /getData\("text\/plain"\)/);
  assert.match(editorSource, /document\.execCommand\("insertText", false, text\)/);
});

test("native undo and redo remain available without rewriting the editor on input", () => {
  assert.doesNotMatch(editorSource, /(?:z|y):\s*"(?:undo|redo)"/);
  assert.equal(editorSource.match(/\.innerHTML\s*=/g)?.length, 1);
  assert.match(editorSource, /onInput=\{\(\) => \{\s*emitDraft\(\);/);
});

test("expanding the description does not reset the draft or move the cursor", () => {
  assert.match(editorSource, /\}, \[initialValue, resetKey\]\);/);
  assert.doesNotMatch(editorSource, /\[initialValue, resetKey, expanded\]/);
  assert.doesNotMatch(editorSource, /key=\{expanded/);
});

test("Expandir and Recolher remain available in view and edit modes", () => {
  assert.match(detailsSource, /aria-expanded=\{isDescriptionExpanded\}/);
  assert.match(detailsSource, /setIsDescriptionExpanded/);
  assert.match(detailsSource, /<DeferredProductDescriptionEditor[\s\S]*expanded=\{isDescriptionExpanded\}/);
  assert.match(detailsSource, /isDescriptionExpanded \? "h-\[70vh\] min-h-80"/);
});

test("editing, saving and cancelling do not reset the expanded state", () => {
  assert.doesNotMatch(detailsSource, /setIsDescriptionExpanded\(false\)/);
  assert.match(detailsSource, /const \[isDescriptionExpanded, setIsDescriptionExpanded\] = useState\(false\)/);
});

test("Cancel restores the saved description snapshot", () => {
  const cancelBlock = detailsSource.slice(
    detailsSource.indexOf("const cancelEdit"),
    detailsSource.indexOf("function buildPayload")
  );
  assert.match(cancelBlock, /formFromProduct\(currentProduct\)/);
  assert.match(cancelBlock, /descriptionDraftRef\.current = nextForm\.description/);
  assert.match(cancelBlock, /setDescriptionEditorResetKey/);
});

test("Save uses the latest editor value through only the local product PATCH", () => {
  const saveBlock = detailsSource.slice(
    detailsSource.indexOf("function buildPayload"),
    detailsSource.indexOf("return (", detailsSource.indexOf("function buildPayload"))
  );
  assert.match(saveBlock, /description: descriptionDraftRef\.current/);
  assert.match(saveBlock, /fetch\(`\/api\/products\/\$\{currentProduct\.id\}`/);
  assert.match(saveBlock, /method: "PATCH"/);
  assert.doesNotMatch(saveBlock, /bling\/full-sync|openai|\/ai\//i);
});

test("the editor and viewer use responsive internal scrolling without horizontal overflow", () => {
  assert.match(editorSource, /min-w-0/);
  assert.match(editorSource, /overflow-y-auto/);
  assert.match(editorSource, /break-words/);
  assert.match(detailsSource, /matrix-scroll mt-3 overflow-y-auto whitespace-pre-wrap break-words/);
});
