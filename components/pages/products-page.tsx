"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, ImageIcon, Plus, RefreshCw, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, DataTable, KpiCard, PageHeader } from "@/components/ui";

type ProductListItem = {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  category: string | null;
  origin: string | null;
  unit: string | null;
  status: string;
  displayValue: string | null;
  salePriceDisplay: string | null;
  price: string;
  stock: number;
  updatedAt: string;
};

const statusLabel: Record<string, string> = {
  READY_FOR_TEST: "Pronto para teste",
  DRAFT: "Rascunho"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function ProductCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      aria-label={label}
      checked={checked}
      className="h-4 w-4 rounded border-matrix-border bg-matrix-panel2 text-matrix-gold accent-matrix-gold"
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
  );
}

export function ProductsPage() {
  const [open, setOpen] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<ProductListItem | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [filters, setFilters] = useState({
    name: "",
    sku: "",
    category: "",
    origin: "",
    bling: ""
  });

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      const response = await fetch("/api/products");
      if (!response.ok) {
        setProducts([]);
        return;
      }

      const payload = (await response.json()) as { data?: ProductListItem[] };
      setProducts(payload.data ?? []);
    } finally {
      setLoadingProducts(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    const productIds = new Set(products.map((product) => product.id));
    setSelectedProductIds((current) => new Set([...current].filter((id) => productIds.has(id))));
  }, [products]);

  useEffect(() => {
    if (!viewingProduct) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setViewingProduct(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [viewingProduct]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const skuOrEan = `${product.sku} ${product.ean ?? ""}`.toLowerCase();
      return (
        product.name.toLowerCase().includes(filters.name.toLowerCase()) &&
        skuOrEan.includes(filters.sku.toLowerCase()) &&
        (product.category ?? "").toLowerCase().includes(filters.category.toLowerCase()) &&
        (product.origin ?? "").toLowerCase().includes(filters.origin.toLowerCase()) &&
        "sem bling".includes(filters.bling.toLowerCase())
      );
    });
  }, [filters, products]);

  const visibleProductIds = useMemo(() => filteredProducts.map((product) => product.id), [filteredProducts]);
  const selectedVisibleCount = visibleProductIds.filter((id) => selectedProductIds.has(id)).length;
  const allVisibleSelected = visibleProductIds.length > 0 && selectedVisibleCount === visibleProductIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleProductIds.length;

  function toggleProductSelection(productId: string, checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(productId);
      } else {
        next.delete(productId);
      }
      return next;
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      for (const productId of visibleProductIds) {
        if (checked) {
          next.add(productId);
        } else {
          next.delete(productId);
        }
      }
      return next;
    });
  }

  return (
    <AppShell>
      <PageHeader
        title="Produtos"
        description="Catalogo central com SKU, EAN, fiscal, imagens, vinculos Bling e status de publicacao."
        actions={<><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo produto</Button><Button variant="secondary"><FileUp className="h-4 w-4" /> Importar do Bling</Button><Button variant="secondary"><Download className="h-4 w-4" /> Exportar</Button><Button variant="secondary"><RefreshCw className="h-4 w-4" /> Sincronizar</Button></>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <KpiCard label="Produtos cadastrados" value={String(products.length)} hint={products.length ? "Catalogo local carregado" : "Catalogo vazio"} />
        <KpiCard label="Em revisao" value="0" hint="Nenhuma pendencia" tone="warning" />
        <KpiCard label="Prontos para enviar" value={String(products.filter((product) => product.status === "READY_FOR_TEST").length)} hint="Produtos prontos para teste" tone="success" />
        <KpiCard label="Importados do Bling" value="0" hint="Nenhuma importacao" tone="purple" />
      </div>
      <Card className="mt-4">
        <div className="mb-4 grid gap-3 md:grid-cols-5">
          {[
            { key: "name", label: "Nome" },
            { key: "sku", label: "SKU/EAN" },
            { key: "category", label: "Categoria" },
            { key: "origin", label: "Origem" },
            { key: "bling", label: "Bling" }
          ].map((filter) => (
            <input
              key={filter.key}
              placeholder={filter.label}
              className="rounded-md border border-matrix-border bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-slate-600"
              value={filters[filter.key as keyof typeof filters]}
              onChange={(event) => setFilters((current) => ({ ...current, [filter.key]: event.target.value }))}
            />
          ))}
        </div>
        <div className="mb-3 flex min-h-6 items-center justify-between gap-3 text-xs text-matrix-muted">
          <span>{selectedProductIds.size ? `${selectedProductIds.size} produtos selecionados` : "Nenhum produto selecionado"}</span>
          <span>{filteredProducts.length} produtos visiveis</span>
        </div>
        <DataTable
          columns={[
            <ProductCheckbox
              key="select-all"
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              label="Selecionar todos os produtos visiveis"
              onChange={toggleVisibleSelection}
            />,
            "Produto",
            "SKU",
            "EAN",
            "Unidade",
            "Categoria",
            "Origem",
            "Status",
            "Valor",
            "Preco venda",
            "Estoque",
            "Bling",
            "Atualizado",
            "Acoes"
          ]}
          rows={filteredProducts.map((product) => [
            <ProductCheckbox
              key={`${product.id}-select`}
              checked={selectedProductIds.has(product.id)}
              label={`Selecionar ${product.name}`}
              onChange={(checked) => toggleProductSelection(product.id, checked)}
            />,
            product.name,
            product.sku,
            product.ean ?? "-",
            product.unit ?? "-",
            product.category ?? "-",
            product.origin ?? "-",
            <Badge key={`${product.id}-status`} tone={product.status === "READY_FOR_TEST" ? "success" : "muted"}>{statusLabel[product.status] ?? product.status}</Badge>,
            product.displayValue ?? "-",
            product.salePriceDisplay ?? "0,00",
            product.stock,
            "Sem Bling",
            formatDate(product.updatedAt),
            <Button key={`${product.id}-actions`} variant="ghost" onClick={() => setViewingProduct(product)}>Ver</Button>
          ])}
          emptyMessage={loadingProducts ? "Carregando produtos..." : "Nenhum produto cadastrado ainda."}
        />
      </Card>
      {viewingProduct ? (
        <ProductDetailsModal product={viewingProduct} onClose={() => setViewingProduct(null)} />
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/50">
          <aside className="matrix-scroll ml-auto h-full w-full max-w-xl overflow-y-auto border-l border-matrix-border bg-matrix-panel p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">Novo produto</h3>
              <button onClick={() => setOpen(false)} className="rounded-md border border-matrix-border px-3 py-2 text-sm text-slate-300">Fechar</button>
            </div>
            <div className="mt-6 grid gap-4">
              {["Nome", "SKU", "EAN", "Descricao", "Marca", "Categoria", "NCM", "CEST", "Preco de custo", "Markup", "Preco de venda", "Estoque minimo", "Imagens", "Campos bloqueados"].map((field) => (
                <label key={field} className="grid gap-2 text-sm text-slate-300">
                  {field}
                  <input className="rounded-md border border-matrix-border bg-white/[0.03] px-3 py-2 outline-none" />
                </label>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button>Salvar</Button>
              <Button variant="secondary">Enviar para Bling</Button>
              <Button variant="secondary">Atualizar em todos</Button>
            </div>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

function ProductDetailsModal({ product, onClose }: { product: ProductListItem; onClose: () => void }) {
  const details = [
    ["Nome do produto", product.name],
    ["SKU", product.sku],
    ["EAN", product.ean ?? "-"],
    ["Unidade", product.unit ?? "-"],
    ["Categoria", product.category ?? "-"],
    ["Origem", product.origin ?? "-"],
    ["Status", statusLabel[product.status] ?? product.status],
    ["Valor", product.displayValue ?? "-"],
    ["Preco de venda", product.salePriceDisplay ?? "0,00"],
    ["Estoque", String(product.stock)],
    ["Status Bling", "Sem Bling"],
    ["Data de atualizacao", formatDate(product.updatedAt)]
  ];

  const isLocalTestProduct = product.sku.startsWith("TEST-") || product.origin === "Teste local";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <section
        aria-modal="true"
        className="matrix-scroll max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-matrix-gold/30 bg-matrix-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Produto</p>
            <h3 className="mt-1 text-2xl font-bold tracking-normal text-matrix-fg">Detalhes do produto</h3>
          </div>
          <button
            aria-label="Fechar detalhes do produto"
            className="grid h-10 w-10 place-items-center rounded-md border border-matrix-border text-matrix-muted hover:border-matrix-gold/45 hover:text-matrix-goldDark"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="grid min-h-48 place-items-center rounded-lg border border-matrix-border bg-matrix-panel2/70 text-matrix-muted">
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-matrix-goldSoft/60 text-matrix-goldDark">
                <ImageIcon className="h-7 w-7" />
              </div>
              <p className="mt-3 text-sm font-semibold text-matrix-fg">Sem imagem</p>
              <p className="mt-1 text-xs text-matrix-muted">Placeholder atual</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3">
                <p className="text-xs font-medium text-matrix-muted">{label}</p>
                <p className="mt-1 text-sm font-semibold text-matrix-fg">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {isLocalTestProduct ? (
          <div className="mt-4 rounded-lg border border-matrix-gold/25 bg-matrix-goldSoft/35 px-3 py-2 text-sm font-semibold text-matrix-goldDark">
            Produto de teste/local
          </div>
        ) : null}
      </section>
    </div>
  );
}
