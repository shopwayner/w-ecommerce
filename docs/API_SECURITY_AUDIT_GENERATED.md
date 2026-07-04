# Auditoria estatica de seguranca das APIs

Gerado em: 2026-07-04T20:28:16.493Z

Este relatorio e uma analise estatica simples dos arquivos `app/api/**/route.ts`. Ele nao executa rotas, nao acessa banco e nao chama APIs externas.

## Resumo

- APIs/metodos auditados: 100
- Arquivos `route.ts`: 92
- Rotas publicas esperadas: 9
- Rotas protegidas: 91
- Rotas/metodos write: 56
- Rotas perigosas com confirmacao detectada: 6
- Dangerous routes with confirmation: 6
- Dangerous routes with audit log: 4
- Dangerous routes missing audit log: 16

## Contagem por tipo

| Tipo | Quantidade |
| --- | ---: |
| AUTH_REQUIRED_READ | 28 |
| AUTH_REQUIRED_WRITE | 37 |
| DANGEROUS_REQUIRES_CONFIRMATION | 6 |
| EXTERNAL_READ_ONLY | 13 |
| EXTERNAL_WRITE_BLOCKED | 7 |
| PUBLIC_SAFE | 9 |

## Contagem por risco

| Risco | Quantidade |
| --- | ---: |
| CRITICAL | 2 |
| HIGH | 16 |
| MEDIUM | 47 |
| LOW | 35 |

## Dangerous routes with confirmation

- POST `/api/ai/suggestions/[id]/apply` - `app/api/ai/suggestions/[id]/apply/route.ts`
- POST `/api/gtin/cleanup/apply` - `app/api/gtin/cleanup/apply/route.ts`
- POST `/api/gtin/import/apply` - `app/api/gtin/import/apply/route.ts`
- POST `/api/gtin/quick-create-product` - `app/api/gtin/quick-create-product/route.ts`
- POST `/api/products/intelligent-registration/apply` - `app/api/products/intelligent-registration/apply/route.ts`
- POST `/api/products/internal-gtin-catalog/sync-from-products` - `app/api/products/internal-gtin-catalog/sync-from-products/route.ts`

## Dangerous routes with audit log

- POST `/api/gtin/cleanup/apply` - `app/api/gtin/cleanup/apply/route.ts`
- POST `/api/gtin/import/apply` - `app/api/gtin/import/apply/route.ts`
- POST `/api/gtin/quick-create-product` - `app/api/gtin/quick-create-product/route.ts`
- POST `/api/products/internal-gtin-catalog/sync-from-products` - `app/api/products/internal-gtin-catalog/sync-from-products/route.ts`

## Dangerous routes missing audit log

- POST `/api/ai/suggestions/[id]/apply` - `app/api/ai/suggestions/[id]/apply/route.ts`
- POST `/api/gtin/import/preview` - `app/api/gtin/import/preview/route.ts`
- POST `/api/inventory/import-from-bling` - `app/api/inventory/import-from-bling/route.ts`
- POST `/api/inventory/sync-to-branches` - `app/api/inventory/sync-to-branches/route.ts`
- POST `/api/marketplaces/mercado-livre/import-by-item` - `app/api/marketplaces/mercado-livre/import-by-item/route.ts`
- POST `/api/marketplaces/mercado-livre/listings-sync/start` - `app/api/marketplaces/mercado-livre/listings-sync/start/route.ts`
- POST `/api/matrix/sync-now` - `app/api/matrix/sync-now/route.ts`
- POST `/api/orders/[id]/send-to-bling` - `app/api/orders/[id]/send-to-bling/route.ts`
- POST `/api/orders/import-from-bling` - `app/api/orders/import-from-bling/route.ts`
- POST `/api/pricing/apply` - `app/api/pricing/apply/route.ts`
- POST `/api/pricing/push-to-bling` - `app/api/pricing/push-to-bling/route.ts`
- POST `/api/products/[id]/marketplace/mercado-livre/attributes-apply` - `app/api/products/[id]/marketplace/mercado-livre/attributes-apply/route.ts`
- POST `/api/products/[id]/push-to-bling` - `app/api/products/[id]/push-to-bling/route.ts`
- POST `/api/products/bulk-sync` - `app/api/products/bulk-sync/route.ts`
- POST `/api/products/import-from-bling` - `app/api/products/import-from-bling/route.ts`
- POST `/api/products/intelligent-registration/apply` - `app/api/products/intelligent-registration/apply/route.ts`

