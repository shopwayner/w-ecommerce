"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileUp, Plus, RefreshCw } from "lucide-react";
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

export function ProductsPage() {
  const [open, setOpen] = useState(false);
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
        <DataTable
          columns={["Produto", "SKU", "EAN", "Unidade", "Categoria", "Origem", "Status", "Valor", "Preco venda", "Estoque", "Bling", "Atualizado", "Acoes"]}
          rows={filteredProducts.map((product) => [
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
            <Button key={`${product.id}-actions`} variant="ghost">Ver</Button>
          ])}
          emptyMessage={loadingProducts ? "Carregando produtos..." : "Nenhum produto cadastrado ainda."}
        />
      </Card>
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
