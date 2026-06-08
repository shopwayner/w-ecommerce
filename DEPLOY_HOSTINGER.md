# Deploy Hostinger

Guia de preparação para publicar o Matrix Commerce Hub a partir do GitHub em uma aplicação Node.js da Hostinger.

## 1. GitHub

1. Antes de subir código, rode as validações locais:
   ```powershell
   npm.cmd run lint
   npm.cmd run build
   npx.cmd prisma validate
   npx.cmd prisma migrate status
   ```
2. Confirme que `.env`, `.env.*`, `node_modules/`, `.next/`, `dist/` e `build/` não estão versionados.
3. Faça commit das alterações validadas.
4. Faça push somente depois de confirmar que nenhum segredo real foi versionado.

## 2. Hostinger Node.js Web App

Configuração sugerida para a aplicação Node.js:

- Runtime: Node.js compatível com Next.js 15.
- Build command:
  ```bash
  npm install
  npx prisma generate
  npm run build
  ```
- Start command:
  ```bash
  npm run start -- -p $PORT
  ```

O script `start` do projeto usa `next start`, então a porta da Hostinger deve ser repassada por `$PORT`.

## 2.1. VPS Hostinger com Docker Compose

Use este fluxo quando a VPS Hostinger estiver em Ubuntu 24.04 com Docker e Docker Compose.

Arquivos de deploy versionados:

- `Dockerfile`
- `docker-compose.prod.yml`
- `.dockerignore`

Arquivo que deve existir somente na VPS:

- `.env.production`

Passos na VPS:

```bash
git clone <URL_DO_REPOSITORIO>
cd <PASTA_DO_PROJETO>
cp .env.example .env.production
nano .env.production
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d app
```

O container da aplicação executa automaticamente:

```bash
npx prisma migrate deploy
npm run start -- -p ${PORT:-3000}
```

Não rode `prisma migrate dev` nem seed em produção.

### Usando banco PostgreSQL externo

Configure `DATABASE_URL` no `.env.production` apontando para o banco externo e suba apenas o app:

```bash
docker compose -f docker-compose.prod.yml up -d app
```

### Usando PostgreSQL do próprio Compose

Se quiser usar o PostgreSQL opcional do compose, preencha no `.env.production`:

```bash
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
DATABASE_URL=postgresql://POSTGRES_USER:POSTGRES_PASSWORD@postgres:5432/POSTGRES_DB
```

Suba o banco e a aplicação com o profile `postgres`:

```bash
docker compose -f docker-compose.prod.yml --profile postgres up -d postgres
docker compose -f docker-compose.prod.yml --profile postgres up -d app
```

Para acompanhar logs:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

Para atualizar depois de um novo push:

```bash
git pull
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
```

## 3. Variáveis de ambiente

Configure as variáveis no painel da Hostinger. Não coloque valores reais no repositório.

Obrigatórias para produção:

- `DATABASE_URL`
- `APP_URL`
- `APP_ENCRYPTION_KEY`
- `AUTH_SECRET`

Obrigatórias quando usar PostgreSQL do compose:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

Redis e filas, quando habilitados:

- `REDIS_URL`

Bling:

- `BLING_CLIENT_ID`
- `BLING_CLIENT_SECRET`
- `BLING_REDIRECT_URI`
- `BLING_ENABLE_JWT`
- `BLING_API_BASE_URL`
- `BLING_TEST_PATH`

Marketplaces e ERPs, conforme integrações ativadas:

- `MERCADOLIVRE_CLIENT_ID`
- `MERCADOLIVRE_CLIENT_SECRET`
- `MERCADOLIVRE_REDIRECT_URI`
- `MERCADOLIVRE_ACCESS_TOKEN`
- `MERCADOLIVRE_REFRESH_TOKEN`
- `MERCADOLIVRE_SITE_ID`
- `MAGALU_CLIENT_ID`
- `MAGALU_CLIENT_SECRET`
- `MAGALU_REDIRECT_URI`
- `MAGALU_ENVIRONMENT`
- `SHOPEE_PARTNER_ID`
- `SHOPEE_PARTNER_KEY`
- `SHOPEE_REDIRECT_URI`
- `SHOPEE_REGION`
- `SHOPEE_ADS_PARTNER_ID`
- `SHOPEE_ADS_PARTNER_KEY`
- `SHOPEE_ADS_REDIRECT_URI`
- `AMAZON_SP_API_LWA_CLIENT_ID`
- `AMAZON_SP_API_LWA_CLIENT_SECRET`
- `AMAZON_SP_API_REFRESH_TOKEN`
- `AMAZON_SP_API_MARKETPLACE_ID`
- `AMAZON_SP_API_REGION`
- `AMAZON_SP_API_SELLER_ID`
- `AMAZON_SP_API_AWS_ACCESS_KEY_ID`
- `AMAZON_SP_API_AWS_SECRET_ACCESS_KEY`
- `AMAZON_SP_API_AWS_ROLE_ARN`
- `SHEIN_OPEN_KEY_ID`
- `SHEIN_SECRET_KEY`
- `SHEIN_SELLER_ID`
- `SHEIN_SHOP_ID`
- `SHEIN_REGION`
- `TIKTOK_SHOP_APP_KEY`
- `TIKTOK_SHOP_APP_SECRET`
- `TIKTOK_SHOP_REDIRECT_URI`
- `TIKTOK_SHOP_REGION`
- `OLIST_API_TOKEN`
- `OLIST_API_VERSION`
- `OMIE_APP_KEY`
- `OMIE_APP_SECRET`
- `CONTA_AZUL_CLIENT_ID`
- `CONTA_AZUL_CLIENT_SECRET`
- `CONTA_AZUL_REDIRECT_URI`
- `CUSTOM_API_BASE_URL`
- `CUSTOM_API_AUTH_TYPE`
- `CUSTOM_API_TOKEN`

Enriquecimento e IA:

- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_ENGINE_ID`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_ENABLED`
- `OPENAI_MAX_OUTPUT_TOKENS`

Armazenamento, se usado:

- `STORAGE_ENDPOINT`
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`
- `STORAGE_BUCKET`

Seed local apenas, não usar em produção:

- `MASTER_ADMIN_EMAIL`
- `MASTER_ADMIN_PASSWORD`
- `ADMIN_LOCAL_PASSWORD`
- `VIEWER_LOCAL_PASSWORD`

## 4. Banco de dados e Prisma

1. Produção deve apontar `DATABASE_URL` para o banco PostgreSQL da Hostinger ou serviço externo.
2. Antes do primeiro start em produção, aplique migrations com:
   ```bash
   npx prisma migrate deploy
   ```
3. Gere o Prisma Client no build:
   ```bash
   npx prisma generate
   ```
4. Não rode `prisma migrate dev` em produção.
5. Não rode seed em produção sem autorização. O seed local pode apagar dados de negócio da organização master.

## 5. Cuidados antes do deploy

- Não versionar `.env` real.
- Não registrar tokens, secrets ou `DATABASE_URL` em logs.
- Conferir se o painel da Hostinger injeta `$PORT`.
- Confirmar que o domínio final está refletido em `APP_URL` e nos redirect URIs de OAuth.
- Confirmar que migrations foram aplicadas antes de liberar tráfego.
