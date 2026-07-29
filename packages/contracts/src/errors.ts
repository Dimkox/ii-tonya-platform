export class CallbackInfrastructureError extends Error {
  readonly code = "callback_store_unavailable";
  readonly retryable = true;

  constructor(
    code: "callback_store_unavailable" = "callback_store_unavailable",
    cause?: unknown,
  ) {
    super("Callback store unavailable", { cause });
    this.name = "CallbackInfrastructureError";
    this.code = code;
  }
}
