import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const APPROVED_BASELINE_MANIFEST_HASH =
  "c3633fc150a1b175bc7e4c870e5ceab50967e1298864f7633aff78a0272b8964";

type ManifestRow = Record<string, unknown> & { section: string };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stable(record[key])]),
    );
  }
  return value;
}

function stringify(value: unknown) {
  return JSON.stringify(stable(value));
}

export function normalizeType(value: string) {
  const upper = value.trim().toUpperCase();
  if (upper === "TEXT") return "text";
  if (upper === "INTEGER") return "integer";
  if (upper === "BOOLEAN") return "boolean";
  if (upper === "JSONB") return "jsonb";
  if (upper === "DATE") return "date";
  if (/^TIMESTAMP\(\d+\)$/.test(upper)) return `${upper.toLowerCase()} without time zone`;
  if (/^DECIMAL\(\d+,\d+\)$/.test(upper)) {
    return upper.toLowerCase().replace("decimal", "numeric");
  }
  return value.trim();
}

export function normalizeDefault(value: string | null) {
  if (value == null) return null;
  return value
    .trim()
    .replace(/::(?:text|integer|boolean|numeric|date|timestamp(?:\(\d+\))? without time zone)$/i, "")
    .replace(/::(?:public\.)?"[^"]+"$/i, "")
    .replace(/^\(([\s\S]*)\)$/, "$1")
    .replace(/\s+/g, " ");
}

function normalizeIdentifier(value: string) {
  const trimmed = value.trim().replace(/\s+ASC$/i, "");
  const quoted = trimmed.match(/^"([^"]+)"$/);
  if (!quoted) return trimmed;
  return /^[a-z_][a-z0-9_]*$/.test(quoted[1]) ? quoted[1] : `"${quoted[1]}"`;
}

function splitSqlList(value: string) {
  const output: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      output.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

export function manifestFromBaselineSql(baselineSql: string): ManifestRow[] {
  const rows: ManifestRow[] = [];

  for (const match of baselineSql.matchAll(/CREATE TYPE "([^"]+)" AS ENUM \(([\s\S]*?)\);/g)) {
    const values = [...match[2].matchAll(/'((?:''|[^'])*)'/g)].map((item) =>
      item[1].replaceAll("''", "'"),
    );
    rows.push({ section: "enum", enum: match[1], values });
  }

  for (const match of baselineSql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
    const table = match[1];
    rows.push({ section: "table", table });
    for (const rawLine of match[2].split(/\r?\n/)) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line) continue;
      const primary = line.match(/^CONSTRAINT "[^"]+" PRIMARY KEY \((.+)\)$/);
      if (primary) {
        rows.push({
          section: "primaryKey",
          table,
          columns: splitSqlList(primary[1]).map((column) => column.replaceAll('"', "")),
          deferrable: false,
          initiallyDeferred: false,
        });
        continue;
      }
      const column = line.match(/^"([^"]+)"\s+(.+)$/);
      if (!column) throw new Error(`Unsupported table line for ${table}: ${line}`);
      const definition = column[2];
      const typeMatch = definition.match(/^(.+?)(?=\s+NOT NULL|\s+DEFAULT\s+|$)/);
      if (!typeMatch) throw new Error(`Unsupported column type for ${table}.${column[1]}`);
      const defaultIndex = definition.indexOf(" DEFAULT ");
      rows.push({
        section: "column",
        table,
        column: column[1],
        type: normalizeType(typeMatch[1]),
        nullable: !/\sNOT NULL(?:\s|$)/.test(definition),
        default: normalizeDefault(defaultIndex >= 0 ? definition.slice(defaultIndex + 9) : null),
        identity: "",
        generated: "",
      });
    }
  }

  for (const match of baselineSql.matchAll(/CREATE (UNIQUE )?INDEX "[^"]+" ON "([^"]+)"\((.+)\);/g)) {
    rows.push({
      section: "index",
      table: match[2],
      unique: Boolean(match[1]),
      nullsNotDistinct: false,
      method: "btree",
      keys: splitSqlList(match[3]).map(normalizeIdentifier),
      include: [],
      predicate: null,
    });
  }

  for (const match of baselineSql.matchAll(
    /ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \((.+?)\) REFERENCES "([^"]+)"\((.+?)\) ON DELETE ([A-Z ]+) ON UPDATE ([A-Z ]+);/g,
  )) {
    rows.push({
      section: "foreignKey",
      table: match[1],
      columns: splitSqlList(match[2]).map((column) => column.replaceAll('"', "")),
      referencedTable: match[3],
      referencedColumns: splitSqlList(match[4]).map((column) => column.replaceAll('"', "")),
      onDelete: match[5],
      onUpdate: match[6],
      deferrable: false,
      initiallyDeferred: false,
    });
  }

  return rows;
}

