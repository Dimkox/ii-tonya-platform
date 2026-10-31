import { createHash } from "node:crypto";
import type { YooKassaPayment, YooKassaRefund } from "./contracts.js";
import type { PublicExpertGatewayTransport } from "./public-expert-gateway.js";
import {
  publicExpertVerifiedObservationSchema,
  type PublicExpertPaymentSnapshot,
  type PublicExpertVerifiedObservation,
} from "./public-expert-gateway-contracts.js";

const verified = new WeakSet<object>();
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type PublicExpertFreshObservation =
  DeepReadonly<PublicExpertVerifiedObservation> & {
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
> &
  Partial<Pick<PublicExpertGatewayTransport, "forgetScan">>;
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
  async recover(
    requestId: string,
    options: { signal?: AbortSignal | undefined } = {},
  ): Promise<PublicExpertRecoveryResult> {
    const signal = options.signal;
    if (signal?.aborted) return { kind: "pending" };
    const s = await this.deps.binder.candidate(requestId);
    const refuse = () => {
      this.deps.transport.forgetScan?.(requestId);
      return { kind: "pending" as const };
    };
    if (!s) {
      this.deps.transport.forgetScan?.(requestId);
      return { kind: "unavailable" };
    }
    if (signal?.aborted) return { kind: "pending" };
    if (s.providerObjectId !== null)
      this.deps.transport.forgetScan?.(requestId);
    try {
      let id = s.providerObjectId;
      if (id === null) {
        const from = Date.parse(s.createdAt) - 60_000;
        // Recovery is bounded to the immutable first-send window, even years later.
        const window = {
          signal,
          ...(signal ? { scanKey: requestId } : {}),
          createdFrom: new Date(from).toISOString(),
          createdTo: new Date(
            Date.parse(s.createdAt) + 23 * 3600_000,
          ).toISOString(),
        };
        const list =
          s.product === "refund"
            ? await this.deps.transport.listRefunds(window)
            : await this.deps.transport.listPayments(window);
        if (!list.complete || signal?.aborted) return { kind: "pending" };
        const exact = list.items.filter((p) => matches(s, p));
        if (exact.length !== 1) return refuse();
        id = exact[0]!.id;
      }
      let item: YooKassaPayment | YooKassaRefund;
      let parent: YooKassaPayment | null = null;
      if (s.product === "refund") {
        // Both identities come from the immutable source snapshot. Do not make
        // a second slow read spend only the first read's remaining turn budget,
        // and do not return while a failed read's sibling is still running.
        const [refundResult, parentResult] = await Promise.allSettled([
          this.deps.transport.getRefund(id, signal),
          this.deps.transport.getPayment(s.parentPaymentId!, signal),
        ]);
        if (signal?.aborted) return { kind: "pending" };
        if (
          refundResult.status !== "fulfilled" ||
          parentResult.status !== "fulfilled"
        )
          return refuse();
        item = refundResult.value;
        parent = parentResult.value;
      } else item = await this.deps.transport.getPayment(id, signal);
      if (signal?.aborted) return { kind: "pending" };
      if (item.id !== id || !matches(s, item)) return refuse();
      const observedAt = this.deps.now?.() ?? new Date().toISOString();
      if (s.product === "refund") {
        if (
          !parent ||
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
          return refuse();
      }
      const payment = "test" in item ? item : null;
      const parsed = publicExpertVerifiedObservationSchema.parse({
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
      });
      const fact = Object.freeze({
        ...parsed,
        identity: Object.freeze({ ...parsed.identity }),
      }) as PublicExpertFreshObservation;
      verified.add(fact);
      let bound = s;
      if (signal?.aborted) return { kind: "pending" };
      if (s.providerObjectId === null) {
        const result = await this.deps.binder.bind(requestId, fact);
        if (!result) return refuse();
        bound = result;
      }
      // Once binding is durable, retries use the bound ID and fresh GET. A lost
      // observation write never requires keeping LIST data or replaying POST.
      this.deps.transport.forgetScan?.(requestId);
      if (signal?.aborted) return { kind: "pending" };
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
      if (!signal?.aborted) this.deps.transport.forgetScan?.(requestId);
      return { kind: "pending" };
    }
  }
}
