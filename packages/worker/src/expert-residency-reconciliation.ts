export type ExpertResidencyPaymentStatus =
  | "settled"
  | "refunded"
  | "charged_back";

export interface ExpertResidencyLocalPayment {
  readonly orderId: string;
  readonly provider: string;
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly status: ExpertResidencyPaymentStatus;
}

export interface ExpertResidencyProviderPayment {
  readonly provider: string;
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly status: ExpertResidencyPaymentStatus;
}

export interface ExpertResidencyReconciliationMismatch {
  readonly orderId: string;
  readonly provider: string;
  readonly paymentId: string;
  readonly reason: "missing" | "status" | "amount" | "currency";
  readonly localStatus: ExpertResidencyPaymentStatus;
  readonly providerStatus?: ExpertResidencyPaymentStatus;
}

export interface ExpertResidencyReconciliationRepository {
  listReconciliationBatch(command: {
    readonly now: Date;
    readonly batchSize: number;
  }): Promise<readonly ExpertResidencyLocalPayment[]>;
  recordReconciliationMismatches(
    mismatches: readonly ExpertResidencyReconciliationMismatch[],
  ): Promise<void>;
}

export interface ExpertResidencyProviderReader {
  readPayments(command: {
    readonly now: Date;
    readonly payments: readonly ExpertResidencyLocalPayment[];
  }): Promise<
    | { readonly kind: "disabled" }
    | {
        readonly kind: "available";
        readonly payments: readonly ExpertResidencyProviderPayment[];
      }
  >;
}

export interface ExpertResidencyReconciliationResult {
  readonly examined: number;
  readonly matched: number;
  readonly mismatches: number;
  readonly provider: "available" | "disabled";
}

const money = /^(?:0|[1-9][0-9]{0,11})$/u;

function assertInput(now: Date, batchSize: number): void {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1_000
  ) {
    throw new Error("invalid_expert_residency_reconciliation_input");
  }
}

function paymentKey(provider: string, paymentId: string): string {
  return `${provider}\u0000${paymentId}`;
}

function validProviderPayment(payment: ExpertResidencyProviderPayment): boolean {
  return (
    payment.provider.trim().length > 0 &&
    payment.provider.length <= 64 &&
    payment.paymentId.trim().length > 0 &&
    payment.paymentId.length <= 256 &&
    money.test(payment.amountMinor) &&
    payment.currency === "RUB" &&
    ["settled", "refunded", "charged_back"].includes(payment.status)
  );
}

export async function reconcileExpertResidencyPayments(
  repo: ExpertResidencyReconciliationRepository,
  provider: ExpertResidencyProviderReader,
  now: Date,
  batchSize: number,
): Promise<ExpertResidencyReconciliationResult> {
  assertInput(now, batchSize);
  const local = await repo.listReconciliationBatch({ now, batchSize });
  const external = await provider.readPayments({ now, payments: local });
  if (external.kind === "disabled") {
    return {
      examined: local.length,
      matched: 0,
      mismatches: 0,
      provider: "disabled",
    };
  }

  const byPayment = new Map<string, ExpertResidencyProviderPayment>();
  for (const payment of external.payments) {
    if (!validProviderPayment(payment)) {
      throw new Error("invalid_expert_residency_provider_payment");
    }
    const key = paymentKey(payment.provider, payment.paymentId);
    if (byPayment.has(key)) {
      throw new Error("duplicate_expert_residency_provider_payment");
    }
    byPayment.set(key, payment);
  }

  const mismatches: ExpertResidencyReconciliationMismatch[] = [];
  let matched = 0;
  for (const payment of local) {
    const observed = byPayment.get(paymentKey(payment.provider, payment.paymentId));
    if (observed === undefined) {
      mismatches.push({
        orderId: payment.orderId,
        provider: payment.provider,
        paymentId: payment.paymentId,
        reason: "missing",
        localStatus: payment.status,
      });
      continue;
    }
    const reason =
      observed.status !== payment.status
        ? "status"
        : observed.amountMinor !== payment.amountMinor
          ? "amount"
          : observed.currency !== payment.currency
            ? "currency"
            : undefined;
    if (reason === undefined) {
      matched += 1;
      continue;
    }
    mismatches.push({
      orderId: payment.orderId,
      provider: payment.provider,
      paymentId: payment.paymentId,
      reason,
      localStatus: payment.status,
      providerStatus: observed.status,
    });
  }

  if (mismatches.length > 0) {
    await repo.recordReconciliationMismatches(mismatches);
  }
  return {
    examined: local.length,
    matched,
    mismatches: mismatches.length,
    provider: "available",
  };
}
