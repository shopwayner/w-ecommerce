import { MarketplaceProvider } from "@prisma/client";
import { getProviderByCode } from "../marketplace-provider-registry";
import { createPendingProviderAdapter } from "./types";

const providerInfo = getProviderByCode(MarketplaceProvider.MERCADOLIVRE);
if (!providerInfo) throw new Error("Mercado Livre provider metadata not found.");

export const mercadoLivreMarketplaceProvider = createPendingProviderAdapter(providerInfo);
