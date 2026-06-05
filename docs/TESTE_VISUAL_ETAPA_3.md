# Teste Visual Etapa 3

Atualizado em 2026-06-03, usando o workspace `C:\W Ecommerce`.

## Comandos

- `npm.cmd install`: passou
- `npm.cmd run prisma:generate`: passou
- `npx.cmd prisma validate`: passou
- `npx.cmd prisma migrate dev --name bling_oauth`: bloqueado pelo ambiente nao interativo; migration SQL foi criada, aplicada e marcada como aplicada
- Migration criada: `20260604000200_bling_oauth`
- `npx.cmd prisma migrate status`: passou, banco em dia
- `npx.cmd prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code`: passou, sem diferencas
- `npm.cmd run prisma:seed`: passou
- `npm.cmd run lint`: passou, sem warnings ou erros
- `npm.cmd run build`: passou
- `npm.cmd run dev`: passou, servidor em `http://localhost:3000`

## Validacoes HTTP

- Admin acessa `/integrations`: 200
- Admin acessa `/matrix`: 200
- `GET /api/integrations`: 200
- `GET /api/integrations` nao retorna campos de token
- VIEWER em `POST /api/integrations/bling/start`: 403
- OWNER sem credenciais Bling reais em `POST /api/integrations/bling/start`: 400 amigavel

## Checklist Visual

- [x] Tela `/integrations` mostra botao `Conectar Bling`.
- [x] Modal pede nome da conexao e tipo.
- [x] Lista conexoes Bling da organizacao.
- [x] Mostra status, ultimo teste e acoes.
- [x] Botao fica bloqueado quando limite do plano e atingido.
- [x] Tela `/matrix` mostra Blings conectados e limite do plano.
- [x] Tokens nao aparecem na UI.

## Pendencias

- Testar com credenciais Bling reais em ambiente local seguro.
- Confirmar endpoint oficial mais adequado para `testConnection`.
- Fazer QA visual manual no navegador em desktop/mobile.
- Adicionar testes automatizados de OAuth, refresh e permissoes.
