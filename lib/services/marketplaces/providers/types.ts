import type { MarketplaceProviderInfo } from "../marketplace-provider-registry";

export type MarketplaceProviderAdapter = {
  getProviderInfo(): MarketplaceProviderInfo;
  validateConfig(credentials: Record<string, string>): void;
  getAuthUrl(): Promise<null>;
  handleCallback(): Promise<null>;
  refreshToken(): Promise<null>;
  testConnection(): Promise<{ ok: false; message: string }>;
  disconnect(): Promise<{ ok: true }>;
  getSafeConnectionStatus(): Promise<null>;
};

export function createPendingProviderAdapter(providerInfo: MarketplaceProviderInfo): MarketplaceProviderAdapter {
  return {
    getProviderInfo: () => providerInfo,
    validateConfig() {
      return undefined;
    },
    async getAuthUrl() {
      return null;
    },
    async handleCallback() {
      return null;
    },
    async refreshToken() {
      return null;
    },
    async testConnection() {
      return { ok: false, message: "Teste real ainda depende da implementação do provider oficial." };
    },
    async disconnect() {
      return { ok: true };
    },
    async getSafeConnectionStatus() {
      return null;
    }
  };
}
