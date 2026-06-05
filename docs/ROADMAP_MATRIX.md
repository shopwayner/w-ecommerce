# Matrix Commerce Hub Roadmap

## Etapa 1 concluida

- Fundacao Next.js App Router com TypeScript, TailwindCSS, Prisma e Zod.
- Layout SaaS escuro com sidebar, topbar, KPIs, tabelas, badges e drawer de produto.
- Telas mockadas: Dashboard, Central Matrix, Integracoes, Produtos, Pedidos, Estoque, Precos, Publicacoes, Relatorios e Configuracoes.
- Prisma schema inicial com entidades multi-tenant e indices principais.
- Migration inicial criada e aplicada no PostgreSQL local.
- Seed ficticio executado com organizacao, plano Matrix, conexoes Bling mockadas, produtos, pedidos, estoque, jobs e logs.
- Validacoes aprovadas: `prisma:generate`, `prisma validate`, `prisma:migrate`, `prisma:seed`, `lint`, `build`, `dev` e rotas principais.

## Etapa 2 concluida

- Login por e-mail e senha para MVP.
- Senha demo salva com hash bcrypt.
- Sessao assinada em JWT com cookie httpOnly.
- Middleware protege paginas e APIs sem usar Prisma.
- Helpers server-side para sessao, usuario, organizacao, tenant, roles e permissoes.
- Roles implementadas: OWNER, ADMIN, OPERATOR e VIEWER.
- APIs internas protegidas com 401/403 e `organizationId` vindo da sessao.
- Planos, assinatura e uso mensal preparados para limites multi-tenant.
- Seed demo idempotente com organizacao `Matrix Demo Commerce`, admin OWNER e viewer VIEWER.
- Tela de login criada.
- Topbar mostra usuario e organizacao e oferece logout.
- Configuracoes exibe Empresa, Usuarios e Permissoes, Plano e Limites, e Seguranca.
- Build final aprovado.

## Etapa 3 concluida

- OAuth Bling Authorization Code implementado no backend.
- State OAuth salvo como hash, com expiracao curta e uso unico.
- Troca de authorization code por token usa Basic Auth e header `enable-jwt: 1`.
- Tokens Bling sao criptografados com AES-256-GCM antes de persistir.
- `BlingApiClient` usa Bearer token, renova access token perto da expiracao e trata 401/403/429.
- Rate limit inicial em memoria: 2 requisicoes por segundo por conexao.
- APIs de conectar, testar, listar e desconectar Bling protegidas por sessao, permissao e `organizationId`.
- UI de Integracoes lista conexoes reais, abre modal de conexao e respeita limite do plano.
- Central Matrix mostra conexoes e avisa que sincronizacoes reais ficam para proximas etapas.
- `GET /api/integrations` nao retorna tokens.

## Reorganizacao do menu concluida

- Sidebar reorganizada na ordem definitiva do SaaS.
- Navegacao central criada em `lib/navigation.ts`.
- Grupos `Operacoes` e `Financeiro` ganharam submenus expansíveis.
- `Central Matrix`, `Automações` e `Publicações` foram movidos para dentro de `Operacoes`, mantendo as rotas antigas.
- `Precos` virou `Precificacao`.
- `Relatorios` aparece como `Relatorios`.
- Novas paginas placeholder criadas para Clientes, Operacoes, Fila de Jobs, Logs, Financeiro, Assinaturas, Faturas, Cobrancas, Marketplaces, ERPS, IA e Anuncios.
- Rodape da sidebar exibe plano, vencimento e controle de recolher menu.

## Atualizacao visual premium concluida

- Tema claro branco/off-white com dourado aplicado ao design system.
- Tema escuro preto/grafite com dourado aplicado ao design system.
- Toggle de tema adicionado na topbar com persistencia local.
- Tokens globais de layout, cards, bordas, textos, sidebar e dourado adicionados.
- Sidebar e topbar refinadas com visual premium.
- Dashboard densificado com KPIs compactos, grafico maior, fila lateral e blocos inferiores.
- Componentes base (`Card`, `Button`, `Badge`, `DataTable`, `PageHeader`, `KpiCard`) padronizados.
- Páginas internas ganharam layout mais denso por meio de componentes compartilhados.
- Login atualizado para o padrão branco/grafite + dourado.

## Correcao full-width do layout concluida

- Container principal do admin deixou de usar largura maxima centralizada.
- Conteudo agora ocupa toda a area util restante da sidebar expandida ou recolhida.
- `AppShell` usa `w-full`, `min-h` e padding lateral fluido por breakpoint.
- Dashboard, Produtos, Pedidos, Estoque, Precificacao, Integracoes, Relatorios, Configuracoes e paginas modulares tiveram grids rebalanceados.
- Telas internas aproveitam melhor monitores largos com mais colunas em `xl` e `2xl`.
- Layout mobile, sidebar recolhivel, submenus e toggle de tema foram preservados.

## Limpeza de dados mockados concluida

- Seed local agora preserva apenas planos, organizacao master, usuario master OWNER, assinatura ativa e contadores zerados.
- Produtos, pedidos, estoque, jobs, logs, conexoes Bling fake, anuncios, relatorios e metricas falsas foram removidos da base local.
- Organizacao demo antiga e usuarios demo antigos sao removidos pelo seed quando nao possuem vinculos reais.
- Telas principais mostram estado vazio real em vez de dados comerciais ficticios.
- APIs internas deixaram de importar arrays mockados e retornam consultas reais filtradas por `organizationId` ou listas vazias.
- `lib/mock-data.ts` foi removido do fluxo da aplicacao.

## Proximos passos

1. Revisar manualmente a UI no navegador em desktop e mobile.
2. Testar OAuth com credenciais Bling reais em ambiente local seguro.
3. Confirmar endpoint oficial ideal para teste de conexao.
4. Fortalecer convites reais de usuario com fluxo por e-mail.
5. Implementar troca de papel com auditoria e protecao OWNER/ADMIN.
6. Implementar autenticacao de producao com recuperacao de senha, expiracao curta e rotacao de sessao.
7. Conectar Redis + BullMQ para rate limit por conexao, retry e backoff.
8. Confirmar payloads oficiais do Bling antes de liberar POST/PUT/PATCH reais.
9. Implementar mappers isolados para produtos, pedidos, estoque, contatos e categorias.
10. Substituir estados vazios por dados reais conforme as proximas integracoes forem implementadas.
11. Adicionar testes automatizados de auth, OAuth, refresh token, permissoes, tenant e limites de plano.

## Regras de seguranca

- Tokens do Bling nunca devem ir para o frontend.
- Logs devem usar payload sanitizado.
- Client credentials globais devem ficar apenas no `.env`.
- Toda query multi-tenant deve filtrar `organization_id`/`organizationId`.
- Endpoints internos devem validar payload no backend com Zod.
- `passwordHash`, `AUTH_SECRET`, `APP_ENCRYPTION_KEY` e `DATABASE_URL` nunca devem ser retornados por API.
