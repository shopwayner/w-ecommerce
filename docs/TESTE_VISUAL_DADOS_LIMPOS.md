# Teste Visual Dados Limpos

Atualizado em 2026-06-03, usando o workspace `C:\W Ecommerce`.

## Checklist

- [x] Login master preservado.
- [x] Organizacao master preservada.
- [x] Plano/assinatura preservados.
- [x] Dashboard com KPIs zerados.
- [x] Dashboard com grafico em estado vazio.
- [x] Produtos sem dados fake.
- [x] Pedidos sem dados fake.
- [x] Estoque sem dados fake.
- [x] Integracoes sem conexao fake ativa.
- [x] Central Matrix sem Bling fake.
- [x] Publicacoes sem jobs fake.
- [x] Relatorios sem faturamento fake.
- [x] Financeiro sem valores falsos.
- [x] IA/IA Assistente sem historico fake.
- [x] Configuracoes mantem usuario, organizacao, plano e permissoes.

## Validacoes Tecnicas

- `npm.cmd run prisma:generate`: passou.
- `npx.cmd prisma validate`: passou.
- `npm.cmd run prisma:seed`: passou.
- `npm.cmd run lint`: passou.
- `npm.cmd run build`: passou.
- `npm.cmd run dev`: passou.

## Conferencia de Banco Local

- Usuario master: preservado e ativo.
- Organizacao: `Wayner Commerce Master`.
- Papel: `OWNER`.
- Plano: `ENTERPRISE`.
- Produtos: 0.
- Pedidos: 0.
- Estoque: 0.
- Jobs/publicacoes: 0.
- Sync jobs: 0.
- Conexoes Bling: 0.
- Uso total do plano: 0.

## Observacoes

- Nao foi usado `prisma migrate reset`.
- A limpeza local acontece via `prisma/seed.ts`, preservando a base minima necessaria.
- A senha da conta master permanece somente no `.env` local.
- Tokens, segredo de app e `DATABASE_URL` nao devem ser exibidos em telas, APIs ou logs.
