import { ERPProvider } from "@prisma/client";
import { getERPProviderByCode } from "../erp-provider-registry";
import { createPendingERPProviderAdapter } from "./types";

const providerInfo = getERPProviderByCode(ERPProvider.BLING);
if (!providerInfo) throw new Error("Bling provider metadata not found.");

export const blingERPProvider = createPendingERPProviderAdapter(providerInfo);
