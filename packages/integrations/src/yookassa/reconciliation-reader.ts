import type { YooKassaClient } from "./client.js";
import type { YooKassaMode } from "./contracts.js";

const MAX_BATCH_SIZE = 100;
const MAX_CONCURRENT_READS = 4;
const MINOR_RUB = /^((?:0|[1-9]\d*))\.(\d{2})$/u;
const LOCAL_MINOR = /^(?:0|[1-9]\d{0,11})$/u;

export interface YooKassaLocalReconciliationPayment {
  readonly provider: string;
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
}

export interface YooKassaReconciliationReadCommand {
  readonly now: Date;
  readonly payments: readonly YooKassaLocalReconciliationPayment[];
}

export interface YooKassaReconciliationSnapshot {
  readonly provider: "yookassa";
  readonly paymentId: string;
  readonly amountMinor: string;
  readonly currency: "RUB";
  readonly status: "settled";
}

const minorFromRub = (value: string): string => {
  const match = MINOR_RUB.exec(value);
  if (match === null)
    throw new Error("yookassa_reconciliation_binding_mismatch");
  return (BigInt(match[1]!) * 100n + BigInt(match[2]!)).toString();
};

const validateBatch = (command: YooKassaReconciliationReadCommand): void => {
  if (
    !Number.isFinite(command.now.getTime()) ||
    command.payments.length > MAX_BATCH_SIZE
  ) {
    throw new Error("yookassa_reconciliation_batch_invalid");
  }
  const identifiers = new Set<string>();
  for (const payment of command.payments) {
    if (payment.provider !== "yookassa") {
      throw new Error("yookassa_reconciliation_provider_invalid");
    }
    if (
      payment.paymentId.length === 0 ||
      payment.paymentId.length > 64 ||
      !LOCAL_MINOR.test(payment.amountMinor) ||
      payment.currency !== "RUB"
    ) {
      throw new Error("yookassa_reconciliation_payment_invalid");
    }
    if (identifiers.has(payment.paymentId)) {
      throw new Error("yookassa_reconciliation_duplicate_payment");
    }
    identifiers.add(payment.paymentId);
  }
};

export class YooKassaExpertResidencyProviderReader {
  constructor(
    private readonly client: Pick<YooKassaClient, "getPayment">,
    private readonly mode: YooKassaMode,
  ) {}

  async readPayments(command: YooKassaReconciliationReadCommand): Promise<{
    readonly kind: "available";
    readonly payments: readonly YooKassaReconciliationSnapshot[];
  }> {
    validateBatch(command);
    const snapshots: YooKassaReconciliationSnapshot[] = new Array(
      command.payments.length,
    );
    let nextIndex = 0;
    const readNext = async (): Promise<void> => {
      while (nextIndex < command.payments.length) {
        const index = nextIndex;
        nextIndex += 1;
        const local = command.payments[index]!;
        const provider = await this.client.getPayment(local.paymentId);
        if (
          provider.id !== local.paymentId ||
          provider.amount.currency !== local.currency ||
          minorFromRub(provider.amount.value) !== local.amountMinor ||
          provider.test !== (this.mode === "test") ||
          provider.status !== "succeeded" ||
          !provider.paid
        ) {
          throw new Error("yookassa_reconciliation_binding_mismatch");
        }
        snapshots[index] = {
          provider: "yookassa",
          paymentId: local.paymentId,
          amountMinor: local.amountMinor,
          currency: "RUB",
          status: "settled",
        };
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_READS, command.payments.length) },
        () => readNext(),
      ),
    );
    return { kind: "available", payments: snapshots };
  }
}
