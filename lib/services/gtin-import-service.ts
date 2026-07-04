import { Prisma } from "@prisma/client";
import { parseDecimalPrice } from "@/lib/decimal-price";
import { prisma } from "@/lib/prisma";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { sanitizeLogPayload } from "@/lib/utils";

const requiredBlingHeaders = ["id", "codigo", "descricao", "preco", "estoque", "preco de custo", "gtin/ean"];
const applyConfirmationText = "APPLY_GTIN_IMPORT";

type ParsedCsvRow = {
  rowNumber: number;
  values: Record<string, string>;
};

type ParsedCsv = {
  delimiter: "," | ";";
  headers: string[];
  rows: ParsedCsvRow[];
};

type IncomingGtinRow = {
  rowNumber: number;
  externalId: string | null;
  sku: string | null;
  normalizedGtin: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  unit: string | null;
  ncm: string | null;
  weight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
};

type CatalogConflict = {
  rowNumber: number;
  normalizedGtin: string;
  field: string;
  currentValue: string;
  incomingValue: string;
  recommendation: string;
};

type ConflictResolutionInput = {
  normalizedGtin: string;
  field: string;
  resolution: "ACCEPT_INCOMING" | "KEEP_CURRENT";
};

type PreviewItem = {
  rowNumber: number;
  normalizedGtin: string | null;
  name: string | null;
  status: "NEW" | "EXISTING" | "INVALID" | "ERROR";
  fillFields: string[];
  conflicts: CatalogConflict[];
  errors: string[];
};

type PreviewSummary = {
  totalRows: number;
  validGtins: number;
  invalidGtins: number;
  newGtins: number;
  existingGtins: number;
  willFillEmptyFields: number;
  conflicts: number;
  errors: number;
};

type CatalogEntry = NonNullable<Awaited<ReturnType<typeof findCatalogByNormalizedGtin>>>;

function splitCsvRows(csv: string) {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += char + next;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      rows.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim() || rows.length) rows.push(current);
  return rows;
}

function parseCsvLine(line: string, delimiter: "," | ";") {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function detectCsvDelimiter(headerLine: string): "," | ";" {
  return parseCsvLine(headerLine, ";").length > parseCsvLine(headerLine, ",").length ? ";" : ",";
}

function normalizeHeader(value: string) {
  return value
    .replace(/ÃƒÂ§/g, "c")
    .replace(/ÃƒÂ£/g, "a")
    .replace(/ÃƒÂ¡/g, "a")
    .replace(/ÃƒÂ¢/g, "a")
    .replace(/ÃƒÂ©/g, "e")
    .replace(/ÃƒÂª/g, "e")
    .replace(/ÃƒÂ­/g, "i")
    .replace(/ÃƒÂ³/g, "o")
    .replace(/ÃƒÂ´/g, "o")
    .replace(/ÃƒÂº/g, "u")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(csv: string): ParsedCsv {
  const clean = csv.replace(/^\uFEFF/, "");
  const lines = splitCsvRows(clean).filter((line) => line.trim());
  if (!lines.length) return { delimiter: ",", headers: [], rows: [] };

  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line, index) => {
    const fields = parseCsvLine(line, delimiter);
    return {
      rowNumber: index + 2,
      values: headers.reduce<Record<string, string>>((acc, header, headerIndex) => {
        acc[header] = fields[headerIndex]?.trim() ?? "";
        return acc;
      }, {})
    };
  });

  return { delimiter, headers, rows };
}

function rowReader(row: ParsedCsvRow, headers: string[]) {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  return {
    getAny(possibleHeaders: string[]) {
      for (const header of possibleHeaders) {
        const original = normalized.get(normalizeHeader(header));
        const value = original ? row.values[original]?.trim() ?? "" : "";
        if (value) return value;
      }
      return "";
    }
  };
}

function isBlingExport(parsed: ParsedCsv) {
  const headers = new Set(parsed.headers.map(normalizeHeader));
  return requiredBlingHeaders.every((header) => headers.has(header));
}

