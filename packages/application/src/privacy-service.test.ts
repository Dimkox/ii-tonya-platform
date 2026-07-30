import { describe, expect, it, vi } from "vitest";
import { createEnvironmentHmacPseudonymizer, createPrivacyService } from "./privacy-service.js";

describe("privacy lifecycle", () => {
  it("derives irreversible per-environment pseudonyms without storing the secret", () => {
    expect(createEnvironmentHmacPseudonymizer("environment-a")("u-1"))
      .not.toBe(createEnvironmentHmacPseudonymizer("environment-b")("u-1"));
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
    });

    await expect(service.exportSubject({
      principalUserId: "u-1",
      targetUserId: "u-2",
      correlationId: "privacy-2",
    })).rejects.toThrow("Cross-subject privacy access denied");
    expect(repository.exportOwnedSubject).not.toHaveBeenCalled();
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
    });

    await expect(service.eraseSubject({
      principalUserId: "u-1",
      targetUserId: "u-1",
      correlationId: "privacy-3",
    })).resolves.toMatchObject({ jobId: "erase-job-1", status: "pending" });
    expect(repository.startErasureAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        pseudonym: "subject-deleted-02",
        idempotencyKey: "privacy-3",
      }),
    );
  });
});
