import { ERPProvider } from "@prisma/client";

export type ERPField = {
  key: string;
  label: string;
  type?: "text" | "password" | "url" | "select";
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

export type ERPProviderInfo = {
  provider: ERPProvider;
  slug: string;
  name: string;
  supportsOAuth: boolean;
  authUrlImplemented: boolean;
  defaultValues: Record<string, string>;
  credentialFields: ERPField[];
  testPendingMessage: string;
};

const environmentOptions = [
  { label: "Produção", value: "production" },
  { label: "Sandbox", value: "sandbox" }
];

export const erpProviders: ERPProviderInfo[] = [
  {
    provider: ERPProvider.BLING,
    slug: "bling",
    name: "Bling",
    supportsOAuth: true,
    authUrlImplemented: true,
    defaultValues: { environment: "production" },
    testPendingMessage: "Configuração salva. Teste real do Bling usa a conexão OAuth ativa quando autorizada.",
    credentialFields: [
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, secret: true },
      { key: "redirectUri", label: "Redirect URI", type: "url", required: true },
      { key: "tokenExpiration", label: "Token Expiration" }
    ]
  },
  {
    provider: ERPProvider.OLIST,
    slug: "olist",
    name: "Olist",
    supportsOAuth: false,
    authUrlImplemented: false,
    defaultValues: { environment: "production", apiVersion: "API V3" },
    testPendingMessage: "Configuração salva. Teste real da API Olist será validado na próxima etapa.",
    credentialFields: [
      { key: "apiToken", label: "Token API", type: "password", required: true, secret: true },
      { key: "accountId", label: "Identificação da conta/empresa" },
      { key: "apiVersion", label: "API version", type: "select", options: [{ label: "API 2.0", value: "API 2.0" }, { label: "API V3", value: "API V3" }] },
      { key: "environment", label: "Ambiente", type: "select", options: environmentOptions }
    ]
  },
  {
    provider: ERPProvider.OMIE,
    slug: "omie",
    name: "Omie",
    supportsOAuth: false,
    authUrlImplemented: false,
    defaultValues: { environment: "production" },
    testPendingMessage: "Configuração salva. Teste real da API Omie será validado na próxima etapa.",
    credentialFields: [
      { key: "appKey", label: "App Key", type: "password", required: true, secret: true },
      { key: "appSecret", label: "App Secret", type: "password", required: true, secret: true },
      { key: "environment", label: "Ambiente", type: "select", options: environmentOptions }
    ]
  },
  {
    provider: ERPProvider.CONTA_AZUL,
    slug: "conta-azul",
    name: "Conta Azul",
    supportsOAuth: true,
    authUrlImplemented: false,
    defaultValues: { environment: "production" },
    testPendingMessage: "Configuração salva. Teste real da Conta Azul será validado quando o OAuth oficial for concluído.",
    credentialFields: [
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, secret: true },
      { key: "redirectUri", label: "Redirect URI", type: "url", required: true },
      { key: "tokenExpiration", label: "Token Expiration" }
    ]
  },
  {
    provider: ERPProvider.CUSTOM_API,
    slug: "custom-api",
    name: "API personalizada",
    supportsOAuth: false,
    authUrlImplemented: false,
    defaultValues: { authType: "none", testMethod: "GET" },
    testPendingMessage: "Configuração salva. Teste real da API personalizada será validado com chamada segura na próxima etapa.",
    credentialFields: [
      { key: "integrationName", label: "Nome da integração", required: true },
      { key: "baseUrl", label: "Base URL", type: "url", required: true },
      { key: "authType", label: "Método de autenticação", type: "select", options: [{ label: "Nenhuma", value: "none" }, { label: "Bearer Token", value: "bearer" }, { label: "API Key Header", value: "api_key_header" }, { label: "Basic Auth", value: "basic" }] },
      { key: "apiKeyHeader", label: "Header da API Key" },
      { key: "apiKey", label: "API Key", type: "password", secret: true },
      { key: "bearerToken", label: "Bearer Token", type: "password", secret: true },
      { key: "basicUser", label: "Usuário Basic Auth", secret: true },
      { key: "basicPassword", label: "Senha Basic Auth", type: "password", secret: true },
      { key: "testUrl", label: "URL de teste de conexão", type: "url" },
      { key: "testMethod", label: "Método de teste", type: "select", options: [{ label: "GET", value: "GET" }, { label: "POST", value: "POST" }] },
      { key: "additionalHeaders", label: "Headers adicionais em JSON" }
    ]
  }
];

export function getERPProviderBySlug(slug: string) {
  return erpProviders.find((provider) => provider.slug === slug) ?? null;
}

export function getERPProviderByCode(provider: ERPProvider) {
  return erpProviders.find((item) => item.provider === provider) ?? null;
}
