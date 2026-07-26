import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(
  new URL("../components/product-details-modal.tsx", import.meta.url),
  "utf8"
);
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("AI title action uses a compact accessible trigger and the authenticated route", () => {
  assert.match(modalSource, /Melhorar título com IA/);
  assert.match(modalSource, /aria-label="Melhorar título com IA"/);
  assert.match(modalSource, /title="Melhorar título com IA"/);
  assert.match(modalSource, /role="tooltip"/);
  assert.match(modalSource, /"✦ IA"/);
  assert.match(modalSource, /"✦ IA\.\.\."/);
  assert.match(modalSource, /Gerando sugestões\.\.\./);
  assert.match(modalSource, /Usar este título/);
  assert.match(modalSource, /Gerar novas sugestões/);
  assert.match(modalSource, /\/api\/products\/\$\{currentProduct\.id\}\/ai\/title/);
});

test("view trigger enters edit mode, focuses the name and opens the same AI flow", () => {
  const start = modalSource.indexOf("function openTitleAiExperience");
  const end = modalSource.indexOf("function renderTitleAiTrigger", start);
  const triggerBlock = modalSource.slice(start, end);
  assert.match(triggerBlock, /if \(!editing\) beginEditing\(\)/);
  assert.match(triggerBlock, /nameInputRef\.current\?\.focus\(\)/);
  assert.match(triggerBlock, /generateTitleSuggestions\(\)/);
  assert.match(modalSource, /field\.id === "name" && canEditProduct \? renderTitleAiTrigger\(\)/);
});

test("compact trigger never saves locally or calls Bling", () => {
  const start = modalSource.indexOf("function openTitleAiExperience");
  const end = modalSource.indexOf("function cancelEdit", start);
  const triggerAndMarkup = modalSource.slice(start, end);
  assert.doesNotMatch(triggerAndMarkup, /saveProduct|confirmSave|\/api\/products\/bling|method: "PATCH"/);
});

test("choosing a suggestion changes only the local form and performs no request", () => {
  const start = modalSource.indexOf("function applyTitleSuggestion");
  const end = modalSource.indexOf("function reorderImage", start);
  const selectionBlock = modalSource.slice(start, end);
  assert.match(selectionBlock, /applyProductTitleSuggestion\(form, title\)/);
  assert.match(selectionBlock, /setForm\(result\.form\)/);
  assert.doesNotMatch(selectionBlock, /fetch\(|PATCH|Bling|saveProduct|confirmSave/);
});

test("generation never saves the product or calls Bling", () => {
  const start = modalSource.indexOf("async function generateTitleSuggestions");
  const end = modalSource.indexOf("function applyTitleSuggestion", start);
  const generationBlock = modalSource.slice(start, end);
  assert.match(generationBlock, /method: "POST"/);
  assert.doesNotMatch(generationBlock, /\/api\/products\/bling|method: "PATCH"|saveProduct|onProductUpdated/);
});

test("frontend enforces and displays the 60 character limit", () => {
  assert.match(modalSource, /maxLength=\{field\.id === "name" \? PRODUCT_DETAILS_NAME_MAX_LENGTH/);
  assert.match(modalSource, /\{form\.name\.length\}\/\{PRODUCT_DETAILS_NAME_MAX_LENGTH\}/);
  assert.match(modalSource, /\{title\.length\}\/\{PRODUCT_DETAILS_NAME_MAX_LENGTH\}/);
  assert.match(modalSource, /form\.name\.trim\(\)\.length > PRODUCT_DETAILS_NAME_MAX_LENGTH/);
});

test("feature flag is documented as false and no public API key variable exists", () => {
  const publicKeyVariableName = "NEXT_PUBLIC_" + "OPENAI_API_KEY";
  assert.match(envExample, /^OPENAI_TITLE_AI_ENABLED=false$/m);
  assert.equal(envExample.includes(publicKeyVariableName), false);
  assert.doesNotMatch(modalSource, /from ["']openai["']|OPENAI_API_KEY|process\.env/);
});
