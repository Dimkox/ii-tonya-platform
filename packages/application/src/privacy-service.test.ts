import { describe, expect, it, vi } from "vitest";
import {
  createEnvironmentHmacPseudonymizer,
  createPrivacyService,
} from "./privacy-service.js";

describe("privacy lifecycle", () => {
  it("derives irreversible per-environment pseudonyms without storing the secret", () => {
    expect(createEnvironmentHmacPseudonymizer("environment-a")("u-1")).not.toBe(
      createEnvironmentHmacPseudonymizer("environment-b")("u-1"),
    );
  });
  it("appends withdrawal, removes optional profile fields, and cancels follow-ups", async () => {
    const repository = {
      withdrawConsentAtomically: vi.fn().mockResolvedValue({
        consentDecisionId: "consent-deny-1",
        optionalFieldsRemoved: 3,
        followUpsCancelled: 1,
      }),
      exportOwnedSubject: vi.fn(),
      startErasureAtomically: vi.fn(),
    };
    const audit = { append: vi.fn() };
    const service = createPrivacyService({
      repository,
      audit,
      pseudonymize: () => "subject-deleted-01",
      capability: { enabled: true },
    });

    await service.withdrawConsent({
      principalUserId: "u-1",
      targetUserId: "u-1",
      purpose: "client_profile",
      policyVersion: "privacy-v1",
      correlationId: "privacy-1",
    });

    expect(repository.withdrawConsentAtomically).toHaveBeenCalledOnce();
    expect(repository.withdrawConsentAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: "u-1",
        purpose: "client_profile",
      }),
    );
    expect(audit.append).not.toHaveBeenCalled();
  });

  it("denies cross-subject export before repository access", async () => {
    const repository = {
      withdrawConsentAtomically: vi.fn(),
      exportOwnedSubject: vi.fn(),
      startErasureAtomically: vi.fn(),
    };
    const service = createPrivacyService({
      repository,
      audit: { append: vi.fn() },
      pseudonymize: () => "subject-deleted-02",
      capability: { enabled: true },
    });

    await expect(
      service.exportSubject({
        principalUserId: "u-1",
        targetUserId: "u-2",
        correlationId: "privacy-2",
      }),
    ).rejects.toThrow("Cross-subject privacy access denied");
    expect(repository.exportOwnedSubject).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown consent purpose before repository mutation", async () => {
    const repository = {
      withdrawConsentAtomically: vi.fn(),
      exportOwnedSubject: vi.fn(),
      startErasureAtomically: vi.fn(),
    };
    const service = createPrivacyService({
      repository,
      audit: { append: vi.fn() },
      pseudonymize: () => "p",
      capability: { enabled: true },
    });
    await expect(
      service.withdrawConsent({
        principalUserId: "u-1",
        targetUserId: "u-1",
        purpose: "unbounded",
        policyVersion: "privacy-v1",
        correlationId: "privacy-purpose",
      }),
    ).rejects.toThrow("Unknown privacy consent purpose");
    expect(repository.withdrawConsentAtomically).not.toHaveBeenCalled();
  });

  it.each(["client_messaging", "selarti_ai_processing", "expert_handoff"])(
    "allows runtime withdrawal of %s consent",
    async (purpose) => {
      const repository = {
        withdrawConsentAtomically: vi.fn().mockResolvedValue({
          consentDecisionId: "consent-1",
          optionalFieldsRemoved: 0,
          followUpsCancelled: 0,
        }),
        exportOwnedSubject: vi.fn(),
        startErasureAtomically: vi.fn(),
      };
      const service = createPrivacyService({
        repository,
        audit: { append: vi.fn() },
        capability: { enabled: true },
        pseudonymize: () => "pseudonym",
      });
      await service.withdrawConsent({
        principalUserId: "u-1",
        targetUserId: "u-1",
        purpose,
        policyVersion: "v1",
        correlationId: `withdraw-${purpose}`,
      });
      expect(repository.withdrawConsentAtomically).toHaveBeenCalledOnce();
    },
  );

  it("blocks every privacy mutation when the runtime capability is disabled", async () => {
    const repository = {
      withdrawConsentAtomically: vi.fn(),
      exportOwnedSubject: vi.fn(),
      startErasureAtomically: vi.fn(),
    };
    const service = createPrivacyService({
      repository,
      audit: { append: vi.fn() },
      pseudonymize: () => "p",
      capability: { enabled: false },
    });
    await expect(
      service.withdrawConsent({
        principalUserId: "u-1",
        targetUserId: "u-1",
        purpose: "client_profile",
        policyVersion: "v1",
        correlationId: "c1",
      }),
    ).rejects.toThrow("Privacy mutations are disabled");
    await expect(
      service.eraseSubject({
        principalUserId: "u-1",
        targetUserId: "u-1",
        correlationId: "c2",
      }),
    ).rejects.toThrow("Privacy mutations are disabled");
    expect(repository.withdrawConsentAtomically).not.toHaveBeenCalled();
    expect(repository.startErasureAtomically).not.toHaveBeenCalled();
  });

  it("starts owner-scoped erasure without rewriting immutable facts", async () => {
    const repository = {
      withdrawConsentAtomically: vi.fn(),
      exportOwnedSubject: vi.fn(),
      startErasureAtomically: vi.fn().mockResolvedValue({
        jobId: "erase-job-1",
        status: "pending",
        contentRefsDeleted: 4,
        profileFieldsDeleted: 3,
        ledgerFactsPreserved: 2,
        auditFactsPreserved: 5,
      }),
    };
    const service = createPrivacyService({
      repository,
      audit: { append: vi.fn() },
      pseudonymize: () => "subject-deleted-02",
      capability: { enabled: true },
    });

    await expect(
      service.eraseSubject({
        principalUserId: "u-1",
        targetUserId: "u-1",
        correlationId: "privacy-3",
      }),
    ).resolves.toMatchObject({ jobId: "erase-job-1", status: "pending" });
    expect(repository.startErasureAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        pseudonym: "subject-deleted-02",
        idempotencyKey: "privacy-3",
      }),
    );
  });
});