## Tabela completa

| Metodo | Rota | Arquivo | Tipo | Usa autenticacao? | Usa organizationId? | Altera dados? | Chama API externa? | Exige confirmacao textual? | Risco | Correcao recomendada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/account-context` | `app/api/account-context/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/account-context` | `app/api/account-context/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/ai/history` | `app/api/ai/history/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/ai/modules/[module]/run` | `app/api/ai/modules/[module]/run/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/ai/status` | `app/api/ai/status/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter como consulta/simulacao sem alterar dados. |
| POST | `/api/ai/suggestions` | `app/api/ai/suggestions/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/ai/suggestions/[id]/apply` | `app/api/ai/suggestions/[id]/apply/route.ts` | DANGEROUS_REQUIRES_CONFIRMATION | sim | sim | sim | nao | sim | MEDIUM | Manter confirmacao textual exata, role adequada e audit log. |
| GET | `/api/audit-logs` | `app/api/audit-logs/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/auth/login` | `app/api/auth/login/route.ts` | PUBLIC_SAFE | nao | sim | nao | nao | nao | LOW | Rota publica esperada. |
| POST | `/api/auth/logout` | `app/api/auth/logout/route.ts` | PUBLIC_SAFE | nao | nao | nao | nao | nao | LOW | Rota publica esperada. |
| GET | `/api/auth/session` | `app/api/auth/session/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/dashboard/summary` | `app/api/dashboard/summary/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/erps/connections` | `app/api/erps/connections/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/erps/connections/[provider]` | `app/api/erps/connections/[provider]/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/erps/connections/[provider]/auth-url` | `app/api/erps/connections/[provider]/auth-url/route.ts` | AUTH_REQUIRED_READ | sim | sim | sim | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/erps/connections/[provider]/callback` | `app/api/erps/connections/[provider]/callback/route.ts` | PUBLIC_SAFE | nao | nao | nao | nao | nao | LOW | Manter callback protegido por state e sem retorno de segredo. |
| POST | `/api/erps/connections/[provider]/config` | `app/api/erps/connections/[provider]/config/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/erps/connections/[provider]/disconnect` | `app/api/erps/connections/[provider]/disconnect/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/erps/connections/[provider]/test` | `app/api/erps/connections/[provider]/test/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| PATCH | `/api/gtin/[id]` | `app/api/gtin/[id]/route.ts` | PUBLIC_SAFE | nao | nao | sim | nao | nao | CRITICAL | Revisar imediatamente: rota fora da lista publica esperada nao usa requireApiAuth. |
| POST | `/api/gtin/cleanup/apply` | `app/api/gtin/cleanup/apply/route.ts` | DANGEROUS_REQUIRES_CONFIRMATION | sim | sim | sim | nao | sim | MEDIUM | Manter confirmacao textual exata, role adequada e audit log. |
| GET | `/api/gtin/cleanup/preview` | `app/api/gtin/cleanup/preview/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter como consulta/simulacao sem alterar dados. |
| POST | `/api/gtin/import/apply` | `app/api/gtin/import/apply/route.ts` | DANGEROUS_REQUIRES_CONFIRMATION | sim | sim | sim | nao | sim | MEDIUM | Manter confirmacao textual exata, role adequada e audit log. |
| POST | `/api/gtin/import/preview` | `app/api/gtin/import/preview/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter como consulta/simulacao sem alterar dados. |
| GET | `/api/gtin/list` | `app/api/gtin/list/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/gtin/manual-create` | `app/api/gtin/manual-create/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | sim | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/gtin/quick-create-product` | `app/api/gtin/quick-create-product/route.ts` | DANGEROUS_REQUIRES_CONFIRMATION | sim | sim | sim | nao | sim | MEDIUM | Manter confirmacao textual exata, role adequada e audit log. |
| GET | `/api/gtin/search` | `app/api/gtin/search/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter como consulta/simulacao sem alterar dados. |
| GET | `/api/gtin/summary` | `app/api/gtin/summary/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/integrations` | `app/api/integrations/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| DELETE | `/api/integrations/[id]` | `app/api/integrations/[id]/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/integrations/[id]/test` | `app/api/integrations/[id]/test/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/integrations/bling/callback` | `app/api/integrations/bling/callback/route.ts` | PUBLIC_SAFE | nao | sim | sim | nao | nao | LOW | Manter callback protegido por state e sem retorno de segredo. |
| POST | `/api/integrations/bling/start` | `app/api/integrations/bling/start/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| DELETE | `/api/integrations/mercadolivre` | `app/api/integrations/mercadolivre/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/integrations/mercadolivre` | `app/api/integrations/mercadolivre/route.ts` | EXTERNAL_READ_ONLY | sim | sim | sim | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| GET | `/api/integrations/mercadolivre/auth-url` | `app/api/integrations/mercadolivre/auth-url/route.ts` | EXTERNAL_READ_ONLY | sim | sim | sim | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| GET | `/api/integrations/mercadolivre/callback` | `app/api/integrations/mercadolivre/callback/route.ts` | PUBLIC_SAFE | nao | sim | sim | sim | nao | LOW | Manter callback protegido por state e sem retorno de segredo. |
| POST | `/api/integrations/mercadolivre/config` | `app/api/integrations/mercadolivre/config/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/internal-gtin-catalog` | `app/api/internal-gtin-catalog/route.ts` | AUTH_REQUIRED_READ | sim | sim | sim | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/internal-gtin-catalog` | `app/api/internal-gtin-catalog/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| PATCH | `/api/internal-gtin-catalog/[id]` | `app/api/internal-gtin-catalog/[id]/route.ts` | PUBLIC_SAFE | nao | nao | sim | nao | nao | CRITICAL | Revisar imediatamente: rota fora da lista publica esperada nao usa requireApiAuth. |
| GET | `/api/inventory` | `app/api/inventory/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/inventory/import-from-bling` | `app/api/inventory/import-from-bling/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| POST | `/api/inventory/manual-adjust` | `app/api/inventory/manual-adjust/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/inventory/sync-to-branches` | `app/api/inventory/sync-to-branches/route.ts` | EXTERNAL_WRITE_BLOCKED | sim | nao | nao | nao | nao | HIGH | Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real. |
| POST | `/api/inventory/transfer` | `app/api/inventory/transfer/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/marketplaces/connections` | `app/api/marketplaces/connections/route.ts` | EXTERNAL_READ_ONLY | sim | sim | nao | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| GET | `/api/marketplaces/connections/[provider]` | `app/api/marketplaces/connections/[provider]/route.ts` | EXTERNAL_READ_ONLY | sim | sim | nao | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| GET | `/api/marketplaces/connections/[provider]/auth-url` | `app/api/marketplaces/connections/[provider]/auth-url/route.ts` | EXTERNAL_READ_ONLY | sim | sim | sim | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| GET | `/api/marketplaces/connections/[provider]/callback` | `app/api/marketplaces/connections/[provider]/callback/route.ts` | PUBLIC_SAFE | nao | nao | nao | sim | nao | LOW | Manter callback protegido por state e sem retorno de segredo. |
| POST | `/api/marketplaces/connections/[provider]/config` | `app/api/marketplaces/connections/[provider]/config/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/marketplaces/connections/[provider]/disconnect` | `app/api/marketplaces/connections/[provider]/disconnect/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/marketplaces/connections/[provider]/test` | `app/api/marketplaces/connections/[provider]/test/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/marketplaces/mercado-livre/accounts` | `app/api/marketplaces/mercado-livre/accounts/route.ts` | EXTERNAL_READ_ONLY | sim | sim | nao | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| GET | `/api/marketplaces/mercado-livre/callback` | `app/api/marketplaces/mercado-livre/callback/route.ts` | PUBLIC_SAFE | nao | sim | sim | sim | nao | LOW | Manter callback protegido por state e sem retorno de segredo. |
| GET | `/api/marketplaces/mercado-livre/connect` | `app/api/marketplaces/mercado-livre/connect/route.ts` | EXTERNAL_READ_ONLY | sim | sim | sim | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| POST | `/api/marketplaces/mercado-livre/disconnect` | `app/api/marketplaces/mercado-livre/disconnect/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/marketplaces/mercado-livre/import-by-item` | `app/api/marketplaces/mercado-livre/import-by-item/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | sim | sim | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| POST | `/api/marketplaces/mercado-livre/listings-sync/start` | `app/api/marketplaces/mercado-livre/listings-sync/start/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | sim | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| GET | `/api/marketplaces/mercado-livre/listings-sync/status` | `app/api/marketplaces/mercado-livre/listings-sync/status/route.ts` | EXTERNAL_READ_ONLY | sim | nao | nao | sim | nao | MEDIUM | Manter como consulta/simulacao read-only, sem persistir payload externo bruto. |
| GET | `/api/marketplaces/mercado-livre/search` | `app/api/marketplaces/mercado-livre/search/route.ts` | EXTERNAL_READ_ONLY | sim | nao | nao | sim | nao | MEDIUM | Manter como consulta/simulacao read-only, sem persistir payload externo bruto. |
| GET | `/api/marketplaces/mercado-livre/search/item-detail` | `app/api/marketplaces/mercado-livre/search/item-detail/route.ts` | EXTERNAL_READ_ONLY | sim | nao | nao | sim | nao | MEDIUM | Manter como consulta/simulacao read-only, sem persistir payload externo bruto. |
| GET | `/api/matrix` | `app/api/matrix/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/matrix/rules` | `app/api/matrix/rules/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| PATCH | `/api/matrix/rules/[id]` | `app/api/matrix/rules/[id]/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/matrix/sync-now` | `app/api/matrix/sync-now/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| GET | `/api/orders` | `app/api/orders/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/orders` | `app/api/orders/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/orders/[id]/send-to-bling` | `app/api/orders/[id]/send-to-bling/route.ts` | EXTERNAL_WRITE_BLOCKED | sim | nao | nao | nao | nao | HIGH | Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real. |
| PATCH | `/api/orders/[id]/status` | `app/api/orders/[id]/status/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter como consulta/simulacao sem alterar dados. |
| POST | `/api/orders/import-from-bling` | `app/api/orders/import-from-bling/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| GET | `/api/pricing` | `app/api/pricing/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/pricing/apply` | `app/api/pricing/apply/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| POST | `/api/pricing/calculate` | `app/api/pricing/calculate/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter como consulta/simulacao sem alterar dados. |
| POST | `/api/pricing/push-to-bling` | `app/api/pricing/push-to-bling/route.ts` | EXTERNAL_WRITE_BLOCKED | sim | nao | nao | nao | nao | HIGH | Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real. |
| GET | `/api/products` | `app/api/products/route.ts` | EXTERNAL_READ_ONLY | sim | sim | sim | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| POST | `/api/products` | `app/api/products/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/products/[id]` | `app/api/products/[id]/route.ts` | EXTERNAL_READ_ONLY | sim | sim | sim | sim | nao | MEDIUM | Garantir que chamada externa continue read-only e que logs sejam sanitizados. |
| PATCH | `/api/products/[id]` | `app/api/products/[id]/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | sim | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/products/[id]/check-gtin` | `app/api/products/[id]/check-gtin/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | nao | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| GET | `/api/products/[id]/enrichment` | `app/api/products/[id]/enrichment/route.ts` | AUTH_REQUIRED_READ | sim | sim | sim | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/products/[id]/enrichment` | `app/api/products/[id]/enrichment/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/products/[id]/marketplace/mercado-livre/attributes-apply` | `app/api/products/[id]/marketplace/mercado-livre/attributes-apply/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | sim | sim | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| GET | `/api/products/[id]/marketplace/mercado-livre/attributes-preview` | `app/api/products/[id]/marketplace/mercado-livre/attributes-preview/route.ts` | EXTERNAL_READ_ONLY | sim | nao | nao | sim | nao | MEDIUM | Manter como consulta/simulacao read-only, sem persistir payload externo bruto. |
| POST | `/api/products/[id]/push-to-bling` | `app/api/products/[id]/push-to-bling/route.ts` | EXTERNAL_WRITE_BLOCKED | sim | nao | nao | nao | nao | HIGH | Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real. |
| UNKNOWN | `/api/products/[id]/verify-gtin` | `app/api/products/[id]/verify-gtin/route.ts` | AUTH_REQUIRED_READ | sim | sim | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/products/bulk-sync` | `app/api/products/bulk-sync/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| POST | `/api/products/enrichment/batch` | `app/api/products/enrichment/batch/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
| POST | `/api/products/import-from-bling` | `app/api/products/import-from-bling/route.ts` | AUTH_REQUIRED_WRITE | sim | nao | nao | nao | nao | HIGH | Adicionar confirmacao textual exata antes de executar operacao sensivel. |
| POST | `/api/products/intelligent-registration/apply` | `app/api/products/intelligent-registration/apply/route.ts` | DANGEROUS_REQUIRES_CONFIRMATION | sim | nao | sim | sim | sim | MEDIUM | Manter confirmacao textual exata, role adequada e audit log. |
| GET | `/api/products/intelligent-registration/history` | `app/api/products/intelligent-registration/history/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/products/intelligent-registration/lookup` | `app/api/products/intelligent-registration/lookup/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| POST | `/api/products/internal-gtin-catalog/sync-from-products` | `app/api/products/internal-gtin-catalog/sync-from-products/route.ts` | DANGEROUS_REQUIRES_CONFIRMATION | sim | nao | nao | nao | sim | MEDIUM | Manter confirmacao textual exata, role adequada e audit log. |
| GET | `/api/publication-queue` | `app/api/publication-queue/route.ts` | EXTERNAL_WRITE_BLOCKED | sim | sim | nao | nao | nao | HIGH | Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real. |
| POST | `/api/publication-queue/[id]/cancel` | `app/api/publication-queue/[id]/cancel/route.ts` | EXTERNAL_WRITE_BLOCKED | sim | nao | nao | nao | nao | HIGH | Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real. |
| POST | `/api/publication-queue/[id]/retry` | `app/api/publication-queue/[id]/retry/route.ts` | EXTERNAL_WRITE_BLOCKED | sim | nao | nao | nao | nao | HIGH | Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real. |
| GET | `/api/reports/summary` | `app/api/reports/summary/route.ts` | AUTH_REQUIRED_READ | sim | nao | nao | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| GET | `/api/settings` | `app/api/settings/route.ts` | AUTH_REQUIRED_READ | sim | sim | sim | nao | nao | LOW | Manter leitura filtrada por organizationId e sem segredos no JSON. |
| PATCH | `/api/settings` | `app/api/settings/route.ts` | AUTH_REQUIRED_WRITE | sim | sim | sim | nao | nao | MEDIUM | Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto. |
