"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Download, Eye, FileUp, ImageIcon, PackagePlus, Pencil, Plus, Search, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

type GtinSearchResult =
  | {
      found: true;
      id: string;
      gtin: string;
      normalizedGtin: string;
      name: string;
      title: string;
      optimizedTitle: string;
      brand: string | null;
      category: string | null;
      description: string | null;
      descriptionShort: string | null;
      descriptionFull: string | null;
      technicalDescription: string | null;
      unit: string | null;
      ncm: string | null;
      weight: string | null;
      height: string | null;
      width: string | null;
      depth: string | null;
      imageUrls: string[];
      attributes: unknown;
      confidenceScore: number;
      approved: boolean;
      source: "INTERNAL_GTIN_CATALOG";
      catalogSource: string | null;
      lastUpdatedAt: string;
      permissions?: {
        canEditGlobalGtin: boolean;
      };
    }
  | {
      found: false;
      gtin: string;
      normalizedGtin?: string;
      message: string;
    };

type GtinSummary = {
  total: number;
  withImage: number;
  withoutImage: number;
  withBrand: number;
  withoutBrand: number;
  withDescription: number;
  withoutDescription: number;
  withDimensions: number;
  withoutDimensions: number;
  withUnit: number;
  withoutUnit: number;
  withNcm: number;
  withoutNcm: number;
  highConfidence: number;
  lowConfidence: number;
};

type GtinListItem = {
  id: string;
  gtin: string;
  normalizedGtin: string;
  name: string;
  brand: string | null;
  category: string | null;
  ncm: string | null;
  unit: string | null;
  imageUrl: string | null;
  confidenceScore: number;
  approved: boolean;
  status: string;
  updatedAt: string;
};

type GtinListResponse = {
  items: GtinListItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
  permissions?: {
    canEditGlobalGtin: boolean;
  };
};

type GtinImportPreview = {
  format: "BLING_EXPORT";
  summary: {
    totalRows: number;
    validGtins: number;
    invalidGtins: number;
    newGtins: number;
    existingGtins: number;
    willFillEmptyFields: number;
    conflicts: number;
    errors: number;
  };
  examples: Array<{
    rowNumber: number;
    normalizedGtin: string | null;
    name: string | null;
    status: "NEW" | "EXISTING" | "INVALID" | "ERROR";
    fillFields: string[];
    errors: string[];
  }>;
  conflicts: Array<{
    rowNumber: number;
    normalizedGtin: string;
    field: string;
    currentValue: string;
    incomingValue: string;
    recommendation: string;
  }>;
};

type GtinImportApplyReport = {
  totalRows: number;
  created: number;
  enriched: number;
  skipped: number;
  conflicts: number;
  conflictsAccepted: number;
  conflictsRejected: number;
  errors: number;
  fieldsFilled: number;
};

type GtinCleanupPreview = {
  totalGtins: number;
  keepWithImage: number;
  removeWithoutImage: number;
  criteria: {
    keep: string;
    remove: string;
  };
  examplesKeep: Array<{ id: string; gtin: string; normalizedGtin: string; title: string; brand: string | null; source: string | null; confidenceScore: number; approved: boolean }>;
  examplesRemove: Array<{ id: string; gtin: string; normalizedGtin: string; title: string; brand: string | null; source: string | null; confidenceScore: number; approved: boolean }>;
  impact: {
    productWrite: boolean;
    draftWrite: boolean;
    externalMappingWrite: boolean;
    externalWrite: boolean;
  };
};

type GtinCleanupReport = {
  mode: "KEEP_ONLY_WITH_IMAGE";
  before: GtinCleanupPreview;
  deleted: number;
  after: GtinCleanupPreview;
  productWrite: boolean;
  draftWrite: boolean;
  externalMappingWrite: boolean;
  externalWrite: boolean;
};

type ManualGtinForm = {
  gtin: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  imageUrl: string;
  ncm: string;
  unit: string;
  weight: string;
  height: string;
  width: string;
  depth: string;
};

type EditGtinForm = ManualGtinForm & {
  id: string;
  confidenceScore: string;
  approved: boolean;
};

const confirmationText = "CREATE_PRODUCT_FROM_INTERNAL_GTIN";
const importConfirmationText = "APPLY_GTIN_IMPORT";
const manualGtinConfirmationText = "CREATE_GLOBAL_GTIN_RECORD";
const updateGtinConfirmationText = "UPDATE_GLOBAL_GTIN_RECORD";
const cleanupConfirmationText = "DELETE_GTINS_WITHOUT_IMAGE_FROM_GLOBAL_CATALOG";
type ConflictResolution = "ACCEPT_INCOMING" | "KEEP_CURRENT";

