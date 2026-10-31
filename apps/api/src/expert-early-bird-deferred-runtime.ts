import { PostgresDeferredRecoverySource } from "./expert-early-bird-deferred-recovery-source.js";
import { EarlyBirdDeferredReviewPreparation } from "./expert-early-bird-deferred-review.js";
import {
  PostgresDeferredBoundReader,
  PostgresDeferredOnboardingStatus,
  PostgresDeferredReceiptContact,
  PostgresDeferredReviewReconciliationReader,
  PostgresDeferredReviewSource,
  PostgresDeferredRequestStore,
  PostgresDeferredScopeSource,
  PostgresDeferredSnapshotReader,
  PostgresDeferredVerifiedStore,
  PostgresEarlyBirdDeferredPayments,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  EarlyBirdDeferredCheckoutSender,
  YooKassaDeferredVerifier,
  type PayerReceiptVault,
} from "@ii-tonya/integrations";
import { EarlyBirdDeferredComposition } from "./expert-early-bird-deferred-composition.js";
import { EarlyBirdDeferredRecovery } from "./expert-early-bird-deferred-recovery.js";
import { EarlyBirdDeferredAuthority } from "./expert-early-bird-deferred-authority.js";
import { EarlyBirdDeferredStatus } from "./expert-early-bird-deferred-status.js";

type SenderOptions = ConstructorParameters<
  typeof EarlyBirdDeferredCheckoutSender
>[0];
/** Explicit composition only. Callers must prove the gateway fence and role provisioning separately. */
export function createEarlyBirdDeferredRuntime(options?: {
  enabled: boolean;
  db: DrizzleDb;
  prepareDb: DrizzleDb;
  invoiceDb: DrizzleDb;
  snapshotDb: DrizzleDb;
  bindingDb: DrizzleDb;
  settlementDb: DrizzleDb;
  sendDb: DrizzleDb;
  boundDb: DrizzleDb;
  logins: {
    prepare: string;
    invoice: string;
    snapshot: string;
    binding: string;
    settlement: string;
    send: string;
    bound: string;
  };
  policy: {
    botId: string;
    botKey: string;
    messagingConsentPolicyVersion: string;
  };
  gateway: SenderOptions["gateway"];
  client: SenderOptions["client"] &
    Pick<
      import("@ii-tonya/integrations").ExperimentalGatewayIpc,
      "listPayments"
    >;
  vault: PayerReceiptVault;
  identityKey: Buffer;
  requestKey: Buffer;
  keyReference: string;
  returnUrl: string;
  onboardingFiscal: {
    vatCode: number;
    paymentSubject: string;
    paymentMode: string;
  };
  subscriptionFiscal: {
    vatCode: number;
    paymentSubject: string;
    paymentMode: string;
  };
  engagement: { recordEngagementForUser(userId: string): Promise<unknown> };
  clientStartMs: number;
}) {
  if (!options || !options.enabled) return undefined;
  if (
    !Buffer.isBuffer(options.identityKey) ||
    options.identityKey.length !== 32 ||
    !Buffer.isBuffer(options.requestKey) ||
    options.requestKey.length !== 32
  )
    throw new Error("early_bird_deferred_config_invalid");
  const scope = new PostgresDeferredScopeSource(options.db, options.policy);
  const contacts = new PostgresDeferredReceiptContact(
    options.db,
    scope,
    options.vault,
  );
  const payments = new PostgresEarlyBirdDeferredPayments(
    options.prepareDb,
    options.invoiceDb,
    options.logins.prepare,
    options.logins.invoice,
  );
  const snapshot = new PostgresDeferredSnapshotReader(
    options.snapshotDb,
    options.logins.snapshot,
  );
  const verifier = new YooKassaDeferredVerifier(options.client, snapshot);
  const binding = new PostgresDeferredVerifiedStore(
    options.bindingDb,
    options.settlementDb,
    verifier,
    options.logins.binding,
    options.logins.settlement,
  );
  const bound = new PostgresDeferredBoundReader(
    options.boundDb,
    options.logins.bound,
  );
  const status = new EarlyBirdDeferredStatus(
    scope,
    new PostgresDeferredOnboardingStatus(options.db),
  );
  const recovery = new EarlyBirdDeferredRecovery(
    scope,
    bound,
    verifier,
    options.client,
    {
      source: new PostgresDeferredRecoverySource(options.db),
      listPayments: (input) => options.client.listPayments(input),
      bind: (proof) => binding.bind(proof),
    },
  );
  // Each stage has different fiscal metadata; select it by the durable invoice stage.
  const requests = {
    async prepare(
      scoped: Parameters<PostgresDeferredRequestStore["prepare"]>[0],
      invoiceId: string,
      contactId: string,
    ) {
      const facts = await snapshot.findInvoice(invoiceId);
      if (!facts) throw new Error("early_bird_deferred_request_unavailable");
      const fiscal =
        facts.stage === "onboarding"
          ? options.onboardingFiscal
          : options.subscriptionFiscal;
      return new PostgresDeferredRequestStore(
        options.db,
        scope,
        options.vault,
        options.requestKey,
        options.keyReference,
        fiscal,
        options.returnUrl,
      ).prepare(scoped, invoiceId, contactId);
    },
  };
  const checkout = new EarlyBirdDeferredComposition({
    enabled: true,
    requests,
    recovery,
    sendDb: options.sendDb,
    senderLogin: options.logins.send,
    requestKey: options.requestKey,
    keyReference: options.keyReference,
    gateway: options.gateway,
    verifier,
    binding,
    client: options.client,
  });
  const authority = new EarlyBirdDeferredAuthority({
    scope,
    contacts,
    payments,
    checkout,
    status,
    engagement: options.engagement,
    identityKey: options.identityKey,
    clientStartMs: options.clientStartMs,
  });
  const review = {
    reader: new PostgresDeferredReviewReconciliationReader(options.db),
    preparation: new EarlyBirdDeferredReviewPreparation(
      new PostgresDeferredReviewSource(options.db),
      payments,
      options.identityKey,
    ),
  };
  return {
    review,
    authority,
    contacts,
    scope,
    payments,
    snapshot,
    verifier,
    binding,
    bound,
    checkout,
  };
}
