export const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  APP_URL: process.env.APP_URL,
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
  AUTH_SECRET: process.env.AUTH_SECRET,
  BLING_ENABLED: process.env.BLING_ENABLED ?? "false",
  BLING_CLIENT_ID: process.env.BLING_CLIENT_ID,
  BLING_CLIENT_SECRET: process.env.BLING_CLIENT_SECRET,
  BLING_REDIRECT_URI: process.env.BLING_REDIRECT_URI,
  BLING_ENABLE_JWT: process.env.BLING_ENABLE_JWT ?? "1",
  BLING_API_BASE_URL: process.env.BLING_API_BASE_URL ?? "https://api.bling.com.br/Api/v3",
  BLING_TOKEN_URL: process.env.BLING_TOKEN_URL ?? "https://api.bling.com.br/Api/v3/oauth/token"
};
