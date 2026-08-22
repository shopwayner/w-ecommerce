import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const inventorySource = readFileSync(
  path.join(process.cwd(), "components/pages/inventory-page.tsx"),
  "utf8"
);

test("inventory rows have a memo boundary keyed by balance identity", () => {
  assert.match(
    inventorySource,
    /const InventoryTableRow = memo\(function InventoryTableRow/
  );
  assert.match(
    inventorySource,
    /items\.map\(\(item\) => \(\s*<InventoryTableRow\s+item=\{item\}\s+key=\{item\.id\}\s+onView=\{onView\}\s*\/>\s*\)\)/
  );
  assert.doesNotMatch(inventorySource, /rows=\{items\.map/);
});

test("inventory table and supporting panels skip unrelated parent renders", () => {
  assert.match(
    inventorySource,
    /const InventoryToolbar = memo\(function InventoryToolbar/
  );
  assert.match(
    inventorySource,
    /const InventoryTable = memo\(function InventoryTable/
  );
  assert.match(
    inventorySource,
    /const CriticalInventoryCard = memo\(function CriticalInventoryCard/
  );
});

test("inventory table contains paint invalidation during page scroll", () => {
  assert.match(
    inventorySource,
    /className="matrix-scroll overflow-x-auto rounded-md border border-matrix-border bg-matrix-panel \[contain:paint\]"/
  );
});

test("callbacks passed to the inventory table have stable references", () => {
  assert.match(
    inventorySource,
    /const handleSearchQueryChange = useCallback\(\(query: string\)/
  );
  assert.match(
    inventorySource,
    /const handlePageSizeChange = useCallback\(\(nextPageSize: number\)/
  );
  assert.match(
    inventorySource,
    /const handlePreviousPage = useCallback\(\(\) =>/
  );
  assert.match(inventorySource, /const handleNextPage = useCallback\(\(\) =>/);
  assert.match(
    inventorySource,
    /const handleViewInventoryItem = useCallback\(\(label: string\)/
  );
  assert.match(inventorySource, /onView=\{handleViewInventoryItem\}/);
});

test("number formatting and table metadata are reused between renders", () => {
  assert.match(
    inventorySource,
    /const numberFormatter = new Intl\.NumberFormat\("pt-BR"\)/
  );
  assert.match(inventorySource, /const inventoryColumns = \[/);
  assert.match(
    inventorySource,
    /const emptyInventorySummary: InventorySummary = \{/
  );
  assert.doesNotMatch(
    inventorySource,
    /function formatNumber[\s\S]*?new Intl\.NumberFormat/
  );
});

test("search debounce, page sizes, row actions, and optimized thumbnails remain intact", () => {
  assert.match(
    inventorySource,
    /window\.setTimeout\(\(\) => \{[\s\S]*?setDebouncedSearchQuery\(searchQuery\.trim\(\)\);[\s\S]*?\}, 250\)/
  );
  assert.match(inventorySource, /const pageSizeOptions = \[50, 100, 200\]/);
  assert.match(
    inventorySource,
    /aria-label="Buscar estoque por produto, SKU, EAN ou Bling"/
  );
  assert.match(inventorySource, /aria-label="Saldos por pagina"/);
  assert.match(
    inventorySource,
    /unoptimized=\{!isOptimizableProductImageUrl\(item\.imageUrl\)\}/
  );
  assert.match(inventorySource, /loading="lazy"/);
  assert.match(inventorySource, /<Eye className="h-3\.5 w-3\.5" \/> Ver/);
});
