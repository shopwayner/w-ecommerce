# Teste Visual Etapa 2

Atualizado em 2026-06-03, usando o workspace `C:\W Ecommerce`.

## Ambiente

- PostgreSQL: `17.10`
- Banco: `matrix_hub`
- Node version: `v24.16.0`
- npm.cmd version: `11.13.0`
- npx.cmd version: `11.13.0`
- Dependencias adicionadas: `bcryptjs`, `jose`
- `DATABASE_URL`: configurada no `.env`, sem valor exposto
- Conta master local: criada com e-mail `Crowner@admin.com`
- Senha da conta master local: definida em `MASTER_ADMIN_PASSWORD` no `.env` local, nao documentar para producao

## Comandos

- `npm.cmd install`: passou
- `npm.cmd run prisma:generate`: passou
- `npx.cmd prisma validate`: passou
- `npx.cmd prisma migrate dev --name auth_multitenant`: exigiu ajuste manual por warnings interativos de enum; migration `20260604000100_auth_multitenant` foi aplicada e marcada como aplicada
- `npx.cmd prisma migrate status`: passou, banco em dia
- `npx.cmd prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code`: passou, sem diferencas
- `npm.cmd run prisma:seed`: passou
- `npm.cmd run lint`: passou, sem warnings ou erros
- `npm.cmd run build`: passou
- `npm.cmd run dev`: passou, servidor em `http://localhost:3000`

## Validacoes HTTP

- `/` sem sessao: `307` para `/login`
- `/api/products` sem sessao: `401`
- Login admin: `200`
- Rotas com sessao admin: `/`, `/matrix`, `/integrations`, `/products`, `/orders`, `/inventory`, `/pricing`, `/publications`, `/reports`, `/settings`, `/automations`, `/ai` responderam `200`
- Login viewer: `200`
- Escrita de produto com viewer: `403`
- Logout: `200`
- Login master local: `200`
- Sessao master local: organizacao `Wayner Commerce Master`, papel `OWNER`

## Checklist visual

- [x] `/login` abre sem sessao.
- [x] Login admin redireciona para o dashboard.
- [x] Topbar mostra usuario e organizacao.
- [x] Botao de logout remove sessao e volta para `/login`.
- [x] Configuracoes mostra Empresa.
- [x] Configuracoes mostra Usuarios e Permissoes.
- [x] Configuracoes mostra Plano e Limites.
- [x] Configuracoes mostra Seguranca.
- [x] Rotas principais abrem autenticadas.
- [x] Conta master local acessa Dashboard e Configuracoes como OWNER.

## Pendencias

- Fazer QA visual manual no navegador in-app em diferentes larguras.
- Adicionar testes automatizados de auth, permissoes e tenant.
- Resolver os 2 avisos moderados de `npm audit` com avaliacao separada, sem `--force` automatico.
