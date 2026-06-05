# Teste Visual Layout Full Width

Atualizado em 2026-06-03, usando o workspace `C:\W Ecommerce`.

## Sidebar Aberta

- [x] Conteudo ocupa toda a largura util apos a sidebar expandida.
- [x] Nao ha container central estreito no miolo do admin.
- [x] Dashboard distribui KPIs, grafico, fila e blocos inferiores com melhor aproveitamento horizontal.
- [x] Paginas de Produtos, Pedidos, Integracoes, Estoque e Configuracoes usam grids mais largos.

## Sidebar Recolhida

- [x] Area principal expande automaticamente quando a sidebar recolhe.
- [x] Nao sobra faixa grande vazia a direita.
- [x] Nao ha margem esquerda fixa incorreta.
- [x] Rodape da sidebar permanece compacto sem empurrar o conteudo.

## Ocupacao Horizontal

- [x] `AppShell` usa `w-full` no wrapper principal.
- [x] O limite `max-width` centralizado foi removido do conteudo do painel.
- [x] Grids principais usam colunas adicionais em telas `xl` e `2xl`.
- [x] Colunas laterais usam `minmax` para evitar blocos estreitos em monitores largos.

## Ocupacao Vertical

- [x] Area principal usa altura minima baseada no viewport.
- [x] Paddings externos foram reduzidos.
- [x] Espacos entre secoes foram compactados.
- [x] Nao ha bloco artificial grande vazio abaixo do conteudo principal.

## Desktop

- [x] Layout preserva tema claro branco/dourado.
- [x] Layout preserva tema escuro grafite/dourado.
- [x] Sidebar expandida, recolhida e submenus continuam funcionais.
- [x] Topbar continua fixa e alinhada ao conteudo fluido.

## Mobile

- [ ] Validar visualmente no navegador: hamburger abre e fecha a sidebar.
- [ ] Validar visualmente no navegador: submenus funcionam no overlay mobile.
- [ ] Validar visualmente no navegador: tabelas mantem scroll horizontal quando necessario.
- [ ] Validar visualmente no navegador: nao ha sobreposicao de topbar, sidebar e conteudo.

## Validacoes

- `npm.cmd run prisma:generate`: passou
- `npx.cmd prisma validate`: passou
- `npm.cmd run lint`: passou
- `npm.cmd run build`: passou
- `npm.cmd run dev`: passou

## Rotas Para Conferir

- `/`
- `/clients`
- `/operations`
- `/products`
- `/orders`
- `/finance`
- `/marketplaces`
- `/erps`
- `/ia`
- `/reports`
- `/ads`
- `/pricing`
- `/integrations`
- `/inventory`
- `/ai`
- `/settings`
- `/automations`
- `/publications`
- `/matrix`
