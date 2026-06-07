import type { ERPProviderInfo } from "../erp-provider-registry";

export type ERPProviderAdapter = {
  getProviderInfo(): ERPProviderInfo;
  validateConfig(credentials: Record<string, string>): void;
  getAuthUrl(): Promise<null>;
  handleCallback(): Promise<null>;
  refreshToken(): Promise<null>;
  testConnection(): Promise<{ ok: false; message: string }>;
  disconnect(): Promise<{ ok: true }>;
  getSafeConnectionStatus(): Promise<null>;
};

export function createPendingERPProviderAdapter(providerInfo: ERPProviderInfo): ERPProviderAdapter {
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
      return { ok: false, message: providerInfo.testPendingMessage };
    },
    async disconnect() {
      return { ok: true };
    },
    async getSafeConnectionStatus() {
      return null;
    }
  };
}
