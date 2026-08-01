import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewSource = readFileSync(
  new URL("../components/product-details-view.tsx", import.meta.url),
  "utf8"
);
const editorSource = readFileSync(
  new URL("../components/product-description-editor.tsx", import.meta.url),
  "utf8"
);
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

function sourceBlock(startMarker: string, endMarker: string) {
  const start = viewSource.indexOf(startMarker);
  const end = viewSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return viewSource.slice(start, end);
}

test("Description exposes a compact accessible AI trigger beside its heading", () => {
  assert.match(viewSource, /aria-label="Gerar descrição com IA"/);
  assert.match(viewSource, /title="Gerar descrição com IA"/);
  assert.match(viewSource, /role="tooltip"/);
  assert.match(viewSource, /<Loader2 className="h-3\.5 w-3\.5 animate-spin" \/>Gerando\.\.\./);
  assert.match(viewSource, /\{canEditProduct \? \(\s*<ProductDescriptionAiTrigger/);
  assert.doesNotMatch(
    viewSource,
    /Sugestões de descrição|Usar esta descrição|Gerar novas descrições/
  );
});

test("published rich editor remains the only Description editor", () => {
  assert.match(viewSource, /import \{ ProductDescriptionEditor \}/);
  assert.equal(viewSource.match(/const ProductDescriptionEditor/g)?.length ?? 0, 0);
  assert.match(editorSource, /command: "bold"/);
  assert.match(editorSource, /command: "italic"/);
  assert.match(editorSource, /command: "underline"/);
  assert.match(editorSource, /sanitizeProductDescription\(editor\.innerHTML\)/);
  assert.match(editorSource, /expanded \? "h-\[70vh\] min-h-80" : "min-h-56"/);
  assert.match(editorSource, /\[&_ul\+p\]:mt-3/);
  assert.match(editorSource, /\[&_ol\+p\]:mt-3/);
  assert.match(editorSource, /\[&_p\+ul\]:mt-1/);
  assert.match(editorSource, /\[&_p\+ol\]:mt-1/);
  assert.match(viewSource, /\[&_ul\+p\]:mt-3/);
  assert.match(viewSource, /\[&_ol\+p\]:mt-3/);
  assert.match(viewSource, /\[&_p\+ul\]:mt-1/);
  assert.match(viewSource, /\[&_p\+ol\]:mt-1/);
});

test("one explicit click requests one HTML description and applies it locally", () => {
  const generation = sourceBlock(
    "const generateDescription = useCallback",
    "const reorderImage = useCallback"
  );
  assert.match(generation, /\/api\/products\/\$\{currentProduct\.id\}\/ai\/description/);
  assert.match(generation, /method: "POST"/);
  assert.match(generation, /html\?: string/);
  assert.match(generation, /sanitizeProductDescription\(payload\.html\)/);
  assert.match(generation, /descriptionDraftRef\.current = nextDescription/);
  assert.match(generation, /updateDirtyField\("description", nextDescription\)/);
  assert.match(generation, /setDescriptionEditorResetKey/);
  assert.doesNotMatch(generation, /body: JSON\.stringify|method: "PATCH"|\/bling\//);
  assert.doesNotMatch(
    generation,
    /Ficha Técnica:|Conteúdo da Embalagem:|Vantagens:|Dimensões:|Tutorial de Instalação:|Mais sobre o Produto:/
  );
});

test("unsaved non-empty Description requires confirmation before replacement", () => {
  const generation = sourceBlock(
    "const generateDescription = useCallback",
    "const reorderImage = useCallback"
  );
  assert.match(generation, /const currentDescription = sanitizeProductDescription\(descriptionDraftRef\.current\)/);
  assert.match(generation, /const savedDescription = sanitizeProductDescription\(baselineForm\.description\)/);
  assert.match(generation, /currentDescription &&\s*currentDescription !== savedDescription &&\s*!window\.confirm/);
  assert.match(generation, /alterações não salvas/);
});

test("clicking AI from view enters edit and keeps expansion state", () => {
  const openExperience = sourceBlock(
    "const openDescriptionAiExperience = useCallback",
    "const cancelEdit = useCallback"
  );
  assert.match(openExperience, /if \(!editing\) beginEditing\(\)/);
  assert.match(openExperience, /void generateDescription\(\)/);
  assert.doesNotMatch(openExperience, /setIsDescriptionExpanded/);
  assert.match(viewSource, /expanded=\{isDescriptionExpanded\}/);
});

test("double click while loading cannot create a second request", () => {
  const generation = sourceBlock(
    "const generateDescription = useCallback",
    "const reorderImage = useCallback"
  );
  assert.match(generation, /if \(descriptionAiRequest\.current\) return/);
  assert.match(generation, /descriptionAiRequest\.current = controller/);
  assert.match(generation, /descriptionAiRequest\.current = null/);
  assert.match(viewSource, /disabled=\{saving \|\| descriptionAiLoading\}/);
});

test("safe generation error preserves the current draft", () => {
  const generation = sourceBlock(
    "const generateDescription = useCallback",
    "const reorderImage = useCallback"
  );
  const catchBlock = generation.slice(
    generation.indexOf("} catch (caughtError) {"),
    generation.indexOf("} finally")
  );
  assert.match(catchBlock, /Não foi possível gerar a descrição agora\. Tente novamente\./);
  assert.doesNotMatch(catchBlock, /setForm|descriptionDraftRef\.current\s*=|updateDirtyField/);
  assert.match(viewSource, /descriptionAiError[\s\S]*role="alert"/);
});

test("Cancel restores the saved snapshot and discards generated session state", () => {
  const cancelBlock = sourceBlock("const cancelEdit = useCallback", "function buildPayload");
  const resetBlock = sourceBlock(
    "const resetDescriptionAiSession = useCallback",
    "const baselineForm = useMemo"
  );
  assert.match(cancelBlock, /formFromProduct\(currentProduct\)/);
  assert.match(cancelBlock, /descriptionDraftRef\.current = nextForm\.description/);
  assert.match(cancelBlock, /resetDescriptionAiSession\(\)/);
  assert.doesNotMatch(cancelBlock, /setIsDescriptionExpanded/);
  assert.match(resetBlock, /generatedDescriptionHistory\.current\.clear\(\)/);
});

test("Save persists the latest Description only through the local product PATCH", () => {
  const payloadBlock = sourceBlock("function buildPayload", "function requestSave");
  const saveBlock = sourceBlock("async function confirmSave", "return (");
  assert.match(payloadBlock, /description: descriptionDraftRef\.current/);
  assert.match(saveBlock, /fetch\(`\/api\/products\/\$\{currentProduct\.id\}`/);
  assert.match(saveBlock, /method: "PATCH"/);
  assert.doesNotMatch(saveBlock, /\/bling\/|full-sync|OpenAI|\/ai\/description/);
});

test("Description AI remains server-only fail-closed and isolated from gallery", () => {
  const generation = sourceBlock(
    "const generateDescription = useCallback",
    "const reorderImage = useCallback"
  );
  const publicKeyVariableName = "NEXT_PUBLIC_" + "OPENAI_API_KEY";
  assert.match(envExample, /^OPENAI_DESCRIPTION_AI_ENABLED=false$/m);
  assert.match(envExample, /^OPENAI_DESCRIPTION_MODEL=$/m);
  assert.equal(envExample.includes(publicKeyVariableName), false);
  assert.doesNotMatch(viewSource, /from ["']openai["']|OPENAI_API_KEY|process\.env/);
  assert.doesNotMatch(generation, /setImages|orderedImages|setSelectedImageId|reorderImage/);
  assert.match(viewSource, /const ProductGallery = memo/);
  assert.match(viewSource, /const ProductMainImage = memo/);
});
