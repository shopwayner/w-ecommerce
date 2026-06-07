import { MarketplaceProvider } from "@prisma/client";
import { getProviderByCode } from "../marketplace-provider-registry";
import { createPendingProviderAdapter } from "./types";

const providerInfo = getProviderByCode(MarketplaceProvider.SHOPEE_ADS);
if (!providerInfo) throw new Error("Shopee ADS provider metadata not found.");

export const shopeeAdsMarketplaceProvider = createPendingProviderAdapter(providerInfo);
