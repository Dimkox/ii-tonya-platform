import {
  PostgresEarlyBirdStandardScopeSource,
  PostgresEarlyBirdStandardSnapshotPrepare,
  PostgresEarlyBirdReceiptContact,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  createEarlyBirdStandardPrepareAuthority,
  type PayerReceiptVault,
} from "@ii-tonya/integrations";
import { createEarlyBirdReceiptAuthority } from "./expert-early-bird-receipt-authority.js";

type Fiscal = { vatCode: number; paymentSubject: string; paymentMode: string };
/** Explicit trusted configuration; constructing this does not enable a provider send. */
export type EarlyBirdStandardCheckoutConfiguration = {
  policy: {
    botId: string;
    botKey: string;
    messagingConsentPolicyVersion: string;
  };
  identityKey: Buffer;
  requestKey: Buffer;
  requestKeyReference: string;
  retainedRequestKeys?: ReadonlyMap<string, Buffer>;
  receiptVault: PayerReceiptVault;
  returnUrl: string;
  onboardingFiscal: Fiscal;
  subscriptionFiscal: Fiscal;
};
export function createEarlyBirdStandardCheckoutComposition(
  db: DrizzleDb,
  config?: EarlyBirdStandardCheckoutConfiguration,
) {
  if (!config) return undefined;
  if (
    !Buffer.isBuffer(config.identityKey) ||
    config.identityKey.length !== 32 ||
    !Buffer.isBuffer(config.requestKey) ||
    config.requestKey.length !== 32 ||
    !config.receiptVault ||
    typeof config.receiptVault.open !== "function" ||
    typeof config.receiptVault.seal !== "function" ||
    !/^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u.test(
      config.requestKeyReference,
    )
  )
    throw new Error("early_bird_checkout_config_invalid");
  const source = new PostgresEarlyBirdStandardScopeSource(
    db,
    config.policy,
    config.identityKey,
  );
  const contacts = new PostgresEarlyBirdReceiptContact(
    db,
    source,
    config.receiptVault,
  );
  const store = new PostgresEarlyBirdStandardSnapshotPrepare(db);
  const prepare = createEarlyBirdStandardPrepareAuthority({
    source,
    contacts,
    store,
    mode: "live",
    key: config.requestKey,
    keyReference: config.requestKeyReference,
    returnUrl: config.returnUrl,
    onboardingFiscal: config.onboardingFiscal,
    subscriptionFiscal: config.subscriptionFiscal,
  });
  const receipt = createEarlyBirdReceiptAuthority({
    source,
    contacts,
    prepare,
  });
  return { source, contacts, store, prepare, receipt };
}
