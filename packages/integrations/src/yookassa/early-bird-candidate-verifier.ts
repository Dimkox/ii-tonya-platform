import { createHash } from "node:crypto";
import { z } from "zod";
import type { YooKassaClient } from "./client.js";
import {
  earlyBirdStandardIntentSchema,
  isEarlyBirdStandardSnapshotConsistent,
} from "./early-bird-request.js";

const uuid = z.uuid();
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const ownerIntentSchema = z
  .object({
    invoiceId: uuid,
    userId: uuid,
    operationId: uuid,
    grantId: uuid,
    pricingPolicy: z.literal("owner_test_10_20_v1"),
    priceKind: z.literal("fixed_test"),
    onboardingMinor: z.literal("1000"),
    subscriptionMinor: z.literal("2000"),
    totalMinor: z.literal("3000"),
    mode: z.literal("live"),
    baseOfferShownAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    launchAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const intentSchema = z.union([
  ownerIntentSchema,
  earlyBirdStandardIntentSchema.omit({ idempotencyKey: true }),
]);
const observedSchema = z
  .object({
    id: providerId,
    status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
    paid: z.boolean(),
    amount: z
      .object({
        value: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/u),
        currency: z.literal("RUB"),
      })
      .strict(),
    test: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.string()),
  })
  .passthrough();
export type EarlyBirdCandidateIntent = z.infer<typeof intentSchema>;
declare const candidateBrand: unique symbol;
export type VerifiedEarlyBirdCandidate = Readonly<
  EarlyBirdCandidateIntent & {
    providerObjectId: string;
    providerStatus: z.infer<typeof observedSchema>["status"];
    providerCreatedAt: string;
    providerCapturedAt?: string;
    evidenceDigest: string;
    readonly [candidateBrand]: true;
  }
>;
const candidates = new WeakMap<object, YooKassaEarlyBirdCandidateVerifier>();
export function assertVerifiedEarlyBirdCandidate(
  value: unknown,
  issuer: YooKassaEarlyBirdCandidateVerifier,
): asserts value is VerifiedEarlyBirdCandidate {
  if (
    !value ||
    typeof value !== "object" ||
    !candidates.has(value) ||
    candidates.get(value) !== issuer
  )
    throw new Error("early_bird_candidate_proof_required");
}
class Mismatch extends Error {
  constructor() {
    super("early_bird_candidate_mismatch");
  }
}
/** A candidate is bound only after an authoritative provider GET matches a durable immutable intent. */
export class YooKassaEarlyBirdCandidateVerifier {
  constructor(
    private readonly client: Pick<YooKassaClient, "getPayment">,
    private readonly intents: {
      findIntent(operationId: string): Promise<EarlyBirdCandidateIntent | null>;
    },
  ) {}
  async verify(
    operationId: string,
    candidateProviderObjectId: string,
  ): Promise<VerifiedEarlyBirdCandidate> {
    try {
      if (
        !uuid.safeParse(operationId).success ||
        !providerId.safeParse(candidateProviderObjectId).success
      )
        throw new Mismatch();
      const intent = intentSchema.safeParse(
        await this.intents.findIntent(operationId),
      );
      if (
        !intent.success ||
        intent.data.operationId !== operationId ||
        (intent.data.pricingPolicy === "wave1_standard_v1" &&
          !isEarlyBirdStandardSnapshotConsistent(intent.data)) ||
        Date.parse(intent.data.expiresAt) !==
          Date.parse(intent.data.baseOfferShownAt) + 240 * 60 * 60 * 1000 ||
        Date.parse(intent.data.launchAt) !==
          Date.parse("2027-01-11T00:00:00+03:00")
      )
        throw new Mismatch();
      const observed = observedSchema.safeParse(
        await this.client.getPayment(candidateProviderObjectId),
      );
      if (!observed.success) throw new Mismatch();
      const p = observed.data,
        i = intent.data;
      const [rubles, kopecks] = p.amount.value.split(".");
      if (
        p.id !== candidateProviderObjectId ||
        p.test !== (i.mode === "test") ||
        BigInt(rubles!) * 100n + BigInt(kopecks!) !== BigInt(i.totalMinor) ||
        Date.parse(p.createdAt) < Date.parse(i.baseOfferShownAt) ||
        (i.pricingPolicy === "wave1_standard_v1" &&
          Date.parse(p.createdAt) < Date.parse(i.quotedAt)) ||
        p.metadata.order_id !== i.invoiceId ||
        p.metadata.operation_id !== i.operationId ||
        p.metadata.user_id !== i.userId ||
        p.metadata.purpose !== "combined_early_bird" ||
        p.metadata.price_kind !== i.priceKind ||
        p.metadata.pricing_policy !== i.pricingPolicy ||
        (i.pricingPolicy === "owner_test_10_20_v1" &&
          p.metadata.pricing_grant_id !== i.grantId) ||
        (p.status === "succeeded" || p.status === "waiting_for_capture") !==
          p.paid ||
        (p.status === "succeeded" &&
          (!p.capturedAt ||
            Date.parse(p.capturedAt) < Date.parse(p.createdAt))) ||
        (p.status !== "succeeded" && p.capturedAt !== undefined)
      )
        throw new Mismatch();
      const facts = {
        ...i,
        providerObjectId: p.id,
        providerStatus: p.status,
        providerCreatedAt: p.createdAt,
        ...(p.capturedAt ? { providerCapturedAt: p.capturedAt } : {}),
      };
      const proof = Object.freeze({
        ...facts,
        evidenceDigest: `sha256:${createHash("sha256").update(JSON.stringify(facts)).digest("hex")}`,
      }) as VerifiedEarlyBirdCandidate;
      candidates.set(proof, this);
      return proof;
    } catch (error) {
      if (error instanceof Mismatch) throw error;
      throw new Error("early_bird_candidate_verification_unavailable");
    }
  }
}
