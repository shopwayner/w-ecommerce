import { ERPProvider } from "@prisma/client";
import { getERPProviderByCode } from "../erp-provider-registry";
import { createPendingERPProviderAdapter } from "./types";

const providerInfo = getERPProviderByCode(ERPProvider.CUSTOM_API);
if (!providerInfo) throw new Error("Custom API provider metadata not found.");

export const customApiERPProvider = createPendingERPProviderAdapter(providerInfo);
