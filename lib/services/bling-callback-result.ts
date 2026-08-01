export type BlingCallbackResult =
  | "connected"
  | "connected-importing"
  | "connected-import-failed"
  | "reconnected"
  | "reauthorized"
  | "already-connected"
  | "wrong-account"
  | "authorization-denied"
  | "connection-error";

const callbackMessages: Record<BlingCallbackResult, string> = {
  connected: "Conta Bling conectada com sucesso.",
  "connected-importing": "Conta Bling conectada. A carga inicial dos produtos foi iniciada.",
  "connected-import-failed": "Conta Bling conectada, mas a carga inicial nao foi preparada. Use Importar do Bling para retomar.",
  reconnected: "Conta Bling reconectada com sucesso.",
  reauthorized: "Conta Bling reautorizada com sucesso.",
  "already-connected": "Esta conta Bling já está conectada.",
  "wrong-account": "Autorize a mesma conta Bling que esta sendo reconectada.",
  "authorization-denied": "A autorização da conta Bling foi cancelada.",
  "connection-error": "Não foi possível concluir a conexão Bling. Tente novamente."
};

export function parseBlingCallbackResult(value: string | null): BlingCallbackResult | null {
  return value && Object.hasOwn(callbackMessages, value)
    ? value as BlingCallbackResult
    : null;
}

export function getBlingCallbackResultMessage(result: BlingCallbackResult) {
  return callbackMessages[result];
}

export function getBlingCallbackResultPath(result: BlingCallbackResult) {
  return `/erps?bling=${encodeURIComponent(result)}`;
}
