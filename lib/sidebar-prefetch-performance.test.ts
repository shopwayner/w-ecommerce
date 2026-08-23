import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sidebar = readFileSync(path.join(process.cwd(), "components/sidebar.tsx"), "utf8");

test("sidebar disables viewport prefetch for top-level and grouped links", () => {
  assert.match(sidebar, /prefetch=\{prefetchEnabled \? null : false\}/);
  assert.equal((sidebar.match(/<IntentPrefetchLink/g) ?? []).length, 2);
  assert.doesNotMatch(sidebar, /\n\s+prefetch\s*\n/);
});

test("sidebar prefetches only from explicit mouse or keyboard intent", () => {
  assert.match(sidebar, /onMouseEnter=\{\(event\) => \{/);
  assert.match(sidebar, /onFocus=\{\(event\) => \{/);
  assert.equal((sidebar.match(/setPrefetchEnabled\(true\)/g) ?? []).length, 2);
  assert.doesNotMatch(sidebar, /onTouchStart/);
});

test("intent enables native Next prefetch only once per mounted link", () => {
  assert.match(sidebar, /const \[prefetchEnabled, setPrefetchEnabled\] = useState\(false\)/);
  assert.match(sidebar, /prefetch=\{prefetchEnabled \? null : false\}/);
  assert.doesNotMatch(sidebar, /router\.prefetch|setInterval|setTimeout|debounce/i);
});

test("navigation and mobile close behavior remain client-side", () => {
  assert.match(sidebar, /href=\{child\.href\}/);
  assert.match(sidebar, /href=\{item\.href\}/);
  assert.equal((sidebar.match(/setPendingHref\(/g) ?? []).length, 3);
  assert.equal((sidebar.match(/onCloseMobile\(\)/g) ?? []).length, 2);
});
