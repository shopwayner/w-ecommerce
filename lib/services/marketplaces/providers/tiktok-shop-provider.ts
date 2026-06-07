import { MarketplaceProvider } from "@prisma/client";
import { getProviderByCode } from "../marketplace-provider-registry";
import { createPendingProviderAdapter } from "./types";

const providerInfo = getProviderByCode(MarketplaceProvider.TIKTOK_SHOP);
if (!providerInfo) throw new Error("TikTok Shop provider metadata not found.");

export const tiktokShopMarketplaceProvider = createPendingProviderAdapter(providerInfo);
