import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewSource = readFileSync(
  new URL("../components/product-details-view.tsx", import.meta.url),
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

test("AI title action uses only the compact accessible trigger", () => {
  assert.match(viewSource, /aria-label="Melhorar título com IA"/);
  assert.match(viewSource, /title="Melhorar título com IA"/);
  assert.match(viewSource, /role="tooltip"/);
  assert.match(viewSource, /\{loading \? "✦ IA\.\.\." : "✦ IA"\}/);
  assert.doesNotMatch(viewSource, /Sugestões de título|Usar este título|Gerar novas sugestões/);
  assert.doesNotMatch(viewSource, /titleAiOpen|titleAiSuggestions/);
});

test("view trigger enters edit mode, focuses the name and generates immediately", () => {
  const triggerBlock = sourceBlock(
    "const openTitleAiExperience = useCallback",
    "const cancelEdit = useCallback"
  );
  assert.match(triggerBlock, /if \(!editing\) beginEditing\(\)/);
  assert.match(triggerBlock, /nameInputRef\.current\?\.focus\(\)/);
  assert.match(triggerBlock, /generateTitleSuggestion\(\)/);
  assert.match(viewSource, /field\.id === "name" && canEditProduct \? <ProductTitleAiTrigger/);
});

test("one click requests one title and applies it directly to the Name draft", () => {
  const generationBlock = sourceBlock(
    "const generateTitleSuggestion = useCallback",
    "const reorderImage = useCallback"
  );
  assert.match(generationBlock, /\/api\/products\/\$\{currentProduct\.id\}\/ai\/title/);
  assert.match(generationBlock, /method: "POST"/);
  assert.match(generationBlock, /title\?: string/);
  assert.match(generationBlock, /applyProductTitleSuggestion\(latestForm, title\)/);
  assert.match(generationBlock, /nameDraftRef\.current = result\.form\.name/);
  assert.match(generationBlock, /setForm\(result\.form\)/);
  assert.match(generationBlock, /updateDirtyField\("name", result\.form\.name\)/);
  assert.match(generationBlock, /setNameEditorResetKey/);
  assert.match(generationBlock, /nameInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(generationBlock, /saveProduct|confirmSave|onProductUpdated/);
  assert.doesNotMatch(generationBlock, /\/bling\/|method: "PATCH"|setImages/);
});

test("each later click sends the displayed title and session history for replacement", () => {
  const generationBlock = sourceBlock(
    "const generateTitleSuggestion = useCallback",
    "const reorderImage = useCallback"
  );
  assert.match(generationBlock, /const currentTitle = nameDraftRef\.current\.trim\(\)/);
  assert.match(generationBlock, /const generatedTitles = \[\.\.\.generatedTitleHistory\.current\]/);
  assert.match(generationBlock, /JSON\.stringify\(\{ currentTitle, excludedTitles \}\)/);
  assert.match(generationBlock, /generatedTitleHistory\.current\.add\(result\.form\.name\)/);
  assert.match(generationBlock, /normalizedTitle === currentTitle\.toLocaleLowerCase/);
});

test("double click while loading cannot create a second request", () => {
  const generationBlock = sourceBlock(
    "const generateTitleSuggestion = useCallback",
    "const reorderImage = useCallback"
  );
  const triggerBlock = sourceBlock(
    "const openTitleAiExperience = useCallback",
    "const cancelEdit = useCallback"
  );
  assert.match(generationBlock, /if \(titleAiRequest\.current\) return/);
  assert.match(triggerBlock, /if \(titleAiRequest\.current\) return/);
  assert.match(generationBlock, /titleAiRequest\.current = controller/);
  assert.match(generationBlock, /titleAiRequest\.current = null/);
});

test("a failed request keeps the current title and shows the sanitized nearby error", () => {
  const generationBlock = sourceBlock(
    "const generateTitleSuggestion = useCallback",
    "const reorderImage = useCallback"
  );
  const catchBlock = generationBlock.slice(
    generationBlock.indexOf("} catch {"),
    generationBlock.indexOf("} finally")
  );
  assert.match(
    generationBlock,
    /setTitleAiError\("Não foi possível melhorar o título agora\. Tente novamente\."\)/
  );
  assert.doesNotMatch(catchBlock, /setForm|nameDraftRef\.current\s*=|updateDirtyField/);
  assert.match(viewSource, /aiError[\s\S]*role="alert"/);
});

test("Cancel restores the saved snapshot and discards generated session titles", () => {
  const cancelBlock = sourceBlock(
    "const cancelEdit = useCallback",
    "function buildPayload"
  );
  const resetBlock = sourceBlock(
    "const resetTitleAiSession = useCallback",
    "const baselineForm = useMemo"
  );
  assert.match(cancelBlock, /formFromProduct\(currentProduct\)/);
  assert.match(cancelBlock, /nameDraftRef\.current = nextForm\.name/);
  assert.match(cancelBlock, /setForm\(nextForm\)/);
  assert.match(cancelBlock, /resetTitleAiSession\(\)/);
  assert.match(resetBlock, /generatedTitleHistory\.current\.clear\(\)/);
});

test("Save persists the latest Name only through the local product PATCH", () => {
  const saveBlock = sourceBlock("async function confirmSave", "return (");
  assert.match(saveBlock, /nameDraftRef\.current/);
  assert.match(saveBlock, /fetch\(`\/api\/products\/\$\{currentProduct\.id\}`/);
  assert.match(saveBlock, /method: "PATCH"/);
  assert.doesNotMatch(saveBlock, /\/bling\/|full-sync|OpenAI/);
});

test("frontend keeps the live 60 character editor without suggestion counters", () => {
  assert.match(viewSource, /maxLength=\{PRODUCT_DETAILS_NAME_MAX_LENGTH\}/);
  assert.match(viewSource, /\{value\.length\}\/\{PRODUCT_DETAILS_NAME_MAX_LENGTH\}/);
  assert.match(viewSource, /nameDraftRef\.current/);
  assert.doesNotMatch(viewSource, /\{title\.length\}\/\{PRODUCT_DETAILS_NAME_MAX_LENGTH\}/);
});

test("direct AI application does not mutate or remount the memoized gallery", () => {
  const generationBlock = sourceBlock(
    "const generateTitleSuggestion = useCallback",
    "const reorderImage = useCallback"
  );
  assert.match(viewSource, /const ProductGallery = memo/);
  assert.match(viewSource, /const ProductMainImage = memo/);
  assert.doesNotMatch(generationBlock, /setImages|orderedImages|setSelectedImageId/);
});

test("feature flag stays fail-closed and the client has no OpenAI credentials", () => {
  const publicKeyVariableName = "NEXT_PUBLIC_" + "OPENAI_API_KEY";
  assert.match(envExample, /^OPENAI_TITLE_AI_ENABLED=false$/m);
  assert.equal(envExample.includes(publicKeyVariableName), false);
  assert.doesNotMatch(viewSource, /from ["']openai["']|OPENAI_API_KEY|process\.env/);
});
