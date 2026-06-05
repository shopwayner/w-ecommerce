import { calculateAvailableQuantity } from "@/lib/utils";

export class InventorySyncService {
  calculateAvailable(physicalQuantity: number, reservedQuantity: number, safetyQuantity: number) {
    return calculateAvailableQuantity(physicalQuantity, reservedQuantity, safetyQuantity);
  }

  async importBalances() {
    throw new Error("Importacao real de saldos sera implementada na etapa de integracao.");
  }
}
