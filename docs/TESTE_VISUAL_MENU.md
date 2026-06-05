# Teste Visual Menu

Atualizado em 2026-06-03, usando o workspace `C:\W Ecommerce`.

## Desktop Expandido

- [x] Menu aparece na ordem: Dashboard, Clientes, Operacoes, Produtos, Pedidos, Financeiro, Marketplaces, ERPS, IA, Relatorios, Anuncios, Precificacao, Integracoes, Estoque, IA Assistente, Configuracoes.
- [x] Itens mostram icone e texto.
- [x] Operacoes mostra seta e submenu.
- [x] Financeiro mostra seta e submenu.
- [x] Item ativo recebe destaque visual.
- [x] Grupo pai abre quando rota filha esta ativa.
- [x] Rodape mostra plano e vencimento.
- [x] Botao expandido mostra `Recolher menu`.

## Desktop Recolhido

- [x] Sidebar mostra apenas icones principais.
- [x] Textos e submenus longos ficam ocultos.
- [x] Rodape do plano fica compacto.
- [x] Botao de recolher vira botao compacto.
- [x] Layout principal ajusta o padding lateral.

## Mobile

- [x] Hamburger abre a sidebar.
- [x] Overlay fecha a sidebar.
- [x] Clicar em item fecha a sidebar.
- [x] Submenus funcionam no mobile.
- [x] Sidebar tem scroll vertical quando o menu passa da altura.

## Submenus

- [x] Operacoes inclui Visao Geral, Central Matrix, Automacoes, Publicacoes, Fila de Jobs e Logs de Sincronizacao.
- [x] Financeiro inclui Visao Geral, Assinaturas, Faturas e Cobrancas.
- [x] Rotas antigas `/matrix`, `/automations` e `/publications` continuam funcionando.

## Rodape do Plano

- [x] Mostra nome amigavel do plano quando a API de settings responde.
- [x] Fallback mostra `Plano Empresarial`.
- [x] Mostra `Vencimento dd/mm/aaaa` ou fallback `--/--/----`.
- [x] Nao exibe dados sensiveis.

## Validacoes

- `npm.cmd run prisma:generate`: passou
- `npx.cmd prisma validate`: passou
- `npm.cmd run lint`: passou
- `npm.cmd run build`: passou
