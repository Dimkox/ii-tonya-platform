import { afterEach, expect, it, vi } from "vitest";
import {
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
} from "@ii-tonya/integrations";
import type {
  ExpertApplicantConfig,
  LaunchPhaseConfig,
} from "@ii-tonya/config";
import {
  createEarlyBirdOwnerRuntimeComposition,
  isInitializedEarlyBirdGatewayService,
} from "./expert-early-bird-runtime-composition.js";
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused-phase",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  const barrier = vi.spyOn(gateway, "barrier").mockResolvedValue();
  const policy = {
    botId: "1",
    botKey: "phase",
    messagingConsentPolicyVersion: "v1",
  } as ExpertApplicantConfig;
  const db = {
    execute: async () => {
      throw Error("unexpected_query_before_source_authority");
    },
  } as never;
  const role = (login: string) => ({ db, login });
  const runtime = createEarlyBirdOwnerRuntimeComposition(db, {
    gateway,
    gatewaySubjectKeyVersion: "v1",
    sender: role("phase_sender"),
    candidateReader: role("phase_reader"),
    bindingWriter: role("phase_binder"),
    knownBindingReader: role("phase_known"),
    checkout: {
      policy,
      identityKey: Buffer.alloc(32, 3),
      requestKey: Buffer.alloc(32, 4),
      requestKeyReference: "phase:v1",
      receiptVault: createPayerReceiptVault({
        activeKeyId: "v1",
        keys: new Map([["v1", Buffer.alloc(32, 5)]]),
      }),
      returnUrl: "https://ii-tonya.ru/return",
      onboardingFiscal: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
      subscriptionFiscal: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
    },
  })!;
  const phase: LaunchPhaseConfig = {
    configuredPhase: "PUBLIC_LAUNCH",
    enrollmentStartMs: Date.parse("2026-11-01T00:00:00+03:00"),
    clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
    promoDeadlineDays: 10,
    finalCallTriggerMs: Date.parse("2026-12-28T10:00:00+03:00"),
    policyVersion: "wave1-2027-01-11-v1",
  };
  return { runtime, policy, phase, barrier };
}
it("initializes genuine PUBLIC startup recovery authority while keeping wave acquisition inactive", async () => {
  const f = fixture();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T00:00:00Z"));
  const service = await f.runtime.initializeWaveAuthority(f.policy, f.phase);
  expect(isInitializedEarlyBirdGatewayService(service)).toBe(true);
  expect(service.isActive()).toBe(false);
  expect(
    await service.handle({ callbackData: "eb:any", text: "" } as never),
  ).toEqual({ status: "rejected" });
  expect(f.barrier).toHaveBeenCalledOnce();
});
it("retains WAVE initialization and fixed launch dates", async () => {
  const f = fixture();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T00:00:00Z"));
  expect(
    (
      await f.runtime.initializeWaveAuthority(f.policy, {
        ...f.phase,
        configuredPhase: "WAVE_1_EARLY_BIRD",
      })
    ).isActive(),
  ).toBe(true);
  await expect(
    f.runtime.initializeWaveAuthority(f.policy, {
      ...f.phase,
      configuredPhase: "WAVE_1_EARLY_BIRD",
      clientStartMs: f.phase.clientStartMs + 1,
    }),
  ).rejects.toThrow("early_bird_invalid_start");
});
it("rejects subject policy mismatch before obtaining gateway ACK", async () => {
  const f = fixture();
  await expect(
    f.runtime.initializeWaveAuthority(
      { ...f.policy, botKey: "wrong" },
      f.phase,
    ),
  ).rejects.toThrow("early_bird_runtime_policy_mismatch");
  expect(f.barrier).not.toHaveBeenCalled();
});
it("requires gateway readiness ACK for PUBLIC startup", async () => {
  const f = fixture();
  f.barrier.mockRejectedValue(Error("gateway_unavailable"));
  await expect(
    f.runtime.initializeWaveAuthority(f.policy, f.phase),
  ).rejects.toThrow("gateway_unavailable");
});
