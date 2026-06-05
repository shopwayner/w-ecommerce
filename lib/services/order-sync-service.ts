export class OrderSyncService {
  async importFromBling() {
    throw new Error("Importacao real de pedidos sera implementada apos OAuth e deduplicacao persistida.");
  }

  async sendToBling() {
    throw new Error("Envio real de pedidos sera implementado com validacao Zod.");
  }
}
