import { ERPProvider } from "@prisma/client";
import { getERPProviderByCode } from "../erp-provider-registry";
import { createPendingERPProviderAdapter } from "./types";

const providerInfo = getERPProviderByCode(ERPProvider.CONTA_AZUL);
if (!providerInfo) throw new Error("Conta Azul provider metadata not found.");

export const contaAzulERPProvider = createPendingERPProviderAdapter(providerInfo);
