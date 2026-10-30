import { createEarlyBirdStandardSnapshotSealer } from "./early-bird-standard-snapshot-sealer.js";

type Sealer = ReturnType<typeof createEarlyBirdStandardSnapshotSealer>;
type Scope = {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
  offerId: string;
  choiceId: string;
};
type Identity = {
  userId: string;
  baseId: string;
  choiceId: string;
  operationId: string;
  invoiceId: string;
  idempotencyKey: string;
};
type Result = { kind: "prepared" | "replay" | "unavailable" };
type Fiscal = Parameters<
  typeof createEarlyBirdStandardSnapshotSealer
>[0]["onboardingFiscal"];
/** Concrete composition of scoped DB identity, encrypted contact, and atomic intent storage. It does not send. */
export function createEarlyBirdStandardPrepareAuthority(options: {
  source: { resolve(scope: Scope): Promise<Identity | null> };
  contacts: {
    read(
      scope: Scope,
    ): Promise<{ id: string; email: string; expiresAt: string } | null>;
  };
  store: {
    prepare(
      input: Identity & {
        requestExpiresAt: string;
        receiptContactId: string;
        mode: "live" | "test";
      },
      seal: Sealer,
    ): Promise<Result>;
  };
  mode: "live" | "test";
  key: Buffer;
  keyReference: string;
  returnUrl: string;
  onboardingFiscal: Fiscal;
  subscriptionFiscal: Fiscal;
}): { prepare(scope: Scope): Promise<Result> } {
  const key = Buffer.from(options.key);
  const onboardingFiscal = { ...options.onboardingFiscal },
    subscriptionFiscal = { ...options.subscriptionFiscal };
  return {
    async prepare(scope) {
      const identity = await options.source.resolve(scope);
      if (
        !identity ||
        identity.baseId !== scope.offerId ||
        identity.choiceId !== scope.choiceId
      )
        return { kind: "unavailable" };
      const contact = await options.contacts.read(scope);
      if (!contact) return { kind: "unavailable" };
      const seal = createEarlyBirdStandardSnapshotSealer({
        customer: { email: contact.email },
        returnUrl: options.returnUrl,
        onboardingFiscal,
        subscriptionFiscal,
        key,
        keyReference: options.keyReference,
      });
      return options.store.prepare(
        {
          ...identity,
          requestExpiresAt: contact.expiresAt,
          receiptContactId: contact.id,
          mode: options.mode,
        },
        seal,
      );
    },
  };
}
