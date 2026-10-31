import { createHash } from "node:crypto";
import type { YooKassaPayment } from "./contracts.js";

export type EarlyBirdRecoveryFingerprint = {
  operationId: string;
  invoiceId: string;
  userIdSha256: string;
  grantIdSha256?: string;
  pricingPolicy: "owner_test_10_20_v1" | "wave1_standard_v1";
  priceKind: "fixed_test" | "discounted" | "full_price";
  totalMinor: string;
  mode: "test" | "live";
  createdFrom: string;
  createdBefore: string;
};
export type EarlyBirdPaymentSummary = {
  id: string;
  createdAt: string;
  test: boolean;
  metadata: { operation_id?: string; order_id?: string };
};
export interface EarlyBirdListRecoveryClient {
  listPayments(input: {
    createdFrom: string;
    createdTo: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: readonly EarlyBirdPaymentSummary[];
    nextCursor?: string;
  }>;
  getPayment(providerObjectId: string): Promise<YooKassaPayment>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const digest = /^[0-9a-f]{64}$/u;
const providerId = /^[A-Za-z0-9_-]{1,64}$/u;
const cursorPattern = /^[\x21-\x7e]{1,1024}$/u;
const hash = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");
const validFingerprint = (f: EarlyBirdRecoveryFingerprint) => {
  const from = Date.parse(f.createdFrom),
    before = Date.parse(f.createdBefore);
  return (
    uuid.test(f.operationId) &&
    uuid.test(f.invoiceId) &&
    digest.test(f.userIdSha256) &&
    (f.pricingPolicy === "owner_test_10_20_v1"
      ? f.priceKind === "fixed_test" &&
        typeof f.grantIdSha256 === "string" &&
        digest.test(f.grantIdSha256) &&
        f.mode === "live"
      : f.pricingPolicy === "wave1_standard_v1" &&
        (f.priceKind === "discounted" || f.priceKind === "full_price") &&
        f.grantIdSha256 === undefined) &&
    (f.mode === "test" || f.mode === "live") &&
    /^(?:[1-9]\d{0,11})$/u.test(f.totalMinor) &&
    Number.isFinite(from) &&
    Number.isFinite(before) &&
    before > from &&
    before - from <= 86400000
  );
};
const matches = (
  p: YooKassaPayment,
  f: EarlyBirdRecoveryFingerprint,
): boolean => {
  if (
    !p ||
    typeof p !== "object" ||
    typeof p.id !== "string" ||
    !providerId.test(p.id) ||
    typeof p.createdAt !== "string" ||
    !p.metadata ||
    typeof p.metadata !== "object" ||
    !p.amount ||
    typeof p.amount.value !== "string"
  )
    return false;
  const created = Date.parse(p.createdAt),
    m = p.metadata,
    amount = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(p.amount.value);
  if (
    !amount ||
    !Number.isFinite(created) ||
    created < Date.parse(f.createdFrom) ||
    created >= Date.parse(f.createdBefore) ||
    p.amount.currency !== "RUB" ||
    BigInt(amount[1]!) * 100n + BigInt(amount[2]!) !== BigInt(f.totalMinor) ||
    p.test !== (f.mode === "test")
  )
    return false;
  if (
    !["pending", "waiting_for_capture", "succeeded", "canceled"].includes(
      p.status,
    ) ||
    typeof p.paid !== "boolean" ||
    (p.status === "succeeded" &&
      (!p.paid ||
        typeof p.capturedAt !== "string" ||
        !Number.isFinite(Date.parse(p.capturedAt)) ||
        Date.parse(p.capturedAt) < created)) ||
    (p.status === "waiting_for_capture" && !p.paid) ||
    ((p.status === "pending" || p.status === "canceled") && p.paid)
  )
    return false;
  return (
    m.purpose === "combined_early_bird" &&
    m.operation_id === f.operationId &&
    m.order_id === f.invoiceId &&
    m.pricing_policy === f.pricingPolicy &&
    m.price_kind === f.priceKind &&
    typeof m.user_id === "string" &&
    uuid.test(m.user_id) &&
    hash(m.user_id) === f.userIdSha256 &&
    (f.pricingPolicy === "owner_test_10_20_v1"
      ? typeof m.pricing_grant_id === "string" &&
        uuid.test(m.pricing_grant_id) &&
        hash(m.pricing_grant_id) === f.grantIdSha256
      : m.pricing_grant_id === undefined)
  );
};
/** Read-only candidate discovery; missing, incomplete, ambiguous or unverifiable results never settle or cancel a payment. */
export async function scanEarlyBirdUnknown(
  client: EarlyBirdListRecoveryClient,
  fingerprint: EarlyBirdRecoveryFingerprint,
): Promise<
  | {
      kind: "candidate";
      providerObjectId: string;
      status: YooKassaPayment["status"];
    }
  | { kind: "manual_review" }
> {
  try {
    if (!fingerprint || !validFingerprint(fingerprint))
      return { kind: "manual_review" };
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const candidates = new Set<string>();
    for (let page = 0; page < 3; page++) {
      const result = await client.listPayments({
        createdFrom: new Date(
          Date.parse(fingerprint.createdFrom),
        ).toISOString(),
        createdTo: new Date(
          Date.parse(fingerprint.createdBefore),
        ).toISOString(),
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!result || !Array.isArray(result.items) || result.items.length > 100)
        return { kind: "manual_review" };
      for (const item of result.items) {
        const metadata = item?.metadata;
        if (
          metadata &&
          (metadata.operation_id === fingerprint.operationId ||
            metadata.order_id === fingerprint.invoiceId)
        ) {
          const created = Date.parse(item.createdAt);
          if (
            typeof item.id !== "string" ||
            !providerId.test(item.id) ||
            typeof item.test !== "boolean" ||
            item.test !== (fingerprint.mode === "test") ||
            !Number.isFinite(created) ||
            created < Date.parse(fingerprint.createdFrom) ||
            created >= Date.parse(fingerprint.createdBefore) ||
            metadata.operation_id !== fingerprint.operationId ||
            metadata.order_id !== fingerprint.invoiceId
          )
            return { kind: "manual_review" };
          candidates.add(item.id);
          if (candidates.size > 1) return { kind: "manual_review" };
        }
      }
      if (result.nextCursor === undefined) {
        if (candidates.size !== 1) return { kind: "manual_review" };
        const id = [...candidates][0]!;
        const observed = await client.getPayment(id);
        if (!matches(observed, fingerprint) || observed.id !== id)
          return { kind: "manual_review" };
        return {
          kind: "candidate",
          providerObjectId: id,
          status: observed.status,
        };
      }
      if (
        typeof result.nextCursor !== "string" ||
        !cursorPattern.test(result.nextCursor) ||
        cursors.has(result.nextCursor)
      )
        return { kind: "manual_review" };
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    return { kind: "manual_review" };
  } catch {
    return { kind: "manual_review" };
  }
}
