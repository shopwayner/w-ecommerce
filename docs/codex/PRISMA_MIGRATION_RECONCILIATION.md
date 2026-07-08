# Prisma migration reconciliation

## Contexto

O `schema.prisma` estava mais novo que o historico versionado em
`prisma/migrations`. Isso fazia um banco novo, criado apenas pelas migrations
locais, nao chegar ao schema atual. Ao mesmo tempo, `npx prisma migrate status`
podia mostrar "up to date", porque ele compara apenas migrations registradas,
nao o schema final esperado pela aplicacao.

O erro local observado em `/api/account-context` vinha do banco local sem
`BlingProductImportDraft.blingConnectionId`, campo que ja existe no
`schema.prisma` e em producao.

A migration abaixo reconcilia esse historico:

`20260708000100_reconcile_schema_history`

Ela foi gerada por diff entre:

- origem: `prisma/migrations`
- destino: `prisma/schema.prisma`

Depois de adicionada, um diff em shadow database retornou `No difference
detected`, confirmando que as migrations versionadas passam a reproduzir o
schema atual.

## Revisao de seguranca

A migration nao contem:

- `DROP TABLE`
- `DROP COLUMN`
- `DELETE FROM`
- `TRUNCATE TABLE`
- `UPDATE`
- `INSERT`

Ela contem:

- `CREATE TYPE`
- `CREATE TABLE`
- `ADD COLUMN`
- `CREATE INDEX`
- `CREATE UNIQUE INDEX`
- `ADD CONSTRAINT`
- `DROP NOT NULL`
- um `DROP CONSTRAINT` em `OrderItem_productId_fkey`, seguido da recriacao da
  foreign key com `ON DELETE SET NULL`

Esse `DROP CONSTRAINT` nao remove dados. Ele ajusta a regra da FK para ficar
compativel com `OrderItem.productId` opcional.

## Objetos adicionados

Enums:

- `MarketplaceCategoryProvider`
- `MarketplaceCategorySource`
- `MarketplaceCategoryStatus`
- `MarketplaceProductAttributeSource`
- `MarketplaceProductAttributeStatus`
- `AuditLogStatus`
- `AuditRiskLevel`

Tabelas:

- `MercadoLivreListingCache`
- `ErpSyncJob`
- `BlingProductImportDraft`
- `MercadoLivreReferenceImport`
- `ProductEnrichmentHistory`
- `MarketplaceCategoryMapping`
- `MarketplaceProductAttributeValue`
- `MarketplaceCategoryCatalog`
- `InternalGtinCatalog`
- `UserIntegrationContextPreference`

Colunas adicionadas em tabelas existentes:

- `AuditLog`: `confirmation`, `entityType`, `method`, `riskLevel`, `route`,
  `status`, `summary`, `userEmail`, `userRole`
- `BlingConnection`: `externalAccountEmail`, `isDefault`,
  `lastProductSyncAt`, `selectedAt`
- `MercadoLivreConnection`: `isDefault`, `lastSyncAt`, `sellerNickname`
- `Order`: `currency`, `customerDocument`, `customerEmail`, `customerPhone`,
  `externalOrderId`, `externalStatusCode`, `externalStatusName`,
  `importedAt`, `invoiceExternalId`, `invoiceIssuedAt`, `invoiceKey`,
  `invoiceNumber`, `invoiceStatus`, `lastStatusSyncAt`, `orderNumber`,
  `orderSituationId`, `orderSituationName`, `orderedAt`, `paymentStatus`,
  `rawJson`, `shippingStatus`, `sourceConnectionId`, `sourceProvider`,
  `statusSyncWarnings`, `totalAmount`
- `OrderExternalMapping`: `sourceProvider`
- `OrderItem`: `createdAt`, `externalProductId`, `name`, `rawJson`,
  `totalPrice`, `updatedAt`
- `Product`: `attributes`, `confidenceScore`, `depth`, `enrichmentStatus`,
  `height`, `source`, `syncStatus`, `weight`, `width`

Colunas que passam a aceitar `NULL`:

- `AuditLog.organizationId`
- `OrderItem.productId`
- `OrderItem.sku`
- `Product.sku`

Indices e unique keys:

- `MercadoLivreListingCache`: indices de organizacao, conexao, SKU, GTIN,
  titulo, categoria, status, sync e unique por conexao + item externo
