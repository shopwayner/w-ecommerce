# Teste Visual Sidebar Performance

Atualizado em 2026-06-04, usando o workspace `C:\W Ecommerce`.

## Sidebar Expandida

- [x] Rodape mostra o botao `< Recolher menu`.
- [x] Itens exibem icone e texto.
- [x] Item ativo fica destacado.
- [x] Grupos Operacoes e Financeiro continuam expansivos.

## Sidebar Recolhida

- [x] Menu mostra apenas icones no desktop.
- [x] Botao compacto de expandir fica visivel no topo.
- [x] Botao compacto de expandir tambem fica visivel no rodape.
- [x] Tooltips nativos aparecem pelo atributo `title`.
- [x] Item ativo permanece destacado.
- [x] Preferencia visual persiste em `matrix-sidebar-collapsed`.

## Navegacao

- [x] Itens usam `next/link` com `prefetch`.
- [x] Clique marca o item como ativo imediatamente.
- [x] Sidebar fecha ao clicar em item no mobile.
- [x] Sessao da topbar usa cache leve em memoria entre remounts.
- [x] Plano da sidebar usa cache leve em memoria entre remounts.
- [x] Loading global e discreto criado em `app/loading.tsx`.

## Submenus

- [x] `/operations/queue` mantem Operacoes ativo.
- [x] `/operations/logs` mantem Operacoes ativo.
- [x] `/finance/invoices` mantem Financeiro ativo.
- [x] `/finance/subscriptions` mantem Financeiro ativo.
- [x] Grupos ativos abrem automaticamente.

## Mobile

- [ ] Validar visualmente no navegador: hamburger abre o menu.
- [ ] Validar visualmente no navegador: clicar em item fecha o menu.
- [ ] Validar visualmente no navegador: botao desktop de recolher nao atrapalha overlay mobile.

## Validacoes

- `npm.cmd run prisma:generate`: passou.
- `npx.cmd prisma validate`: passou.
- `npm.cmd run lint`: passou.
- `npm.cmd run build`: passou.
- `npm.cmd run dev`: passou.

## Medicao Local

- Primeira navegacao no `next dev` compila as rotas sob demanda e pode ser mais lenta.
- Depois de aquecido, as rotas testadas responderam no servidor em aproximadamente 329ms a 411ms.
- Rotas testadas: `/`, `/clients`, `/products`, `/orders`, `/finance`, `/finance/invoices`, `/integrations`, `/settings`, `/operations`, `/operations/queue`, `/operations/logs`.
