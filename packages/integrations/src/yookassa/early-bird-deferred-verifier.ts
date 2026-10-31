import { createHash } from "node:crypto";
import { z } from "zod";
import type { YooKassaClient } from "./client.js";

const uuid = z.uuid();
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const snapshotSchema = z
  .object({
    invoiceId: uuid,
    userId: uuid,
    operationId: uuid,
    grantId: uuid.nullable(),
    policy: z.enum(["wave1_standard_v1", "owner_test_10_20_v1"]),
    stage: z.enum(["onboarding", "subscription"]),
    amountMinor: z.string().regex(/^[1-9]\d{0,11}$/u),
    mode: z.enum(["live", "test"]),
    launchAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const paymentSchema = z
  .object({
    id: providerId,
    status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
    paid: z.boolean(),
    test: z.boolean(),
    amount: z
      .object({
        value: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/u),
        currency: z.literal("RUB"),
      })
      .strict(),
    createdAt: z.iso.datetime({ offset: true }),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.string()),
  })
  .passthrough();
export type DeferredSnapshot = z.infer<typeof snapshotSchema>;
export function parseDeferredSnapshot(value: unknown): DeferredSnapshot {
  return snapshotSchema.parse(value);
}
declare const verifiedBrand: unique symbol;
export type VerifiedDeferredPayment = Readonly<
  DeferredSnapshot & {
    providerId: string;
    status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
    capturedAt?: string;
    evidenceDigest: string;
    readonly [verifiedBrand]: true;
  }
>;
const issued = new WeakMap<object, object>();
export function assertVerifiedDeferredPayment(
  value: unknown,
  issuer: object,
): asserts value is VerifiedDeferredPayment {
  if (!value || typeof value !== "object" || issued.get(value) !== issuer)
    throw new Error("early_bird_deferred_proof_required");
}
/** Uses an immutable DB snapshot and a fresh provider GET. The caller cannot provide financial facts. */
export class YooKassaDeferredVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getPayment">,
    private readonly reader: {
      findInvoice(id: string): Promise<DeferredSnapshot | null>;
    },
  ) {}
  async verify(
    invoiceId: string,
    providerIdValue: string,
  ): Promise<VerifiedDeferredPayment> {
    if (
      !uuid.safeParse(invoiceId).success ||
      !providerId.safeParse(providerIdValue).success
    )
      throw new Error("early_bird_deferred_mismatch");
    const snapshot = snapshotSchema.parse(
      await this.reader.findInvoice(invoiceId),
    );
    const p = paymentSchema.parse(
      await this.client.getPayment(providerIdValue),
    );
    const [rubles, kopecks] = p.amount.value.split(".");
    if (
      snapshot.invoiceId !== invoiceId ||
      p.id !== providerIdValue ||
      p.test !== (snapshot.mode === "test") ||
      BigInt(rubles!) * 100n + BigInt(kopecks!) !==
        BigInt(snapshot.amountMinor) ||
      p.metadata.order_id !== snapshot.invoiceId ||
      p.metadata.operation_id !== snapshot.operationId ||
      p.metadata.user_id !== snapshot.userId ||
      p.metadata.purpose !== "early_bird_deferred" ||
      p.metadata.stage !== snapshot.stage ||
      p.metadata.pricing_policy !== snapshot.policy ||
      (snapshot.policy === "owner_test_10_20_v1" &&
        (snapshot.mode !== "live" ||
          !snapshot.grantId ||
          p.metadata.pricing_grant_id !== snapshot.grantId ||
          snapshot.amountMinor !==
            (snapshot.stage === "onboarding" ? "1000" : "2000"))) ||
      (snapshot.policy === "wave1_standard_v1" &&
        (snapshot.grantId !== null ||
          (snapshot.stage === "onboarding" &&
            snapshot.amountMinor !== "300000"))) ||
      Date.parse(snapshot.launchAt) !==
        Date.parse("2027-01-11T00:00:00+03:00") ||
      (p.status === "succeeded" &&
        (!p.paid ||
          !p.capturedAt ||
          Date.parse(p.capturedAt) < Date.parse(p.createdAt))) ||
      ((p.status === "pending" || p.status === "canceled") && p.paid)
    )
      throw new Error("early_bird_deferred_mismatch");
    const facts = {
      ...snapshot,
      providerId: p.id,
      status: p.status,
      ...(p.capturedAt ? { capturedAt: p.capturedAt } : {}),
    };
    const proof = Object.freeze({
      ...facts,
      evidenceDigest: `sha256:${createHash("sha256")
        .update(JSON.stringify({ ...snapshot, providerId: p.id }))
        .digest("hex")}`,
    }) as VerifiedDeferredPayment;
    issued.set(proof, this);
    return proof;
  }
}