export function canonicalizeCatalogRow(row: ManifestRow): ManifestRow {
  if (row.section === "table") return { section: "table", table: row.table };
  if (row.section === "enum") return { section: "enum", enum: row.enum, values: row.values };
  if (row.section === "column") {
    return {
      section: "column",
      table: row.table,
      column: row.column,
      type: normalizeType(String(row.type)),
      nullable: row.nullable,
      default: normalizeDefault(row.default == null ? null : String(row.default)),
      identity: row.identity,
      generated: row.generated,
    };
  }
  if (row.section === "primaryKey" || row.section === "uniqueConstraint") {
    return {
      section: row.section,
      table: row.table,
      columns: row.columns,
      deferrable: row.deferrable,
      initiallyDeferred: row.initiallyDeferred,
    };
  }
  if (row.section === "foreignKey") {
    return {
      section: "foreignKey",
      table: row.table,
      columns: row.columns,
      referencedTable: row.referencedTable,
      referencedColumns: row.referencedColumns,
      onDelete: row.onDelete,
      onUpdate: row.onUpdate,
      deferrable: row.deferrable,
      initiallyDeferred: row.initiallyDeferred,
    };
  }
  if (row.section === "index") {
    return {
      section: "index",
      table: row.table,
      unique: row.unique,
      nullsNotDistinct: row.nullsNotDistinct,
      method: row.method,
      keys: (row.keys as string[]).map(normalizeIdentifier),
      include: (row.include as string[]).map(normalizeIdentifier),
      predicate: row.predicate,
    };
  }
  throw new Error(`Unknown manifest section: ${row.section}`);
}

export function canonicalManifest(rows: ManifestRow[]) {
  return rows.map((row) => stringify(row)).sort();
}

export function serializeManifest(lines: string[]) {
  return `${lines.join("\n")}\n`;
}

export function hashManifest(lines: string[]) {
  return createHash("sha256").update(serializeManifest(lines), "utf8").digest("hex");
}

export function countManifestSections(lines: string[]) {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const section = (JSON.parse(line) as ManifestRow).section;
    counts[section] = (counts[section] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function diffManifests(expected: string[], actual: string[]) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    expectedOnly: expected.filter((line) => !actualSet.has(line)),
    actualOnly: actual.filter((line) => !expectedSet.has(line)),
  };
}

function parseJsonLines(value: string) {
  return value
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as ManifestRow);
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function emit(value: string, outputPath?: string) {
  if (outputPath) {
    writeFileSync(outputPath, value, "utf8");
    return;
  }
  process.stdout.write(value);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "baseline") {
    if (!args[0]) throw new Error("Usage: prisma-schema-manifest baseline <migration.sql>");
    const sql = readFileSync(args[0], "utf8");
    emit(serializeManifest(canonicalManifest(manifestFromBaselineSql(sql))), args[1]);
    return;
  }
  if (command === "catalog") {
    const input = args[0] ? readFileSync(args[0], "utf8") : await readStdin();
    const rows = parseJsonLines(input).map(canonicalizeCatalogRow);
    emit(serializeManifest(canonicalManifest(rows)), args[1]);
    return;
  }
  if (command === "verify") {
    if (!args[0] || !args[1]) {
      throw new Error("Usage: prisma-schema-manifest verify <expected.jsonl> <actual.jsonl> [expected-hash]");
    }
    const expected = canonicalManifest(parseJsonLines(readFileSync(args[0], "utf8")));
    const actual = canonicalManifest(parseJsonLines(readFileSync(args[1], "utf8")));
    const diff = diffManifests(expected, actual);
    const hash = hashManifest(actual);
    const expectedHash = args[2] ?? hashManifest(expected);
    const result = {
      hash,
      expectedHash,
      objects: actual.length,
      sections: countManifestSections(actual),
      expectedOnly: diff.expectedOnly,
      actualOnly: diff.actualOnly,
      valid: hash === expectedHash && diff.expectedOnly.length === 0 && diff.actualOnly.length === 0,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: prisma-schema-manifest <baseline|catalog|verify> ...");
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entrypoint === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Schema manifest failed");
    process.exitCode = 1;
  });
}
