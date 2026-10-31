import { sealEarlyBirdStandardRequest } from "./early-bird-standard-sealed-request.js";
import { buildEarlyBirdStandardRequest } from "./early-bird-request.js";

type Source = Parameters<typeof buildEarlyBirdStandardRequest>[0];
/** Receipt and fiscal details must come from an authorized source, not a callback or Telegram message. */
export function createEarlyBirdStandardSnapshotSealer(options: {
  customer: Source["customer"];
  returnUrl: string;
  onboardingFiscal: Source["onboardingFiscal"];
  subscriptionFiscal: Source["subscriptionFiscal"];
  key: Buffer;
  keyReference: string;
}): ((
  intent: Source["intent"],
) => ReturnType<typeof sealEarlyBirdStandardRequest>) & {
  fingerprint: (intent: Source["intent"]) => {
    digest: string;
    keyReference: string;
  };
} {
  const key = Buffer.from(options.key);
  const customer = { ...options.customer };
  const onboardingFiscal = { ...options.onboardingFiscal };
  const subscriptionFiscal = { ...options.subscriptionFiscal };
  const { returnUrl, keyReference } = options;
  const source = (intent: Source["intent"]) => ({
    intent,
    customer,
    returnUrl,
    onboardingFiscal,
    subscriptionFiscal,
  });
  return Object.assign(
    (intent: Source["intent"]) =>
      sealEarlyBirdStandardRequest(source(intent), key, keyReference),
    {
      fingerprint: (intent: Source["intent"]) => ({
        digest: buildEarlyBirdStandardRequest(source(intent)).digest,
        keyReference,
      }),
    },
  );
}
