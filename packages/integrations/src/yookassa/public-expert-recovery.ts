import { createHash } from "node:crypto";
import type { YooKassaPayment, YooKassaRefund } from "./contracts.js";
import type { PublicExpertGatewayTransport } from "./public-expert-gateway.js";
import {
  publicExpertVerifiedObservationSchema,
  type PublicExpertPaymentSnapshot,
  type PublicExpertVerifiedObservation,
} from "./public-expert-gateway-contracts.js";

const verified = new WeakSet<object>();
export type PublicExpertFreshObservation = PublicExpertVerifiedObservation & {
  readonly __publicFreshObservation: unique symbol;
};
export function assertPublicExpertFreshObservation(
  value: PublicExpertVerifiedObservation,
): asserts value is PublicExpertFreshObservation {
  if (!verified.has(value)) throw Error("public_fresh_get_required");
}
export interface PublicExpertRecoveryBinder {
  candidate(requestId: string): Promise<PublicExpertPaymentSnapshot | null>;
  bind(
    requestId: string,
    observation: PublicExpertFreshObservation,
  ): Promise<PublicExpertPaymentSnapshot | null>;
}
export interface PublicExpertObservationWriter {
  observe(observation: PublicExpertFreshObservation): Promise<string | null>;
}
export type PublicExpertRecoveryTransport = Pick<
  PublicExpertGatewayTransport,
  "getPayment" | "getRefund" | "listPayments" | "listRefunds"
>;
export type PublicExpertRecoveryResult =
  | { readonly kind: "pending" | "unavailable" }
  | {
      readonly kind: "observed";
      readonly snapshot: PublicExpertPaymentSnapshot;
      readonly observation: PublicExpertFreshObservation;
      readonly observationId: string;
      readonly confirmationUrl?: string;
    };
const amountMinor = (v: string) =>
  /^\d+\.\d{2}$/u.test(v) ? BigInt(v.replace(".", "")).toString() : null;
const purpose = (s: PublicExpertPaymentSnapshot) =>
  s.product === "onboarding"
    ? "onboarding"
    : s.product === "main"
      ? "main_residency"
      : "public_main_refund";
