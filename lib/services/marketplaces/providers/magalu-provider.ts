import { MarketplaceProvider } from "@prisma/client";
import { getProviderByCode } from "../marketplace-provider-registry";
import { createPendingProviderAdapter } from "./types";

const providerInfo = getProviderByCode(MarketplaceProvider.MAGALU);
if (!providerInfo) throw new Error("Magalu provider metadata not found.");

export const magaluMarketplaceProvider = createPendingProviderAdapter(providerInfo);