function conflictKey(conflict: { normalizedGtin: string; field: string }) {
  return `${conflict.normalizedGtin}:${conflict.field}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Nao informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMeasurement(value: string | null, unit: string) {
  if (!value || Number(value) <= 0) return "Nao informado";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;
}

function valueOrFallback(value: string | null | undefined) {
  return value?.trim() ? value : "Nao informado";
}

function cleanDisplayText(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeGtinInput(value: string) {
  return value.replace(/\D/g, "");
}

function attributesEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).slice(0, 12);
}

function confidenceTone(score: number) {
  if (score >= 80) return "success" as const;
  if (score >= 50) return "warning" as const;
  return "danger" as const;
}

function confidenceLabel(score: number) {
  if (score >= 80) return "Alta confianca";
  if (score >= 50) return "Media confianca";
  return "Baixa confianca";
}

function GtinModal({
  title,
  description,
  children,
  onClose
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-3 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button aria-label="Fechar modal" className="absolute inset-0 cursor-default" type="button" onClick={onClose} />
      <div className="matrix-scroll relative max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-matrix-border bg-matrix-panel p-5 shadow-2xl">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-bold text-matrix-fg">{title}</h2>
            <p className="mt-1 text-sm text-matrix-muted">{description}</p>
          </div>
          <button
            aria-label="Fechar"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:border-matrix-gold/60 hover:text-matrix-fg"
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function GtinPage() {
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const [summary, setSummary] = useState<GtinSummary | null>(null);
  const [gtin, setGtin] = useState("");
  const [result, setResult] = useState<GtinSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<GtinImportPreview | null>(null);
  const [importReport, setImportReport] = useState<GtinImportApplyReport | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, ConflictResolution>>({});
  const [importLoading, setImportLoading] = useState(false);
  const [manualForm, setManualForm] = useState<ManualGtinForm>({
    gtin: "",
    name: "",
    brand: "",
    category: "",
    description: "",
    imageUrl: "",
    ncm: "",
    unit: "",
    weight: "",
    height: "",
    width: "",
    depth: ""
  });
  const [editForm, setEditForm] = useState<EditGtinForm | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<GtinCleanupPreview | null>(null);
  const [cleanupReport, setCleanupReport] = useState<GtinCleanupReport | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupConfirm, setCleanupConfirm] = useState("");
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [gtinList, setGtinList] = useState<GtinListItem[]>([]);
  const [gtinListMeta, setGtinListMeta] = useState<GtinListResponse["meta"]>({ total: 0, page: 1, limit: 10, pages: 1 });
  const [gtinListLoading, setGtinListLoading] = useState(true);
  const [gtinListSearch, setGtinListSearch] = useState("");
  const [gtinListQuery, setGtinListQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [canEditGlobalGtin, setCanEditGlobalGtin] = useState(false);

  const foundResult = result?.found ? result : null;
  const imageUrls = foundResult?.imageUrls ?? [];
  const mainImageUrl = imageUrls[0] ?? null;
  const attributeRows = useMemo(() => attributesEntries(foundResult?.attributes), [foundResult?.attributes]);
  const showCleanupTools = canEditGlobalGtin && Boolean((summary?.withoutImage ?? 0) > 0 || cleanupPreview || cleanupReport);

  function scrollToDetails() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  async function loadSummary() {
    setSummaryLoading(true);
    try {
      const response = await fetch("/api/gtin/summary");
      if (!response.ok) return;
      setSummary((await response.json()) as GtinSummary);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadGtinList(nextPage = gtinListMeta.page, nextSearch = gtinListQuery, nextLimit = gtinListMeta.limit) {
    setGtinListLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(nextLimit)
      });
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      const response = await fetch(`/api/gtin/list?${params.toString()}`);
      if (!response.ok) return;
      const payload = (await response.json()) as GtinListResponse;
      setGtinList(payload.items);
      setGtinListMeta(payload.meta);
      setCanEditGlobalGtin(Boolean(payload.permissions?.canEditGlobalGtin));
    } finally {
      setGtinListLoading(false);
    }
  }

  function applyListSearch() {
    const nextSearch = gtinListSearch.trim();
    setGtinListQuery(nextSearch);
    void loadGtinList(1, nextSearch, gtinListMeta.limit);
  }

  function exportCurrentListCsv() {
    const headers = ["GTIN/EAN", "Produto", "Marca", "NCM", "Unidade", "Confianca", "Status"];
    const escapeCsv = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = gtinList.map((item) => [
      item.normalizedGtin,
      item.name,
      item.brand,
      item.ncm,
      item.unit,
      `${item.confidenceScore}%`,
      item.status
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gtin-w-ecommerce.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function searchGtin(nextGtin = gtin) {
    const cleanGtin = normalizeGtinInput(nextGtin);
    setGtin(cleanGtin);
    setMessage("");
    setError("");
    setResult(null);

    if (!cleanGtin) {
      setError("Informe um GTIN/EAN para buscar.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/gtin/search?gtin=${encodeURIComponent(cleanGtin)}`);
      const payload = (await response.json()) as GtinSearchResult & { error?: string };
      if (!response.ok) {
        const errorMessage = "message" in payload ? payload.message : payload.error;
        setError(errorMessage ?? "Nao foi possivel buscar o GTIN.");
        setResult(payload);
        return;
      }
      setResult(payload);
      if (payload.found) setCanEditGlobalGtin(Boolean(payload.permissions?.canEditGlobalGtin));
      if (!payload.found) setMessage(payload.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewGtinFromList(item: GtinListItem) {
    await searchGtin(item.normalizedGtin);
    scrollToDetails();
  }

  async function quickCreateProduct() {
    if (!foundResult) return;
    const confirmed = window.confirm(
      "Criar um Product interno como DRAFT usando apenas a base interna de GTIN? Nada sera enviado ao Bling ou marketplaces."
    );
    if (!confirmed) return;

    setCreating(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/gtin/quick-create-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gtin: foundResult.normalizedGtin, confirm: confirmationText })
      });
      const payload = (await response.json()) as { status?: string; productId?: string; message?: string; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel criar o produto interno.");
        return;
      }

      setMessage(
        payload.status === "existing"
          ? payload.message ?? "Produto interno ja existente para este GTIN."
          : `Produto interno criado como rascunho: ${payload.productId}.`
      );
    } finally {
      setCreating(false);
    }
  }

  function editFormFromResult(entry: Extract<GtinSearchResult, { found: true }>): EditGtinForm {
    return {
      id: entry.id,
      gtin: entry.normalizedGtin,
      name: entry.name,
      brand: entry.brand ?? "",
      category: entry.category ?? "",
      description: cleanDisplayText(entry.description),
      imageUrl: entry.imageUrls[0] ?? "",
      ncm: entry.ncm ?? "",
      unit: entry.unit ?? "",
      weight: entry.weight ?? "",
      height: entry.height ?? "",
      width: entry.width ?? "",
      depth: entry.depth ?? "",
      confidenceScore: String(entry.confidenceScore),
      approved: entry.approved
    };
  }

  function updateEditForm(field: keyof EditGtinForm, value: string | boolean) {
    setEditForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function openEditFromResult(entry: Extract<GtinSearchResult, { found: true }>) {
    if (!canEditGlobalGtin) {
      setError("Somente conta MASTER pode editar o banco GTIN.");
      return;
    }
    setError("");
    setMessage("");
    setEditForm(editFormFromResult(entry));
  }

  async function openEditFromList(item: GtinListItem) {
    if (!canEditGlobalGtin) {
      setError("Somente conta MASTER pode editar o banco GTIN.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/gtin/search?gtin=${encodeURIComponent(item.normalizedGtin)}`);
      const payload = (await response.json()) as GtinSearchResult & { error?: string };
      if (!response.ok || !payload.found) {
        setError(payload.error ?? ("message" in payload ? payload.message : "Nao foi possivel carregar o GTIN para edicao."));
        return;
      }
      setResult(payload);
      setCanEditGlobalGtin(Boolean(payload.permissions?.canEditGlobalGtin));
      setEditForm(editFormFromResult(payload));
    } finally {
      setLoading(false);
    }
  }

  async function saveEditGtin() {
    if (!editForm) return;
    setEditLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/gtin/${encodeURIComponent(editForm.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gtin: editForm.gtin,
          name: editForm.name,
          brand: editForm.brand,
          category: editForm.category,
          description: editForm.description,
          imageUrl: editForm.imageUrl,
          ncm: editForm.ncm,
          unit: editForm.unit,
          weight: editForm.weight,
          height: editForm.height,
          width: editForm.width,
          depth: editForm.depth,
          confidenceScore: Number(editForm.confidenceScore),
          approved: editForm.approved,
          confirm: updateGtinConfirmationText
        })
      });
      const payload = (await response.json()) as { error?: string; data?: { normalizedGtin?: string } };
      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel salvar o GTIN global.");
        return;
      }
      setMessage("GTIN global atualizado. Nenhum produto foi alterado.");
      setEditForm(null);
      await loadSummary();
      await loadGtinList(gtinListMeta.page, gtinListQuery, gtinListMeta.limit);
      if (payload.data?.normalizedGtin) await searchGtin(payload.data.normalizedGtin);
    } finally {
      setEditLoading(false);
    }
  }

  async function validateImportFile() {
    if (!importFile) {
      setError("Selecione um CSV exportado do Bling.");
      return;
    }

    setImportLoading(true);
    setImportPreview(null);
    setImportReport(null);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const response = await fetch("/api/gtin/import/preview", { method: "POST", body: formData });
      const payload = (await response.json()) as GtinImportPreview & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel validar a planilha GTIN.");
        return;
      }
      setImportPreview(payload);
      setConflictResolutions({});
      setMessage("Preview gerado. Nenhum dado foi alterado.");
    } finally {
      setImportLoading(false);
    }
  }

  async function applyImportFile() {
    if (!importFile || !importPreview) return;
    const confirmed = window.confirm(
      `Aplicar importacao GTIN interna? Para seguranca, o sistema usara confirmacao ${importConfirmationText}. Nada sera enviado ao Bling ou marketplaces.`
    );
    if (!confirmed) return;

    setImportLoading(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("confirm", importConfirmationText);
      formData.append(
        "conflictResolutions",
        JSON.stringify(
          importPreview.conflicts.map((conflict) => ({
            normalizedGtin: conflict.normalizedGtin,
            field: conflict.field,
            resolution: conflictResolutions[conflictKey(conflict)] ?? "KEEP_CURRENT"
          }))
        )
      );
      const response = await fetch("/api/gtin/import/apply", { method: "POST", body: formData });
      const payload = (await response.json()) as GtinImportApplyReport & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel aplicar a importacao GTIN.");
        return;
      }
      setImportReport(payload);
      setMessage("Importacao GTIN aplicada na base interna.");
      await loadSummary();
      await loadGtinList(1, gtinListQuery, gtinListMeta.limit);
    } finally {
      setImportLoading(false);
    }
  }

  function updateManualForm(field: keyof ManualGtinForm, value: string) {
    setManualForm((current) => ({ ...current, [field]: field === "gtin" ? normalizeGtinInput(value) : value }));
  }

  async function createManualGtin() {
    setManualLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/gtin/manual-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...manualForm, confirm: manualGtinConfirmationText })
      });
      const payload = (await response.json()) as { error?: string; entry?: { normalizedGtin: string } };
      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel cadastrar o GTIN global.");
        return;
      }

      setMessage(`GTIN global cadastrado: ${payload.entry?.normalizedGtin ?? manualForm.gtin}.`);
      setManualForm({
        gtin: "",
        name: "",
        brand: "",
        category: "",
        description: "",
        imageUrl: "",
        ncm: "",
        unit: "",
        weight: "",
        height: "",
        width: "",
        depth: ""
      });
      await loadSummary();
      await loadGtinList(1, gtinListQuery, gtinListMeta.limit);
    } finally {
      setManualLoading(false);
    }
  }

  async function loadCleanupPreview() {
    setCleanupLoading(true);
    setCleanupPreview(null);
    setCleanupReport(null);
    setCleanupConfirm("");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/gtin/cleanup/preview");
      const payload = (await response.json()) as GtinCleanupPreview & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel gerar o preview de limpeza.");
        return;
      }
      setCleanupPreview(payload);
      setMessage("Preview de limpeza gerado. Nenhum dado foi alterado.");
    } finally {
      setCleanupLoading(false);
    }
  }

  async function applyCleanup() {
    if (!cleanupPreview) return;
    if (cleanupConfirm !== cleanupConfirmationText) {
      setError("Limpeza cancelada: confirmacao textual nao confere.");
      return;
    }

    setCleanupLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/gtin/cleanup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "KEEP_ONLY_WITH_IMAGE", confirm: cleanupConfirmationText })
      });
      const payload = (await response.json()) as GtinCleanupReport & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel aplicar a limpeza GTIN.");
        return;
      }
      setCleanupReport(payload);
      setCleanupPreview(payload.after);
      setCleanupConfirm("");
      setMessage(`Limpeza concluida. ${payload.deleted} GTIN(s) sem imagem removido(s) do banco mestre global.`);
      await loadSummary();
      await loadGtinList(1, gtinListQuery, gtinListMeta.limit);
    } finally {
      setCleanupLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
    void loadGtinList(1, "", 10);
    const params = new URLSearchParams(window.location.search);
    const initialGtin = params.get("gtin");
    if (initialGtin) void searchGtin(initialGtin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="GTIN"
        description="Banco mestre de GTIN/EAN do SaaS."
        actions={
          <div className="flex flex-wrap gap-2">
            {canEditGlobalGtin ? (
              <>
                <Button type="button" variant="secondary" onClick={() => setImportModalOpen(true)}>
                  <FileUp className="h-4 w-4" /> Importar GTIN
                </Button>
                <Button type="button" onClick={() => setManualModalOpen(true)}>
                  <Plus className="h-4 w-4" /> Cadastrar GTIN
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <Card className="mt-4">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-lg font-bold text-matrix-fg">
              <Search className="h-5 w-5 text-matrix-goldDark" />
              Buscar GTIN
            </h3>
            <p className="mt-1 text-sm text-matrix-muted">Pesquise por GTIN/EAN, nome do produto, marca ou NCM.</p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="min-w-0 flex-1 text-sm font-semibold text-matrix-fg">
              <span className="sr-only">Digite o GTIN/EAN ou nome do produto</span>
              <input
                className="min-h-11 w-full rounded-md border border-matrix-border bg-matrix-panel2 px-3 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60"
                placeholder="Digite o GTIN/EAN ou nome do produto"
                value={gtinListSearch}
                onChange={(event) => setGtinListSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyListSearch();
                }}
              />
            </label>
            <Button onClick={applyListSearch} disabled={gtinListLoading} type="button">
              <Search className="h-4 w-4" /> {gtinListLoading ? "Buscando..." : "Buscar"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="font-semibold text-matrix-fg">
            {gtinListLoading ? "Carregando GTINs..." : `${gtinListMeta.total} GTINs encontrados`}
          </h3>
          <Button type="button" variant="secondary" onClick={exportCurrentListCsv} disabled={!gtinList.length}>
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>
        <div className="matrix-scroll mt-3 overflow-x-auto rounded-md border border-matrix-border">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-matrix-panel text-xs uppercase tracking-[0.12em] text-matrix-muted">
              <tr>
                <th className="px-3 py-3">Imagem</th>
                <th className="px-3 py-3">GTIN/EAN</th>
                <th className="px-3 py-3">Produto</th>
                <th className="px-3 py-3">Marca</th>
                <th className="px-3 py-3">NCM</th>
                <th className="px-3 py-3">Unidade</th>
                <th className="px-3 py-3">Status / Confianca</th>
                <th className="px-3 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {gtinList.map((item) => (
                <tr key={item.id} className="border-t border-matrix-border">
                  <td className="px-3 py-2">
                    <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-md border border-matrix-border bg-matrix-panel2">
                      {item.imageUrl ? (
                        <Image alt={item.name} className="h-full w-full object-contain" height={56} src={item.imageUrl} unoptimized width={56} />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-matrix-muted" />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-matrix-fg">{item.normalizedGtin}</td>
                  <td className="max-w-xl px-3 py-2">
                    <p className="line-clamp-2 break-words font-medium text-matrix-fg">{item.name}</p>
                  </td>
                  <td className="px-3 py-2 text-matrix-fg">{valueOrFallback(item.brand)}</td>
                  <td className="px-3 py-2 text-matrix-fg">{valueOrFallback(item.ncm)}</td>
                  <td className="px-3 py-2 text-matrix-fg">{valueOrFallback(item.unit)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={confidenceTone(item.confidenceScore)}>{confidenceLabel(item.confidenceScore)}</Badge>
                      <span className="text-xs text-matrix-muted">{item.status}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" disabled={loading} onClick={() => void viewGtinFromList(item)}>
                        <Eye className="h-4 w-4" /> Ver
                      </Button>
                      {canEditGlobalGtin ? (
                        <Button type="button" variant="secondary" disabled={loading} onClick={() => void openEditFromList(item)}>
                          <Pencil className="h-4 w-4" /> Editar
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!gtinList.length && !gtinListLoading ? (
                <tr>
                  <td className="px-3 py-8 text-center text-matrix-muted" colSpan={8}>
                    Nenhum GTIN encontrado para a busca atual.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-matrix-muted">
            Exibindo pagina {gtinListMeta.page} de {gtinListMeta.pages}. {summaryLoading ? "" : `${summary?.total ?? gtinListMeta.total} GTINs no banco.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-h-10 rounded-md border border-matrix-border bg-matrix-panel2 px-3 text-sm text-matrix-fg outline-none"
              value={gtinListMeta.limit}
              onChange={(event) => {
                const nextLimit = Number(event.target.value);
                void loadGtinList(1, gtinListQuery, nextLimit);
              }}
            >
              {[10, 25, 50].map((value) => (
                <option key={value} value={value}>{value} por pagina</option>
              ))}
            </select>
            <Button type="button" variant="secondary" disabled={gtinListMeta.page <= 1 || gtinListLoading} onClick={() => void loadGtinList(gtinListMeta.page - 1, gtinListQuery, gtinListMeta.limit)}>
              Anterior
            </Button>
            <Button type="button" variant="secondary" disabled={gtinListMeta.page >= gtinListMeta.pages || gtinListLoading} onClick={() => void loadGtinList(gtinListMeta.page + 1, gtinListQuery, gtinListMeta.limit)}>
              Proxima
            </Button>
          </div>
        </div>
      </Card>

      {showCleanupTools ? (
        <Card className="mt-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-matrix-fg">Acoes avancadas de limpeza GTIN</summary>
            <p className="mt-2 text-sm text-matrix-muted">
              O preview nao altera dados. O apply remove apenas registros InternalGtinCatalog sem imagem, mantendo Products, drafts e mappings intactos.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={loadCleanupPreview} disabled={cleanupLoading}>
                {cleanupLoading ? "Gerando..." : "Gerar preview de limpeza"}
              </Button>
              <Button
                type="button"
                onClick={applyCleanup}
                disabled={!cleanupPreview || cleanupLoading || cleanupPreview.removeWithoutImage === 0 || cleanupConfirm !== cleanupConfirmationText}
              >
                Aplicar limpeza confirmada
              </Button>
            </div>
            {cleanupPreview ? (
              <div className="mt-3 grid gap-3 rounded-md border border-matrix-border bg-matrix-panel2/58 px-3 py-2 text-sm text-matrix-muted">
                <p>
                  Total: {cleanupPreview.totalGtins}. Manter com imagem: {cleanupPreview.keepWithImage}. Remover sem imagem: {cleanupPreview.removeWithoutImage}.
                </p>
                {cleanupPreview.removeWithoutImage > 0 ? (
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-matrix-muted">
                    Confirmacao textual
                    <input
                      className="min-h-10 rounded-md border border-matrix-border bg-matrix-panel px-3 text-sm normal-case tracking-normal text-matrix-fg outline-none"
                      value={cleanupConfirm}
                      onChange={(event) => setCleanupConfirm(event.target.value)}
                      placeholder={cleanupConfirmationText}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {cleanupReport ? (
              <p className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                Cleanup aplicado: {cleanupReport.deleted} removido(s). Total atual: {cleanupReport.after.totalGtins}.
              </p>
            ) : null}
          </details>
        </Card>
      ) : null}

      {error ? <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
      {message ? <p className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</p> : null}

      {result && !result.found ? (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-matrix-fg">GTIN nao encontrado na base interna</h3>
              <p className="mt-1 text-sm text-matrix-muted">{result.message}</p>
            </div>
            <Badge tone="warning">Sem cadastro interno</Badge>
          </div>
        </Card>
      ) : null}

      {foundResult ? (
        <div ref={detailsRef} className="mt-4 scroll-mt-24 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 gap-4">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-matrix-goldDark">Status</p>
                  <h3 className="mt-1 break-words text-xl font-bold text-matrix-fg">GTIN encontrado na base interna</h3>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge tone={foundResult.confidenceScore >= 80 ? "success" : "warning"}>{foundResult.confidenceScore}% confianca</Badge>
                  {canEditGlobalGtin ? (
                    <Button type="button" variant="secondary" onClick={() => openEditFromResult(foundResult)}>
                      <Pencil className="h-4 w-4" /> Editar GTIN
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold text-matrix-fg">Detalhes do produto</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[
                  ["GTIN/EAN", foundResult.normalizedGtin],
                  ["Produto", foundResult.name],
                  ["Marca", valueOrFallback(foundResult.brand)],
                  ["Classificacao auxiliar", valueOrFallback(foundResult.category)],
                  ["Unidade", valueOrFallback(foundResult.unit)],
                  ["NCM", valueOrFallback(foundResult.ncm)],
                  ["Peso", formatMeasurement(foundResult.weight, "kg")],
                  ["Altura", formatMeasurement(foundResult.height, "cm")],
                  ["Largura", formatMeasurement(foundResult.width, "cm")],
                  ["Profundidade", formatMeasurement(foundResult.depth, "cm")],
                  ["Fonte", valueOrFallback(foundResult.catalogSource ?? foundResult.source)],
                  ["Confianca", `${foundResult.confidenceScore}%`],
                  ["Ultima atualizacao", formatDate(foundResult.lastUpdatedAt)]
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2/58 p-3">
                    <p className="text-xs text-matrix-muted">{label}</p>
                    <p className="mt-1 break-words text-sm font-semibold text-matrix-fg">{value}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold text-matrix-fg">Informacoes internas</h3>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2/58 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-matrix-muted">Descricao completa</p>
                  <p className="matrix-scroll mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-sm text-matrix-fg">
                    {valueOrFallback(cleanDisplayText(foundResult.description))}
                  </p>
                </div>
                <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2/58 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-matrix-muted">Atributos</p>
                  {attributeRows.length ? (
                    <div className="mt-2 grid gap-2">
                      {attributeRows.map(([key, value]) => (
                        <div key={key} className="flex min-w-0 justify-between gap-3 text-sm">
                          <span className="min-w-0 break-words text-matrix-muted">{key}</span>
                          <strong className="min-w-0 break-words text-right text-matrix-fg">{String(value)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-matrix-muted">Nenhum atributo estruturado cadastrado.</p>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold text-matrix-fg">Categorias marketplace sugeridas</h3>
              <p className="mt-2 text-sm text-matrix-muted">
                O GTIN e base de cadastro: nome, marca, imagem, NCM, peso e dimensoes. A categoria oficial de canal e associada depois ao produto/anuncio.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-md border border-matrix-border bg-matrix-panel2/58 p-3">
                  <p className="text-sm font-semibold text-matrix-fg">Mercado Livre</p>
                  <Badge tone="warning">Definir no produto</Badge>
                  <p className="mt-2 text-xs text-matrix-muted">Requer categoryId oficial e atributos obrigatorios antes de uma publicacao futura.</p>
                </div>
                {["Shopee", "TikTok Shop", "Amazon", "Magalu"].map((provider) => (
                  <div key={provider} className="rounded-md border border-matrix-border bg-matrix-panel2/58 p-3">
                    <p className="text-sm font-semibold text-matrix-fg">{provider}</p>
                    <Badge tone="muted">Em breve</Badge>
                    <p className="mt-2 text-xs text-matrix-muted">Estrutura futura. Nenhuma API externa e chamada nesta tela.</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid min-w-0 gap-4 content-start">
            <Card>
              <h3 className="font-semibold text-matrix-fg">Imagens vinculadas ao GTIN</h3>
              <div className="mt-3 grid min-h-56 place-items-center overflow-hidden rounded-md border border-matrix-border bg-matrix-panel2/70 p-3">
                {mainImageUrl ? (
                  <Image alt={foundResult.name} className="max-h-64 w-full rounded-md object-contain" height={260} src={mainImageUrl} unoptimized width={360} />
                ) : (
                  <div className="text-center text-matrix-muted">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-matrix-goldSoft/60 text-matrix-goldDark">
                      <ImageIcon className="h-7 w-7" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-matrix-fg">Sem imagem</p>
                    <p className="mt-1 text-xs">Nenhuma imagem interna para este GTIN.</p>
                  </div>
                )}
              </div>
              {imageUrls.length > 1 ? (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {imageUrls.slice(0, 8).map((url) => (
                    <div key={url} className="grid aspect-square place-items-center overflow-hidden rounded-md border border-matrix-border bg-matrix-panel2/70">
                      <Image alt={foundResult.name} className="h-full w-full object-contain" height={90} src={url} unoptimized width={90} />
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>

            <Card>
              <h3 className="flex items-center gap-2 font-semibold text-matrix-fg">
                <CheckCircle2 className="h-4 w-4 text-matrix-goldDark" />
                Cadastro rapido
              </h3>
              <p className="mt-2 text-sm text-matrix-muted">
                Previa do Product interno que pode ser criado como DRAFT. Nada sera enviado ao Bling ou marketplaces.
              </p>
              <div className="mt-3 grid gap-2 text-sm">
                {[
                  ["Nome", foundResult.name],
                  ["Marca", valueOrFallback(foundResult.brand)],
                  ["GTIN", foundResult.normalizedGtin],
                  ["Classificacao auxiliar", valueOrFallback(foundResult.category)],
                  ["Peso", formatMeasurement(foundResult.weight, "kg")],
                  ["Dimensoes", `${formatMeasurement(foundResult.height, "cm")} x ${formatMeasurement(foundResult.width, "cm")} x ${formatMeasurement(foundResult.depth, "cm")}`]
                ].map(([label, value]) => (
                  <div key={label} className="flex min-w-0 justify-between gap-3 rounded-md border border-matrix-border bg-matrix-panel2/58 px-3 py-2">
                    <span className="text-matrix-muted">{label}</span>
                    <strong className="min-w-0 break-words text-right text-matrix-fg">{value}</strong>
                  </div>
                ))}
              </div>
              <Button className="mt-3 w-full" onClick={quickCreateProduct} disabled={creating} type="button">
                <PackagePlus className="h-4 w-4" /> {creating ? "Criando..." : "Cadastrar produto agora"}
              </Button>
            </Card>
          </div>
        </div>
      ) : null}

      {editForm ? (
        <GtinModal
          title="Editar GTIN"
          description="Esta alteracao modifica o banco GTIN global do SaaS. Nenhum produto sera alterado automaticamente."
          onClose={() => setEditForm(null)}
        >
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Esta alteracao modifica o banco GTIN global do SaaS. Nenhum produto, estoque, pedido, Bling ou marketplace sera alterado.
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="min-w-0 text-sm font-semibold text-matrix-fg">
              GTIN/EAN
              <input
                className="mt-2 min-h-10 w-full rounded-md border border-matrix-border bg-matrix-panel2 px-3 text-sm text-matrix-muted outline-none"
                value={editForm.gtin}
                disabled
                readOnly
              />
            </label>
            {[
              ["name", "Nome do produto", "Nome comercial"],
              ["brand", "Marca", "Marca"],
              ["category", "Classificacao auxiliar", "Opcional"],
              ["ncm", "NCM", "00000000"],
              ["unit", "Unidade", "UN"],
              ["imageUrl", "Imagem URL", "https://..."],
              ["weight", "Peso", "0,300"],
              ["height", "Altura", "10"],
              ["width", "Largura", "10"],
              ["depth", "Profundidade", "10"],
              ["confidenceScore", "Confianca", "90"]
            ].map(([field, label, placeholder]) => (
              <label key={field} className="min-w-0 text-sm font-semibold text-matrix-fg">
                {label}
                <input
                  className="mt-2 min-h-10 w-full rounded-md border border-matrix-border bg-matrix-panel2 px-3 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60"
                  placeholder={placeholder}
                  type={field === "confidenceScore" ? "number" : "text"}
                  min={field === "confidenceScore" ? 0 : undefined}
                  max={field === "confidenceScore" ? 100 : undefined}
                  value={String(editForm[field as keyof EditGtinForm])}
                  onChange={(event) => updateEditForm(field as keyof EditGtinForm, event.target.value)}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm font-semibold text-matrix-fg">
              <input
                type="checkbox"
                checked={editForm.approved}
                onChange={(event) => updateEditForm("approved", event.target.checked)}
              />
              Aprovado
            </label>
            <label className="min-w-0 text-sm font-semibold text-matrix-fg md:col-span-2 xl:col-span-3">
              Descricao
              <textarea
                className="matrix-scroll mt-2 min-h-32 w-full resize-y rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60"
                placeholder="Descricao publica e segura do produto"
                value={editForm.description}
                onChange={(event) => updateEditForm("description", cleanDisplayText(event.target.value))}
              />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditForm(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveEditGtin} disabled={editLoading || !editForm.name || !editForm.gtin}>
              <Pencil className="h-4 w-4" /> {editLoading ? "Salvando..." : "Salvar alteracoes"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-matrix-muted">Confirmacao interna usada: {updateGtinConfirmationText}. Nenhum Product sera alterado.</p>
        </GtinModal>
      ) : null}

      {manualModalOpen ? (
        <GtinModal
          title="Cadastrar GTIN"
          description="Este cadastro cria um registro no banco GTIN do SaaS. Nenhum produto sera alterado."
          onClose={() => setManualModalOpen(false)}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["gtin", "GTIN/EAN", "7890000000000"],
              ["name", "Nome do produto", "Nome comercial"],
              ["brand", "Marca", "Marca"],
              ["category", "Classificacao auxiliar", "Opcional"],
              ["ncm", "NCM", "00000000"],
              ["unit", "Unidade", "UN"],
              ["imageUrl", "Imagem URL", "https://..."],
              ["weight", "Peso", "0,300"],
              ["height", "Altura", "10"],
              ["width", "Largura", "10"],
              ["depth", "Profundidade", "10"]
            ].map(([field, label, placeholder]) => (
              <label key={field} className="min-w-0 text-sm font-semibold text-matrix-fg">
                {label}
                <input
                  className="mt-2 min-h-10 w-full rounded-md border border-matrix-border bg-matrix-panel2 px-3 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60"
                  placeholder={placeholder}
                  value={manualForm[field as keyof ManualGtinForm]}
                  onChange={(event) => updateManualForm(field as keyof ManualGtinForm, event.target.value)}
                />
              </label>
            ))}
            <label className="min-w-0 text-sm font-semibold text-matrix-fg md:col-span-2 xl:col-span-3">
              Descricao
              <textarea
                className="matrix-scroll mt-2 min-h-28 w-full resize-y rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60"
                placeholder="Descricao publica e segura do produto"
                value={manualForm.description}
                onChange={(event) => updateManualForm("description", event.target.value)}
              />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setManualModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={createManualGtin} disabled={manualLoading || !manualForm.gtin || !manualForm.name}>
              <Plus className="h-4 w-4" /> {manualLoading ? "Salvando..." : "Salvar GTIN"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-matrix-muted">Confirmacao interna usada: {manualGtinConfirmationText}. Nenhum produto sera criado.</p>
        </GtinModal>
      ) : null}

      {importModalOpen ? (
        <GtinModal
          title="Importar GTIN"
          description="Esta importacao alimenta apenas o banco GTIN do SaaS. Nada sera enviado ao Bling ou marketplaces."
          onClose={() => setImportModalOpen(false)}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
            <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2/58 p-4">
              <label className="block text-sm font-semibold text-matrix-fg">
                CSV exportado do Bling
                <input
                  className="mt-2 block w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm text-matrix-fg file:mr-3 file:rounded-md file:border-0 file:bg-matrix-gold file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-matrix-bg"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    setImportFile(event.target.files?.[0] ?? null);
                    setImportPreview(null);
                    setImportReport(null);
                    setConflictResolutions({});
                  }}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" onClick={validateImportFile} disabled={!importFile || importLoading}>
                  <FileUp className="h-4 w-4" /> {importLoading ? "Processando..." : "Validar arquivo"}
                </Button>
                <Button type="button" variant="secondary" onClick={applyImportFile} disabled={!importPreview || !importFile || importLoading}>
                  Aplicar importacao
                </Button>
              </div>
              <p className="mt-3 text-xs text-matrix-muted">
                O apply cria GTINs novos e preenche apenas campos vazios nos GTINs existentes. Conflitos nunca sao sobrescritos automaticamente.
              </p>
            </div>

            <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2/58 p-4">
              <h4 className="font-semibold text-matrix-fg">Ultimo resumo</h4>
              {importReport ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["Linhas", importReport.totalRows],
                    ["Criados", importReport.created],
                    ["Enriquecidos", importReport.enriched],
                    ["Campos", importReport.fieldsFilled],
                    ["Conflitos", importReport.conflicts],
                    ["Aceitos", importReport.conflictsAccepted],
                    ["Mantidos", importReport.conflictsRejected],
                    ["Erros", importReport.errors]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2">
                      <p className="text-xs text-matrix-muted">{label}</p>
                      <strong className="text-matrix-fg">{value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-matrix-muted">Valide uma planilha aprovada para ver o resumo.</p>
              )}
            </div>
          </div>

          {importPreview ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
              <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2/58 p-4">
                <h4 className="font-semibold text-matrix-fg">Preview da importacao</h4>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Linhas", importPreview.summary.totalRows],
                    ["GTINs validos", importPreview.summary.validGtins],
                    ["Novos", importPreview.summary.newGtins],
                    ["Existentes", importPreview.summary.existingGtins],
                    ["Campos a preencher", importPreview.summary.willFillEmptyFields],
                    ["Conflitos", importPreview.summary.conflicts],
                    ["Invalidos", importPreview.summary.invalidGtins],
                    ["Erros", importPreview.summary.errors]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-matrix-border bg-matrix-panel px-3 py-2">
                      <p className="text-xs text-matrix-muted">{label}</p>
                      <strong className="text-matrix-fg">{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="matrix-scroll mt-3 max-h-72 overflow-y-auto rounded-md border border-matrix-border">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-matrix-panel text-xs uppercase tracking-[0.12em] text-matrix-muted">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">GTIN</th>
                        <th className="px-3 py-2">Produto</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Campos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.examples.map((item) => (
                        <tr key={`${item.rowNumber}-${item.normalizedGtin ?? "sem-gtin"}`} className="border-t border-matrix-border">
                          <td className="px-3 py-2 text-matrix-muted">{item.rowNumber}</td>
                          <td className="px-3 py-2 font-mono text-xs text-matrix-fg">{item.normalizedGtin ?? "Invalido"}</td>
                          <td className="max-w-xs px-3 py-2 text-matrix-fg"><span className="line-clamp-2">{item.name ?? "Sem nome"}</span></td>
                          <td className="px-3 py-2"><Badge tone={item.status === "NEW" ? "success" : item.status === "EXISTING" ? "info" : "warning"}>{item.status}</Badge></td>
                          <td className="px-3 py-2 text-matrix-muted">{item.fillFields.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel2/58 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-matrix-fg">Conflitos encontrados</h4>
                    <p className="mt-1 text-sm text-matrix-muted">Conflitos nunca sao aplicados automaticamente. Se nada for escolhido, o valor atual sera mantido.</p>
                  </div>
                  <Badge tone="warning">{importPreview.conflicts.length} conflito(s)</Badge>
                </div>
                {importPreview.conflicts.length ? (
                  <div className="matrix-scroll mt-3 grid max-h-96 gap-2 overflow-y-auto">
                    {importPreview.conflicts.map((conflict) => {
                      const key = conflictKey(conflict);
                      const resolution = conflictResolutions[key] ?? "KEEP_CURRENT";
                      return (
                        <div key={`${conflict.rowNumber}-${conflict.normalizedGtin}-${conflict.field}`} className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-amber-100">Linha {conflict.rowNumber} - {conflict.field}</p>
                              <p className="mt-1 font-mono text-xs text-matrix-muted">{conflict.normalizedGtin}</p>
                            </div>
                            <Badge tone={resolution === "ACCEPT_INCOMING" ? "info" : "warning"}>{resolution === "ACCEPT_INCOMING" ? "Usar planilha" : "Manter atual"}</Badge>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel/70 p-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-matrix-muted">Valor atual</p>
                              <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-matrix-fg">{conflict.currentValue || "vazio"}</p>
                            </div>
                            <div className="min-w-0 rounded-md border border-matrix-border bg-matrix-panel/70 p-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-matrix-muted">Valor da planilha</p>
                              <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-matrix-fg">{conflict.incomingValue || "vazio"}</p>
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-amber-100">{conflict.recommendation}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="button" variant={resolution === "KEEP_CURRENT" ? undefined : "secondary"} onClick={() => setConflictResolutions((current) => ({ ...current, [key]: "KEEP_CURRENT" }))}>
                              Manter atual
                            </Button>
                            <Button type="button" variant={resolution === "ACCEPT_INCOMING" ? undefined : "secondary"} onClick={() => setConflictResolutions((current) => ({ ...current, [key]: "ACCEPT_INCOMING" }))}>
                              Usar valor da planilha
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-matrix-muted">Nenhum conflito detectado no preview.</p>
                )}
              </div>
            </div>
          ) : null}
        </GtinModal>
      ) : null}
    </AppShell>
  );
}