- `ErpSyncJob`: indices de organizacao, conexoes, provider, tipo, status e
  atualizacao
- `BlingProductImportDraft`: indices de organizacao, conexoes, status, SKU,
  GTIN, datas e unique por organizacao + conexao Bling + `externalId`
- `MercadoLivreReferenceImport`: indices de organizacao, produto, item externo,
  status e criacao
- `ProductEnrichmentHistory`: indices de organizacao, produto, usuario, origem,
  compatibilidade e criacao
- `MarketplaceCategoryMapping`: indices de organizacao, produto, catalogo GTIN,
  provider, status, atualizacao e unique por organizacao + produto + provider
- `MarketplaceProductAttributeValue`: indices de organizacao, produto,
  mapping, provider, categoria, atributo, status, atualizacao e unique por
  mapping + atributo
- `MarketplaceCategoryCatalog`: indices de provider, site, categoria pai, nome,
  path, sync e unique por provider + categoria do marketplace
- `InternalGtinCatalog`: unique por `normalizedGtin` e indices de GTIN,
  aprovado, confianca e atualizacao
- `UserIntegrationContextPreference`: indices de organizacao, usuario, modo,
  provider, conexao Bling e unique por organizacao + usuario
- `AuditLog`: indices de action, status, riskLevel e route
- `BlingConnection`: indices de organizacao + default e selectedAt
- `MercadoLivreConnection`: indices de organizacao + default e lastSyncAt
- `Order`: indices de provider, conexao, pedido externo, status externos,
  situacao, pagamento, envio, nota, data e unique por organizacao + provider +
  conexao + pedido externo
- `OrderExternalMapping`: indice de sourceProvider e unique por organizacao +
  provider + conexao + pedido externo
- `OrderItem`: indices de productId e externalProductId
- `Product`: indices de enrichmentStatus e syncStatus

Foreign keys:

- Novas FKs para as tabelas criadas contra `Organization`, `ERPConnection`,
  `BlingConnection`, `MercadoLivreConnection`, `Product`, `User`,
  `InternalGtinCatalog` e `MarketplaceCategoryMapping`
- Recriacao de `OrderItem.productId -> Product.id` com `ON DELETE SET NULL`

## Procedimento local seguro

Opcao A, banco local descartavel:

```powershell
# Apaga e recria somente o banco local. Use apenas se nao houver dados locais importantes.
npx prisma migrate reset
npx prisma generate
```

Opcao B, banco local com dados a preservar:

1. Nao use `migrate reset`.
2. Gere um diff do banco local real para o schema atual.
3. Revise o SQL antes de aplicar.
4. Aplique apenas SQL nao destrutivo e necessario.

Exemplo:

```powershell
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > local-schema-diff.sql
```

Antes de aplicar, verificar que o arquivo nao contem `DROP TABLE`,
`DROP COLUMN`, `DELETE`, `TRUNCATE`, `UPDATE` destrutivo ou alteracoes que
possam apagar dados. Se o banco local estiver muito desalinhado, a opcao mais
limpa continua sendo backup + `migrate reset`.

## Procedimento para producao

Nao executar esta migration cegamente em producao.

Motivo: producao ja possui parte ou todos os objetos adicionados por essa
reconciliacao. Como a migration nao e idempotente, executar em um banco que ja
tem as tabelas/colunas/indices pode falhar por objetos duplicados.

Procedimento recomendado:

1. Fazer backup/snapshot antes de qualquer operacao operacional.
2. Conferir metadados com `information_schema`/catalogos do Postgres, sem
   alterar dados.
3. Se todos os objetos da migration ja existirem em producao, marcar a migration
   como aplicada no historico:

```powershell
npx prisma migrate resolve --applied 20260708000100_reconcile_schema_history
```

4. Se algum objeto estiver ausente, parar e preparar SQL especifico, revisado e
   preferencialmente idempotente para producao. Nao usar `db push` em producao.

## Riscos

- A migration e segura para bancos novos ou resetados que partem das migrations
  versionadas.
- A migration pode falhar em bancos parcialmente atualizados por duplicidade de
  tabela, coluna, indice, enum ou constraint.
- `migrate resolve --applied` em producao so deve ser usado depois de confirmar
  que a estrutura real ja corresponde ao schema atual.
- Nao ha alteracao de produto, preco, estoque, GTIN, Bling, Mercado Livre ou
  anuncios nesta reconciliacao.
