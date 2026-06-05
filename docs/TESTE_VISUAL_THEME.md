# Teste Visual Theme

Atualizado em 2026-06-03, usando o workspace `C:\W Ecommerce`.

## Tema Claro

- [x] Fundo principal em branco/off-white.
- [x] Cards brancos com bordas suaves.
- [x] Destaques e botoes primarios em dourado.
- [x] Textos principais em preto/cinza escuro.
- [x] Sidebar clara com item ativo dourado/preto.
- [x] Topbar clara com busca refinada.

## Tema Escuro

- [x] Fundo preto/grafite.
- [x] Cards escuros com bordas discretas.
- [x] Dourado preservado como destaque.
- [x] Textos principais em branco/off-white.
- [x] Sidebar escura com item ativo dourado.
- [x] Topbar escura funcional.

## Toggle

- [x] Toggle de tema na topbar.
- [x] Preferencia persiste em `localStorage`.
- [x] Alternancia nao usa `.env` nem dados sensiveis.

## Topbar

- [x] Busca global com destaque dourado.
- [x] Botao de filtros refinado.
- [x] Botao de acao rapida dourado.
- [x] Notificacoes e usuario com bordas premium.

## Sidebar

- [x] Fundo premium claro/escuro.
- [x] Item ativo com dourado.
- [x] Submenus continuam funcionando.
- [x] Rodape de plano mantido e refinado.
- [x] Estado recolhido preservado.
- [x] Mobile preservado com hamburger e overlay.

## Dashboard

- [x] KPIs mais compactos e em maior quantidade por viewport.
- [x] Grafico principal maior.
- [x] Fila lateral preenchida.
- [x] Blocos inferiores com jobs, problemas e performance.
- [x] Menos area morta.

## Paginas Internas

- [x] Clientes, Operacoes, Financeiro, Marketplaces, ERPS, IA e Anuncios usam cards premium.
- [x] Produtos, Pedidos, Estoque, Precificacao, Integracoes, Matrix, Relatorios e Configuracoes seguem o design system.
- [x] Tabelas ficaram mais densas.
- [x] Inputs e modais usam tokens do tema.

## Responsividade

- [x] Desktop aproveita largura maior.
- [x] Tablet reorganiza grids.
- [x] Mobile mantem cards empilhados e tabelas com scroll horizontal.

## Validacoes

- `npm.cmd run prisma:generate`: passou
- `npx.cmd prisma validate`: passou
- `npm.cmd run lint`: passou, sem warnings ou erros
- `npm.cmd run build`: passou
