import { MarketplaceProvider } from "@prisma/client";
import { getProviderByCode } from "../marketplace-provider-registry";
import { createPendingProviderAdapter } from "./types";

const providerInfo = getProviderByCode(MarketplaceProvider.SHEIN);
if (!providerInfo) throw new Error("Shein provider metadata not found.");

export const sheinMarketplaceProvider = createPendingProviderAdapter(providerInfo);
