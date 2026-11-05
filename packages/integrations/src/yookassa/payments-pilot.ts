/**
 * SCRUM-518 guarded payments pilot. Every checkout path that may create a
 * YooKassa payment must call this before the provider request. With a pilot
 * configured, only the single allow-listed principal may pay, and only up to
 * the cap. Without a pilot it does not restrict (prod requires the pilot via
 * scripts/validate-runtime-env.sh).
 */
export interface PaymentsPilotPolicy {
  readonly principalId: string;
  readonly maxAmountMinor: bigint;
}

export class PaymentsPilotRefusedError extends Error {
  constructor(readonly reason: "principal" | "amount") {
    super(`payments_pilot_refused:${reason}`);
    this.name = "PaymentsPilotRefusedError";
  }
}

export function assertPaymentsPilotAllowed(
  pilot: PaymentsPilotPolicy | undefined,
  attempt: { readonly principalId: string; readonly amountMinor: bigint },
): void {
  if (pilot === undefined) return;
  if (attempt.principalId !== pilot.principalId)
    throw new PaymentsPilotRefusedError("principal");
  if (attempt.amountMinor <= 0n || attempt.amountMinor > pilot.maxAmountMinor)
    throw new PaymentsPilotRefusedError("amount");
}