function cleanText(value: string | null | undefined) {
  const text = value?.replace(/\t/g, " ").replace(/\s+/g, " ").trim() ?? "";
  return text ? text : null;
}

function firstDescription(shortDescription: string, complementDescription: string) {
  return cleanText(shortDescription) ?? cleanText(complementDescription);
}

function extractImageUrls(value: string) {
  const text = value.trim();
  if (!text) return [];
  const urls = text.match(/https?:\/\/[^\s,;|]+/gi) ?? [];
  return Array.from(new Set(urls.map((url) => url.trim()).filter(isPublicUrl))).slice(0, 12);
}

function isPublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return !(
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  } catch {
    return false;
  }
}

function parseOptionalDecimal(value: string) {
  return parseDecimalPrice(value);
}

function toIncomingRow(row: ParsedCsvRow, headers: string[]): IncomingGtinRow {
  const values = rowReader(row, headers);
  const imageUrls = extractImageUrls(values.getAny(["URL Imagens Externas"]));
  const gtin = normalizeGtin(values.getAny(["GTIN/EAN"]));

  return {
    rowNumber: row.rowNumber,
    externalId: cleanText(values.getAny(["ID"])),
    sku: cleanText(values.getAny(["Codigo", "Código"])),
    normalizedGtin: gtin,
    name: cleanText(values.getAny(["Descricao", "Descrição"])),
    brand: cleanText(values.getAny(["Marca"])),
    category: cleanText(values.getAny(["Categoria do produto"])),
    description: firstDescription(
      values.getAny(["Descricao Curta", "Descrição Curta"]),
      values.getAny(["Descricao Complementar", "Descrição Complementar", "Descricao do Produto no Fornecedor", "Descrição do Produto no Fornecedor"])
    ),
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    unit: cleanText(values.getAny(["Unidade"])),
    ncm: cleanText(values.getAny(["NCM"])),
    weight:
      parseOptionalDecimal(values.getAny(["Peso liquido (Kg)", "Peso líquido (Kg)", "Peso liquido", "Peso líquido"])) ??
      parseOptionalDecimal(values.getAny(["Peso bruto (Kg)", "Peso bruto"])),
    height: parseOptionalDecimal(values.getAny(["Altura do Produto", "Altura"])),
    width: parseOptionalDecimal(values.getAny(["Largura do produto", "Largura"])),
    depth: parseOptionalDecimal(values.getAny(["Profundidade do produto", "Profundidade"]))
  };
}

async function findCatalogByNormalizedGtin(normalizedGtin: string) {
  return prisma.internalGtinCatalog.findUnique({ where: { normalizedGtin } });
}

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Prisma.Decimal) return true;
  return Boolean(value);
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function incomingFields(row: IncomingGtinRow) {
  const imagesJson = row.imageUrls.length ? row.imageUrls.map((url) => ({ url, alt: row.name ?? row.normalizedGtin ?? "GTIN" })) : null;
  return {
    title: row.name,
    optimizedTitle: row.name,
    brand: row.brand,
    category: row.category,
    descriptionShort: row.description,
    descriptionFull: row.description,
    imageUrl: row.imageUrl,
    imagesJson,
    unit: row.unit,
    ncm: row.ncm,
    weight: row.weight,
    height: row.height,
    width: row.width,
    depth: row.depth
  };
}

function existingValue(entry: CatalogEntry, field: keyof ReturnType<typeof incomingFields>) {
  return entry[field as keyof CatalogEntry];
}

function compareFieldValue(current: unknown, incoming: unknown) {
  return stringifyValue(current).trim() === stringifyValue(incoming).trim();
}

function rowConfidence(row: IncomingGtinRow) {
  let score = 20;
  if (row.name) score += 20;
  if (row.brand) score += 15;
  if (row.category) score += 10;
  if (row.description) score += 15;
  if (row.imageUrls.length) score += 15;
  if (row.weight || row.height || row.width || row.depth) score += 10;
  if (row.unit || row.ncm) score += 5;
  return Math.min(score, 100);
}