function matches(
  s: PublicExpertPaymentSnapshot,
  p: YooKassaPayment | YooKassaRefund,
) {
  const m = p.metadata;
  return (
    m !== undefined &&
    Object.keys(m).length === 4 &&
    m.purpose === purpose(s) &&
    m.operation_id === s.legacyOperationId &&
    m.order_id === s.legacySourceId &&
    m.user_id === s.userId &&
    amountMinor(p.amount.value) === s.amountMinor &&
    p.amount.currency === s.currency &&
    ("test" in p
      ? p.test === (s.mode === "test")
      : p.paymentId === s.parentPaymentId) &&
    (s.kind === "onboarding_capture" ||
      s.kind === "onboarding_cancel" ||
      Date.parse(p.createdAt) >= Date.parse(s.createdAt) - 60_000)
  );
}
function redirect(
  payment: YooKassaPayment | YooKassaRefund,
): string | undefined {
  if (
    !("test" in payment) ||
    payment.status !== "pending" ||
    !payment.confirmation
  )
    return undefined;
  const url = new URL(payment.confirmation.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["yoomoney.ru", "yookassa.ru"].includes(url.hostname)
  )
    return undefined;
  return url.toString();
}
/** Isolated binder/verifier: discovery never dispatches or settles a provider operation. */
export class PublicExpertRecovery {
  constructor(
    private readonly deps: {
      readonly binder: PublicExpertRecoveryBinder;
      readonly observations: PublicExpertObservationWriter;
      readonly transport: PublicExpertRecoveryTransport;
      readonly now?: () => string;
    },
  ) {}
  async recover(requestId: string): Promise<PublicExpertRecoveryResult> {
    const s = await this.deps.binder.candidate(requestId);
    if (!s) return { kind: "unavailable" };
    try {
      let id = s.providerObjectId;
      if (id === null) {
        const from = Date.parse(s.createdAt) - 60_000;
        // Recovery is bounded to the immutable first-send window, even years later.
        const window = {
          createdFrom: new Date(from).toISOString(),
          createdTo: new Date(
            Date.parse(s.createdAt) + 23 * 3600_000,
          ).toISOString(),
        };
        const list =
          s.product === "refund"
            ? await this.deps.transport.listRefunds(window)
            : await this.deps.transport.listPayments(window);
        if (!list.complete) return { kind: "pending" };
        const exact = list.items.filter((p) => matches(s, p));
        if (exact.length !== 1) return { kind: "pending" };
        id = exact[0]!.id;
      }
      const item =
        s.product === "refund"
          ? await this.deps.transport.getRefund(id)
          : await this.deps.transport.getPayment(id);
      if (item.id !== id || !matches(s, item)) return { kind: "pending" };
      let parent: YooKassaPayment | null = null;
      const observedAt = this.deps.now?.() ?? new Date().toISOString();
      if (s.product === "refund") {
        parent = await this.deps.transport.getPayment(s.parentPaymentId!);
        if (
          parent.id !== s.parentPaymentId ||
          parent.status !== "succeeded" ||
          !parent.paid ||
          parent.test !== (s.mode === "test") ||
          parent.amount.currency !== "RUB" ||
          BigInt(amountMinor(parent.amount.value) ?? "0") <
            BigInt(s.amountMinor) ||
          parent.metadata.purpose !== "main_residency" ||
          parent.metadata.order_id !== s.legacySourceId ||
          parent.metadata.user_id !== s.userId ||
          !parent.capturedAt ||
          Date.parse(parent.capturedAt) < Date.parse(parent.createdAt) ||
          Date.parse(parent.capturedAt) > Date.parse(observedAt)
        )
          return { kind: "pending" };
      }
      const payment = "test" in item ? item : null;
      const fact = publicExpertVerifiedObservationSchema.parse({
        version: 1,
        requestId,
        providerObjectId: id,
        parentPaymentId: s.parentPaymentId,
        status: item.status,
        paid: payment?.paid ?? null,
        amountMinor: s.amountMinor,
        currency: item.amount.currency,
        mode: payment
          ? payment.test
            ? "test"
            : "live"
          : parent!.test
            ? "test"
            : "live",
        providerCreatedAt: item.createdAt,
        providerCapturedAt: payment?.capturedAt ?? null,
        paymentMethodType: payment?.paymentMethodType ?? null,
        identity: {
          purpose: purpose(s),
          operationId: s.legacyOperationId,
          orderId: s.legacySourceId,
          userId: s.userId,
        },
        // Hash only the minimal immutable fact projection; no redirect/contact/raw provider body.
        evidenceDigest: `sha256:${createHash("sha256")
          .update(
            JSON.stringify([
              s.requestId,
              id,
              item.status,
              payment?.paid ?? null,
              item.amount,
              item.createdAt,
              payment?.capturedAt ?? null,
              payment?.paymentMethodType ?? null,
              item.metadata,
              parent?.id ?? null,
              parent?.test ?? null,
              observedAt,
            ]),
          )
          .digest("hex")}`,
        observedAt,
      }) as PublicExpertFreshObservation;
      verified.add(fact);
      let bound = s;
      if (s.providerObjectId === null) {
        const result = await this.deps.binder.bind(requestId, fact);
        if (!result) return { kind: "pending" };
        bound = result;
      }
      const observationId = await this.deps.observations.observe(fact);
      if (!observationId) return { kind: "pending" };
      const url = redirect(item);
      return {
        kind: "observed",
        snapshot: bound,
        observation: fact,
        observationId,
        ...(url ? { confirmationUrl: url } : {}),
      };
    } catch {
      // An unavailable GET/binder/writer preserves uncertainty; no catch branch sends POST.
      return { kind: "pending" };
    }
  }
}
