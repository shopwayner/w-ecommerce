export class ConfirmationError extends Error {
  constructor(
    public readonly requiredConfirm: string,
    message = "Confirmacao textual obrigatoria invalida."
  ) {
    super(message);
  }
}

export function requireConfirmation(value: unknown, requiredConfirm: string) {
  if (typeof value !== "string" || value !== requiredConfirm) {
    throw new ConfirmationError(requiredConfirm);
  }

  return value;
}

