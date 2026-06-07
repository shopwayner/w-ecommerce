import { ERPProvider } from "@prisma/client";
import { getERPProviderByCode } from "../erp-provider-registry";
import { createPendingERPProviderAdapter } from "./types";

const providerInfo = getERPProviderByCode(ERPProvider.OLIST);
if (!providerInfo) throw new Error("Olist provider metadata not found.");

export const olistERPProvider = createPendingERPProviderAdapter(providerInfo);
