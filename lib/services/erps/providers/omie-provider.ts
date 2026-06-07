import { ERPProvider } from "@prisma/client";
import { getERPProviderByCode } from "../erp-provider-registry";
import { createPendingERPProviderAdapter } from "./types";

const providerInfo = getERPProviderByCode(ERPProvider.OMIE);
if (!providerInfo) throw new Error("Omie provider metadata not found.");

export const omieERPProvider = createPendingERPProviderAdapter(providerInfo);