function jsonInput(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function buildPreview(parsed: ParsedCsv) {
  if (!isBlingExport(parsed)) {
    throw new Error("Arquivo nao parece ser uma exportacao Bling valida.");
  }

  const rows = parsed.rows.map((row) => toIncomingRow(row, parsed.headers));
  const normalizedGtins = Array.from(new Set(rows.map((row) => row.normalizedGtin).filter((gtin): gtin is string => Boolean(gtin))));
  const existingEntries = await prisma.internalGtinCatalog.findMany({ where: { normalizedGtin: { in: normalizedGtins } } });
  const existingByGtin = new Map(existingEntries.map((entry) => [entry.normalizedGtin, entry]));
  const items: PreviewItem[] = [];

  for (const row of rows) {
    const errors: string[] = [];
    const conflicts: CatalogConflict[] = [];
    const fillFields: string[] = [];

    if (!row.normalizedGtin || !isValidGtin(row.normalizedGtin)) {
      errors.push("GTIN/EAN ausente ou invalido.");
      items.push({ rowNumber: row.rowNumber, normalizedGtin: row.normalizedGtin, name: row.name, status: "INVALID", fillFields, conflicts, errors });
      continue;
    }

    if (!row.name) errors.push("Descricao/nome ausente para criar ou enriquecer catalogo GTIN.");

    const existing = existingByGtin.get(row.normalizedGtin);
    if (!existing) {
      items.push({
        rowNumber: row.rowNumber,
        normalizedGtin: row.normalizedGtin,
        name: row.name,
        status: errors.length ? "ERROR" : "NEW",
        fillFields: Object.entries(incomingFields(row)).filter(([, value]) => hasValue(value)).map(([field]) => field),
        conflicts,
        errors
      });
      continue;
    }

    for (const [field, incoming] of Object.entries(incomingFields(row)) as Array<[keyof ReturnType<typeof incomingFields>, unknown]>) {
      if (!hasValue(incoming)) continue;
      const current = existingValue(existing, field);
      if (!hasValue(current)) {
        fillFields.push(field);
        continue;
      }
      if (!compareFieldValue(current, incoming)) {
        conflicts.push({
          rowNumber: row.rowNumber,
          normalizedGtin: row.normalizedGtin,
          field,
          currentValue: stringifyValue(current).slice(0, 240),
          incomingValue: stringifyValue(incoming).slice(0, 240),
          recommendation: "Manter valor atual no apply inicial; revisar conflito manualmente depois."
        });
      }
    }

    items.push({
      rowNumber: row.rowNumber,
      normalizedGtin: row.normalizedGtin,
      name: row.name,
      status: errors.length ? "ERROR" : "EXISTING",
      fillFields,
      conflicts,
      errors
    });
  }

  const summary: PreviewSummary = {
    totalRows: rows.length,
    validGtins: items.filter((item) => item.normalizedGtin && item.status !== "INVALID").length,
    invalidGtins: items.filter((item) => item.status === "INVALID").length,
    newGtins: items.filter((item) => item.status === "NEW").length,
    existingGtins: items.filter((item) => item.status === "EXISTING").length,
    willFillEmptyFields: items.reduce((total, item) => total + item.fillFields.length, 0),
    conflicts: items.reduce((total, item) => total + item.conflicts.length, 0),
    errors: items.reduce((total, item) => total + item.errors.length, 0)
  };

  return {
    format: "BLING_EXPORT" as const,
    summary,
    examples: items.slice(0, 20),
    conflicts: items.flatMap((item) => item.conflicts).slice(0, 50),
    rows
  };
}

export async function previewGtinImportFromCsv(csv: string) {
  return buildPreview(parseCsv(csv));
}

function createDataFromRow(row: IncomingGtinRow) {
  const imagesJson = row.imageUrls.length ? row.imageUrls.map((url) => ({ url, alt: row.name ?? row.normalizedGtin ?? "GTIN" })) : undefined;
  return {
    gtin: row.normalizedGtin!,
    normalizedGtin: row.normalizedGtin!,
    title: row.name!,
    optimizedTitle: row.name!,
    brand: row.brand,
    category: row.category,
    descriptionShort: row.description,
    descriptionFull: row.description,
    technicalDescription: null,
    imageUrl: row.imageUrl,
    unit: row.unit,
    ncm: row.ncm,
    weight: row.weight === null ? null : new Prisma.Decimal(row.weight),
    height: row.height === null ? null : new Prisma.Decimal(row.height),
    width: row.width === null ? null : new Prisma.Decimal(row.width),
    depth: row.depth === null ? null : new Prisma.Decimal(row.depth),
    attributesJson: Prisma.JsonNull,
    imagesJson: imagesJson ? jsonInput(imagesJson) : Prisma.JsonNull,
    metadataJson: jsonInput({
      source: "BLING_EXPORT",
      externalId: row.externalId,
      sku: row.sku
    }),
    source: "BLING_EXPORT",
    sourceUrl: null,
    confidenceScore: rowConfidence(row),
    approved: false
  };
}

function updateDataForEmptyFields(existing: CatalogEntry, row: IncomingGtinRow) {
  const next = createDataFromRow(row);
  const data: Prisma.InternalGtinCatalogUpdateInput = {};
  const filledFields: string[] = [];

  const assignIfEmpty = <K extends keyof typeof next>(field: K) => {
    const current = existing[field as keyof CatalogEntry];
    const incoming = next[field];
    if (!hasValue(current) && hasValue(incoming)) {
      (data as Record<string, unknown>)[field] = incoming;
      filledFields.push(String(field));
    }
  };

  assignIfEmpty("title");
  assignIfEmpty("optimizedTitle");
  assignIfEmpty("brand");
  assignIfEmpty("category");
  assignIfEmpty("descriptionShort");
  assignIfEmpty("descriptionFull");
  assignIfEmpty("imageUrl");
  assignIfEmpty("unit");
  assignIfEmpty("ncm");
  assignIfEmpty("weight");
  assignIfEmpty("height");
  assignIfEmpty("width");
  assignIfEmpty("depth");
  assignIfEmpty("imagesJson");
  assignIfEmpty("metadataJson");
  assignIfEmpty("source");

  const nextConfidence = Math.max(existing.confidenceScore, rowConfidence(row));
  if (nextConfidence !== existing.confidenceScore) data.confidenceScore = nextConfidence;

  return { data, filledFields };
}

function conflictKey(normalizedGtin: string, field: string) {
  return `${normalizedGtin}:${field}`;
}

function normalizeConflictResolutions(input: ConflictResolutionInput[] | undefined) {
  const resolutions = new Map<string, ConflictResolutionInput["resolution"]>();
  for (const item of input ?? []) {
    if (!item.normalizedGtin || !item.field) continue;
    if (!["ACCEPT_INCOMING", "KEEP_CURRENT"].includes(item.resolution)) continue;
    resolutions.set(conflictKey(item.normalizedGtin, item.field), item.resolution);
  }
  return resolutions;
}

function applyAcceptedConflictFields(
  data: Prisma.InternalGtinCatalogUpdateInput,
  row: IncomingGtinRow,
  rowConflicts: CatalogConflict[],
  resolutions: Map<string, ConflictResolutionInput["resolution"]>
) {
  const next = createDataFromRow(row);
  const acceptedFields: string[] = [];

  for (const conflict of rowConflicts) {
    if (resolutions.get(conflictKey(conflict.normalizedGtin, conflict.field)) !== "ACCEPT_INCOMING") continue;

    const field = conflict.field as keyof typeof next;
    if (!(field in next)) continue;

    const incoming = next[field];
    if (!hasValue(incoming)) continue;

    (data as Record<string, unknown>)[field] = incoming;
    acceptedFields.push(conflict.field);
  }

  return acceptedFields;
}

export async function applyGtinImportFromCsv(input: {
  csv: string;
  confirm: string;
  organizationId: string;
  userId?: string | null;
  conflictResolutions?: ConflictResolutionInput[];
}) {
  if (input.confirm !== applyConfirmationText) {
    throw new Error(`Confirmacao obrigatoria: ${applyConfirmationText}`);
  }

  const preview = await previewGtinImportFromCsv(input.csv);
  const conflictResolutions = normalizeConflictResolutions(input.conflictResolutions);
  let created = 0;
  let enriched = 0;
  let skipped = 0;
  let conflicts = 0;
  let conflictsAccepted = 0;
  let conflictsRejected = 0;
  let errors = 0;
  let fieldsFilled = 0;
  const items: Array<{
    rowNumber: number;
    normalizedGtin: string | null;
    status: "CREATED" | "ENRICHED" | "SKIPPED" | "ERROR";
    filledFields: string[];
    acceptedConflictFields: string[];
    conflicts: number;
    error?: string;
  }> = [];

  for (const row of preview.rows) {
    try {
      if (!row.normalizedGtin || !isValidGtin(row.normalizedGtin) || !row.name) {
        errors += 1;
        items.push({
          rowNumber: row.rowNumber,
          normalizedGtin: row.normalizedGtin,
          status: "ERROR",
          filledFields: [],
          acceptedConflictFields: [],
          conflicts: 0,
          error: "GTIN invalido ou nome ausente."
        });
        continue;
      }

      const existing = await findCatalogByNormalizedGtin(row.normalizedGtin);
      if (!existing) {
        await prisma.internalGtinCatalog.create({ data: createDataFromRow(row) });
        created += 1;
        fieldsFilled += Object.values(incomingFields(row)).filter(hasValue).length;
        items.push({
          rowNumber: row.rowNumber,
          normalizedGtin: row.normalizedGtin,
          status: "CREATED",
          filledFields: Object.keys(incomingFields(row)),
          acceptedConflictFields: [],
          conflicts: 0
        });
        continue;
      }

      const { data, filledFields } = updateDataForEmptyFields(existing, row);
      const rowConflicts = preview.conflicts.filter((conflict) => conflict.rowNumber === row.rowNumber);
      const acceptedConflictFields = applyAcceptedConflictFields(data, row, rowConflicts, conflictResolutions);
      conflicts += rowConflicts.length;
      conflictsAccepted += acceptedConflictFields.length;
      conflictsRejected += Math.max(rowConflicts.length - acceptedConflictFields.length, 0);

      if (!Object.keys(data).length) {
        skipped += 1;
        items.push({
          rowNumber: row.rowNumber,
          normalizedGtin: row.normalizedGtin,
          status: "SKIPPED",
          filledFields,
          acceptedConflictFields,
          conflicts: rowConflicts.length
        });
        continue;
      }

      await prisma.internalGtinCatalog.update({ where: { id: existing.id }, data });
      enriched += 1;
      fieldsFilled += filledFields.length + acceptedConflictFields.length;
      items.push({
        rowNumber: row.rowNumber,
        normalizedGtin: row.normalizedGtin,
        status: "ENRICHED",
        filledFields,
        acceptedConflictFields,
        conflicts: rowConflicts.length
      });
    } catch (error) {
      errors += 1;
      items.push({
        rowNumber: row.rowNumber,
        normalizedGtin: row.normalizedGtin,
        status: "ERROR",
        filledFields: [],
        acceptedConflictFields: [],
        conflicts: 0,
        error: error instanceof Error ? error.message : "Erro ao aplicar importacao GTIN."
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: "INTERNAL_GTIN_IMPORT_APPLY",
      entity: "InternalGtinCatalog",
      metadata: sanitizeLogPayload({
        created,
        enriched,
        skipped,
        conflicts,
        conflictsAccepted,
        conflictsRejected,
        errors,
        fieldsFilled,
        externalWrite: false
      }) as Prisma.InputJsonObject
    }
  });

  return {
    totalRows: preview.summary.totalRows,
    created,
    enriched,
    skipped,
    conflicts,
    conflictsAccepted,
    conflictsRejected,
    errors,
    fieldsFilled,
    externalWrite: false,
    items: items.slice(0, 50)
  };
}
