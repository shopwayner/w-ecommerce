export type BlingCallbackResult =
  | "connected"
  | "reconnected"
  | "already-connected"
  | "wrong-account"
  | "authorization-denied"
  | "connection-error";

const callbackMessages: Record<BlingCallbackResult, string> = {
  connected: "Conta Bling conectada com sucesso.",
  reconnected: "Conta Bling reconectada com sucesso.",
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
