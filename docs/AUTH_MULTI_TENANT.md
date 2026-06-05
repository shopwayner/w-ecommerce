# Auth e Multi-Tenant

## Login

O MVP usa login por e-mail e senha em `/login`. A API `POST /api/auth/login` valida o payload com Zod, busca o usuario no PostgreSQL e compara a senha com `bcryptjs`.

Credencial local preservada:

- Master local OWNER: `Crowner@admin.com`

Para a conta master local, a senha fica em `MASTER_ADMIN_PASSWORD` no `.env` local e nao deve ir para producao.

## Sessao

Ao autenticar, o servidor cria um JWT assinado com `AUTH_SECRET` e salva em cookie httpOnly.

O cookie usa:

- `httpOnly: true`
- `sameSite: lax`
- `secure: true` apenas em producao
- `path: /`
- `maxAge` de 7 dias

O payload minimo contem `userId`, `organizationId` e `role`. O token nao contem senha, hash, segredos, credenciais Bling ou dados sensiveis.

## OrganizationId

O `organizationId` vem da sessao assinada e e confirmado no banco pelos helpers server-side. APIs internas nao aceitam `organizationId` do cliente como fonte de verdade.

Helpers principais:

- `getSession()`
- `getCurrentUser()`
- `getCurrentOrganization()`
- `requireAuth()`
- `requireRole(roles)`
- `requireOrganization()`
- `getTenantContext()`

Esses helpers validam usuario ativo, organizacao ativa e vinculo em `OrganizationUser`.

## Roles e Permissoes

Roles:

- `OWNER`: acesso total, usuarios, plano, integracoes e configuracoes.
- `ADMIN`: operacao completa sem alterar dono da organizacao.
- `OPERATOR`: produtos, pedidos, estoque e publicacoes; sem cobranca ou integracoes criticas.
- `VIEWER`: leitura.

Permissoes ficam em `lib/auth/permissions.ts` com `can(role, action)`. APIs usam `requireApiAuth(action)` para retornar `401` sem sessao e `403` sem permissao.

## Middleware

O middleware valida apenas cookie/JWT e nao usa Prisma. Ele deixa `/login`, `/api/auth/login`, `/api/auth/logout` e assets publicos passarem. Paginas protegidas sem sessao redirecionam para `/login`; APIs protegidas sem sessao retornam `401`.

## Planos e Limites

`PlanLimitService` le assinatura/plano e uso no banco:

- START: 1 conexao Bling.
- MATRIX: 3 conexoes Bling.
- ENTERPRISE: usa limite configurado.

Tambem existem metodos para checar limite mensal, incrementar uso e resumir uso da organizacao. Bling real ainda nao foi conectado.

## Como Testar

1. Acesse `/` sem sessao e confirme redirecionamento para `/login`.
2. Entre com a conta master local.
3. Confirme dashboard, topbar com usuario/organizacao e rotas principais.
4. Acesse Configuracoes e confira usuarios, plano e seguranca.
5. Use logout e confirme retorno para `/login`.
6. Confirme organizacao `Wayner Commerce Master` e papel `OWNER`.

## Cuidados de Seguranca

- Nao imprimir `.env`.
- Nao retornar `passwordHash`.
- Nao salvar sessao em `localStorage`.
- Nao expor `DATABASE_URL`, `AUTH_SECRET` ou `APP_ENCRYPTION_KEY`.
- Nao salvar tokens reais do Bling nesta etapa.
- Sanitizar metadados antes de gravar logs.

## Falta Para Producao

- Recuperacao de senha.
- Convite real de usuarios.
- Rotacao/revogacao de sessoes.
- CSRF reforcado para mutacoes sensiveis.
- Rate limit por IP/usuario.
- Testes automatizados de permissoes e isolamento multi-tenant.
- Auditoria completa para mudancas administrativas.
