# Bling OAuth

## Como Criar o App no Bling

Crie um aplicativo no painel de desenvolvedor do Bling usando OAuth 2.0 Authorization Code. Configure a Redirect URI local:

`http://localhost:3000/api/integrations/bling/callback`

## Variaveis de Ambiente

Configure no `.env` local:

- `BLING_CLIENT_ID`
- `BLING_CLIENT_SECRET`
- `BLING_REDIRECT_URI`
- `BLING_ENABLE_JWT=1`
- `APP_ENCRYPTION_KEY`

O `.env.example` deve manter apenas placeholders e valores nao sensiveis. Nunca exponha `client_secret`, tokens, authorization code, `APP_ENCRYPTION_KEY` ou `DATABASE_URL`.

## Fluxo de Conexao

1. Usuario OWNER ou ADMIN abre `/integrations`.
2. Clica em `Conectar Bling`.
3. Informa nome e tipo da conexao: Matriz, Filial ou Outra.
4. Backend valida sessao, permissao e limite do plano.
5. Backend gera `state` aleatorio, salva apenas o hash em `OAuthState` e retorna a URL do Bling.
6. Usuario autoriza no Bling.
7. Callback recebe `code` e `state`.
8. Backend valida state, troca o code imediatamente no endpoint de token usando Basic Auth `client_id:client_secret`.
9. Tokens sao criptografados com AES-256-GCM antes de salvar.
10. Sistema redireciona para `/integrations?bling=success`.

## Como Testar

- Sem credenciais Bling reais, `POST /api/integrations/bling/start` retorna erro amigavel.
- Com credenciais validas, a tela deve redirecionar para o Bling.
- Depois do callback, a conexao deve aparecer como ativa.
- `GET /api/integrations` nunca retorna token.
- Usuario VIEWER ou OPERATOR nao pode conectar, testar ou desconectar Bling.

## Renovacao de Token

`BlingApiClient` busca o token criptografado por `organizationId` e `connectionId`, descriptografa apenas em memoria e renova quando o access token esta expirado ou perto de expirar. O refresh usa Basic Auth e header `enable-jwt: 1`.

## Rate Limit

Existe um limitador em memoria de 2 requisicoes por segundo por conexao. Ele e apenas uma estrutura inicial de desenvolvimento. Para jobs grandes, substituir por Redis/BullMQ em etapa futura.

## Segurança

- Authorization code nunca vai para o frontend.
- Tokens nunca sao retornados em API.
- Tokens nunca sao salvos em texto puro.
- State e salvo como hash, expira em 10 minutos e e de uso unico.
- Callback valida state antes de criar conexao.
- APIs filtram por `organizationId`.
- AuditLog grava apenas metadados sanitizados.

## Ainda Falta

- Confirmar endpoints oficiais leves para teste definitivo de conta/empresa.
- Implementar revoke remoto se a documentacao oficial exigir.
- Criar mappers oficiais de produtos, pedidos e estoque.
- Adicionar Redis/BullMQ para filas e rate limit distribuido.
- Adicionar testes automatizados de OAuth, refresh e isolamento multi-tenant.

## Checklist Antes de Producao

- Conferir redirect URI de producao.
- Rotacionar `APP_ENCRYPTION_KEY` com plano de migracao de tokens.
- Habilitar HTTPS.
- Adicionar monitoramento de refresh token.
- Revisar escopos do aplicativo Bling.
- Validar logs para garantir ausencia de token e segredo.
