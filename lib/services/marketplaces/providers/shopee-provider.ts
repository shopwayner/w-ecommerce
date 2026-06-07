import { MarketplaceProvider } from "@prisma/client";
import { getProviderByCode } from "../marketplace-provider-registry";
import { createPendingProviderAdapter } from "./types";

const providerInfo = getProviderByCode(MarketplaceProvider.SHOPEE);
if (!providerInfo) throw new Error("Shopee provider metadata not found.");

export const shopeeMarketplaceProvider = createPendingProviderAdapter(providerInfo);
