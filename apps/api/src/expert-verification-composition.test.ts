import { expect, it } from "vitest";
import type { RuntimeConfig } from "@ii-tonya/config";
import {
  assertExpertVerificationCapability,
  assertExpertVerificationPayments,
  createExpertVerificationComposition,
} from "./expert-verification-composition.js";
const manager = {
  paymentMode: "test" as const,
  messagingConsentPolicyVersion: "policy-v1",
  checkoutEnabled: false,
  paymentVerificationEnabled: false,
};
const config = (settings = manager) =>
  ({
    features: { expertVerification: true },
    expertVerification: settings,
  }) as RuntimeConfig;
it("constructs no manager/storage capability while disabled", () => {
  expect(
    createExpertVerificationComposition(
      undefined as never,
      { features: {} } as RuntimeConfig,
    ),
  ).toBeUndefined();
});
it("allows manager invoice preparation without payment transport", () => {
  expect(() =>
    assertExpertVerificationPayments(config(), undefined),
  ).not.toThrow();
});
it.each(["checkoutEnabled", "paymentVerificationEnabled"] as const)(
  "fails lifecycle preflight when %s lacks complete dependency",
  (key) => {
    expect(() =>
      assertExpertVerificationPayments(
        config({ ...manager, [key]: true, paymentVerificationEnabled: true }),
        undefined,
      ),
    ).toThrow("expert_verification_payment_capability_required");
  },
);
it("rejects mismatched server/provider payment mode", () => {
  expect(() =>
    assertExpertVerificationPayments(
      config({
        ...manager,
        checkoutEnabled: true,
        paymentVerificationEnabled: true,
      }),
      {
        providerMode: "live",
        checkout: {
          strictFirstSendCancellation: true,
          recoverCheckout: async () => ({ kind: "pending" as const }),
          createCheckout: async () => ({
            url: "https://synthetic.invalid",
            paymentId: "p",
          }),
        },
      },
    ),
  ).toThrow("expert_verification_payment_mode_conflict");
});
it("requires explicit strict cancellation custody for checkout", () => {
  expect(() =>
    assertExpertVerificationPayments(
      config({
        ...manager,
        checkoutEnabled: true,
        paymentVerificationEnabled: true,
      }),
      {
        providerMode: "test",
        checkout: {
          recoverCheckout: async () => ({ kind: "pending" as const }),
          createCheckout: async () => ({
            url: "https://synthetic.invalid",
            paymentId: "p",
          }),
        },
      } as never,
    ),
  ).toThrow("expert_verification_payment_capability_required");
});
it("requires authoritative GET verifier contract", () => {
  expect(() =>
    assertExpertVerificationPayments(
      config({ ...manager, paymentVerificationEnabled: true }),
      {
        providerMode: "test",
        paymentVerification: { client: { getPayment: async () => null } },
      } as never,
    ),
  ).toThrow("expert_verification_payment_capability_required");
});
it("requires manager capability before app startup", () => {
  expect(() => assertExpertVerificationCapability(config(), undefined)).toThrow(
    "expert_verification_capability_required",
  );
});
it("normal app composition rejects incomplete enabled manager config", async () => {
  const { buildTestApp } = await import("./app.js");
  await expect(
    buildTestApp({ features: { expertVerification: true } }),
  ).rejects.toThrow("expert_verification_configuration_required");
});
it("requires existing-payment verifier even while manager and new checkout are off", () => {
  const disabledManager = {
    features: { expertVerification: false },
    expertVerification: { ...manager, paymentVerificationEnabled: true },
  } as RuntimeConfig;
  expect(() =>
    assertExpertVerificationPayments(disabledManager, undefined),
  ).toThrow("expert_verification_payment_capability_required");
});
it("accepts explicit complete checkout and GET verifier contracts without calling them", () => {
  const complete = {
    providerMode: "test" as const,
    checkout: {
      strictFirstSendCancellation: true as const,
      recoverCheckout: async () => ({ kind: "pending" as const }),
      createCheckout: async () => {
        throw new Error("must_not_call");
      },
    },
    paymentVerification: {
      authoritativeGet: true as const,
      client: {
        getPayment: async () => {
          throw new Error("must_not_call");
        },
      },
    },
  };
  expect(() =>
    assertExpertVerificationPayments(
      config({
        ...manager,
        checkoutEnabled: true,
        paymentVerificationEnabled: true,
      }),
      complete,
    ),
  ).not.toThrow();
});

it("rejects opaque claimed settlement functions even with an authoritative marker", () => {
  expect(() =>
    assertExpertVerificationPayments(
      config({ ...manager, paymentVerificationEnabled: true }),
      {
        providerMode: "test",
        paymentVerification: {
          authoritativeGet: true,
          verifyInvoice: async () => ({ stage: "interview" }),
        },
      } as never,
    ),
  ).toThrow("expert_verification_payment_capability_required");
});
it("builds the real narrow GET and branded-settlement path with manager disabled", async () => {
  const { YooKassaOnboardingWebhookCapability } =
    await import("@ii-tonya/integrations");
  const cap = createExpertVerificationComposition(
    undefined as never,
    {
      features: { expertVerification: false },
      expertVerification: { ...manager, paymentVerificationEnabled: true },
    } as RuntimeConfig,
    {
      providerMode: "test",
      paymentVerification: {
        authoritativeGet: true,
        client: {
          getPayment: async () => {
            throw new Error("must_not_call");
          },
        },
      },
    },
  );
  expect(cap?.onboardingWebhook).toBeInstanceOf(
    YooKassaOnboardingWebhookCapability,
  );
  expect(await cap?.service.list(`sha256:${"a".repeat(64)}`, {})).toEqual({
    kind: "disabled",
  });
});

it("requires an invoice-operation recovery path before enabling new checkout", () => {
  expect(() =>
    assertExpertVerificationPayments(
      config({
        ...manager,
        checkoutEnabled: true,
        paymentVerificationEnabled: true,
      }),
      {
        providerMode: "test",
        checkout: {
          strictFirstSendCancellation: true,
          createCheckout: async () => ({
            url: "https://pay.yookassa.ru/synthetic",
            paymentId: "synthetic",
          }),
        },
        paymentVerification: {
          authoritativeGet: true,
          client: {
            getPayment: async () => {
              throw new Error("must_not_call");
            },
          },
        },
      } as never,
    ),
  ).toThrow("expert_verification_payment_capability_required");
});
it("rejects an injected manager service without authenticated invoice recovery", () => {
  expect(() =>
    assertExpertVerificationCapability(config(), {
      paymentMode: "test",
      checkoutEnabled: false,
      paymentVerificationEnabled: false,
      service: {
        list: async () => ({ kind: "disabled" }),
        detail: async () => ({ kind: "disabled" }),
        decide: async () => ({ kind: "disabled" }),
      },
    } as never),
  ).toThrow("expert_verification_capability_required");
});
it("normal manager composition exposes the complete authenticated recovery service", () => {
  const capability = createExpertVerificationComposition(
    undefined as never,
    config(),
  );
  expect(() =>
    assertExpertVerificationCapability(config(), capability),
  ).not.toThrow();
});
