export class PublicationQueueService {
  async enqueue() {
    throw new Error("Fila BullMQ sera conectada ao Redis na proxima etapa.");
  }

  async retry() {
    throw new Error("Retry real sera implementado com backoff e auditoria.");
  }
}
