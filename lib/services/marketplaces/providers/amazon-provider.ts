import { MarketplaceProvider } from "@prisma/client";
import { getProviderByCode } from "../marketplace-provider-registry";
import { createPendingProviderAdapter } from "./types";

const providerInfo = getProviderByCode(MarketplaceProvider.AMAZON);
if (!providerInfo) throw new Error("Amazon provider metadata not found.");

export const amazonMarketplaceProvider = createPendingProviderAdapter(providerInfo);
