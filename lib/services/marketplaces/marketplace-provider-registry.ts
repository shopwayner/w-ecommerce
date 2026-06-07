import { MarketplaceProvider } from "@prisma/client";

export type MarketplaceField = {
  key: string;
  label: string;
  type?: "text" | "password" | "url" | "select";
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

export type MarketplaceProviderInfo = {
  provider: MarketplaceProvider;
  slug: string;
  name: string;
  supportsOAuth: boolean;
  authUrlImplemented: boolean;
  approvalHint?: string;
  defaultValues: Record<string, string>;
  credentialFields: MarketplaceField[];
};

const commonEnvironmentOptions = [
  { label: "Produção", value: "production" },
  { label: "Sandbox", value: "sandbox" }
];

export const marketplaceProviders: MarketplaceProviderInfo[] = [
  {
    provider: MarketplaceProvider.MERCADOLIVRE,
    slug: "mercadolivre",
    name: "Mercado Livre",
    supportsOAuth: true,
    authUrlImplemented: true,
    defaultValues: { siteId: "MLB" },
    credentialFields: [
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, secret: true },
      { key: "redirectUri", label: "Redirect URI", type: "url", required: true },
      { key: "siteId", label: "Site ID", required: true, placeholder: "MLB" }
    ]
  },
  {
    provider: MarketplaceProvider.MAGALU,
    slug: "magalu",
    name: "Magalu",
    supportsOAuth: true,
    authUrlImplemented: false,
    defaultValues: { environment: "production" },
    credentialFields: [
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, secret: true },
      { key: "redirectUri", label: "Redirect URI", type: "url" },
      { key: "sellerId", label: "Seller ID / Account ID" },
      { key: "environment", label: "Environment", type: "select", options: commonEnvironmentOptions },
      { key: "scopes", label: "Scopes" }
    ]
  },
  {
    provider: MarketplaceProvider.SHOPEE,
    slug: "shopee",
    name: "Shopee",
    supportsOAuth: true,
    authUrlImplemented: false,
    defaultValues: { region: "BR" },
    credentialFields: [
      { key: "partnerId", label: "Partner ID", required: true },
      { key: "partnerKey", label: "Partner Key", type: "password", required: true, secret: true },
      { key: "redirectUri", label: "Redirect URI", type: "url" },
      { key: "shopId", label: "Shop ID" },
      { key: "merchantId", label: "Merchant ID" },
      { key: "region", label: "Region / Site", placeholder: "BR" },
      { key: "tokenExpiration", label: "Token Expiration" }
    ]
  },
  {
    provider: MarketplaceProvider.SHOPEE_ADS,
    slug: "shopee-ads",
    name: "Shopee ADS",
    supportsOAuth: true,
    authUrlImplemented: false,
    defaultValues: { region: "BR" },
    credentialFields: [
      { key: "partnerId", label: "Partner ID", required: true },
      { key: "partnerKey", label: "Partner Key", type: "password", required: true, secret: true },
      { key: "advertiserId", label: "Advertiser ID" },
      { key: "shopId", label: "Shop ID" },
      { key: "redirectUri", label: "Redirect URI", type: "url" }
    ]
  },
  {
    provider: MarketplaceProvider.AMAZON,
    slug: "amazon",
    name: "Amazon",
    supportsOAuth: false,
    authUrlImplemented: false,
    approvalHint: "Pode exigir aprovação SP-API e autorização do vendedor.",
    defaultValues: { environment: "production", region: "NA" },
    credentialFields: [
      { key: "lwaClientId", label: "LWA Client ID", required: true },
      { key: "lwaClientSecret", label: "LWA Client Secret", type: "password", required: true, secret: true },
      { key: "refreshToken", label: "Refresh Token", type: "password", secret: true },
      { key: "marketplaceId", label: "Marketplace ID" },
      { key: "region", label: "Region" },
      { key: "sellerId", label: "Seller ID" },
      { key: "awsAccessKeyId", label: "AWS Access Key ID" },
      { key: "awsSecretAccessKey", label: "AWS Secret Access Key", type: "password", secret: true },
      { key: "awsRoleArn", label: "AWS Role ARN" },
      { key: "environment", label: "Environment", type: "select", options: commonEnvironmentOptions }
    ]
  },
  {
    provider: MarketplaceProvider.SHEIN,
    slug: "shein",
    name: "Shein",
    supportsOAuth: true,
    authUrlImplemented: false,
    approvalHint: "Pode exigir aprovação/revisão do app antes de liberar API.",
    defaultValues: { region: "BR" },
    credentialFields: [
      { key: "openKeyId", label: "Open Key ID / App Key", required: true },
      { key: "secretKey", label: "Secret Key / App Secret", type: "password", required: true, secret: true },
      { key: "sellerId", label: "Seller ID" },
      { key: "shopId", label: "Shop ID" },
      { key: "region", label: "Region" },
      { key: "redirectUri", label: "Redirect URI", type: "url" }
    ]
  },
  {
    provider: MarketplaceProvider.TIKTOK_SHOP,
    slug: "tiktok-shop",
    name: "TikTok Shop",
    supportsOAuth: true,
    authUrlImplemented: false,
    defaultValues: { region: "BR" },
    credentialFields: [
      { key: "appKey", label: "App Key", required: true },
      { key: "appSecret", label: "App Secret", type: "password", required: true, secret: true },
      { key: "redirectUri", label: "Redirect URI", type: "url" },
      { key: "shopId", label: "Shop ID" },
      { key: "sellerId", label: "Seller ID" },
      { key: "region", label: "Region" },
      { key: "tokenExpiration", label: "Token Expiration" }
    ]
  }
];

export function getProviderBySlug(slug: string) {
  return marketplaceProviders.find((provider) => provider.slug === slug) ?? null;
}

export function getProviderByCode(provider: MarketplaceProvider) {
  return marketplaceProviders.find((item) => item.provider === provider) ?? null;
}
