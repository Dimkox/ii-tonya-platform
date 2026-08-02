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

export class CallbackDataIntegrityError extends Error {
  readonly code = "callback_data_integrity";
  readonly retryable = false;

  constructor(cause?: unknown) {
    super("Callback data integrity failure", { cause });
    this.name = "CallbackDataIntegrityError";
  }
}

export class CallbackConflictError extends Error {
  readonly code = "callback_conflict";
  readonly retryable = false;

  constructor(cause?: unknown) {
    super("Callback operation conflict", { cause });
    this.name = "CallbackConflictError";
  }
}
