"use client";

import { useState } from "react";
import { Download, FileUp, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, DataTable, KpiCard, PageHeader } from "@/components/ui";

export function ProductsPage() {
  const [open, setOpen] = useState(false);

  return (
    <AppShell>
      <PageHeader
        title="Produtos"
        description="Catalogo central com SKU, EAN, fiscal, imagens, vinculos Bling e status de publicacao."
        actions={<><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo produto</Button><Button variant="secondary"><FileUp className="h-4 w-4" /> Importar do Bling</Button><Button variant="secondary"><Download className="h-4 w-4" /> Exportar</Button><Button variant="secondary"><RefreshCw className="h-4 w-4" /> Sincronizar</Button></>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        <KpiCard label="Produtos cadastrados" value="0" hint="Catalogo vazio" />
        <KpiCard label="Em revisao" value="0" hint="Nenhuma pendencia" tone="warning" />
        <KpiCard label="Prontos para enviar" value="0" hint="Nenhum produto pronto" tone="success" />
        <KpiCard label="Importados do Bling" value="0" hint="Nenhuma importacao" tone="purple" />
      </div>
      <Card className="mt-4">
        <div className="mb-4 grid gap-3 md:grid-cols-5">
          {["Nome", "SKU/EAN", "Categoria", "Origem", "Bling"].map((filter) => (
            <input key={filter} placeholder={filter} className="rounded-md border border-matrix-border bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-slate-600" />
          ))}
        </div>
        <DataTable
          columns={["Produto", "SKU", "EAN", "Categoria", "Origem", "Status", "Preco", "Estoque", "Bling", "Atualizado", "Acoes"]}
          rows={[]}
          emptyMessage="Nenhum produto cadastrado ainda."
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
