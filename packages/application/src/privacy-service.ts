export interface WithdrawConsentCommand {
  readonly principalUserId: string;
  readonly targetUserId: string;
  readonly purpose: string;
  readonly policyVersion: string;
  readonly correlationId: string;
}

export interface ExportSubjectCommand {
  readonly principalUserId: string;
  readonly targetUserId: string;
  readonly correlationId: string;
}

export interface ListConsentsCommand {
  readonly principalUserId: string;
  readonly targetUserId: string;
}

export interface ConsentStateView {
  readonly purpose: string;
  readonly inForce: boolean;
  readonly policyVersion: string;
  readonly decidedAt: string;
}

export interface EraseSubjectCommand {
  readonly principalUserId: string;
  readonly targetUserId: string;
  readonly correlationId: string;
}

export interface WithdrawalReceipt {
  readonly consentDecisionId: string;
  readonly optionalFieldsRemoved: number;
  readonly followUpsCancelled: number;
}

export interface SubjectExport {
  readonly userId: string;
  readonly identity: readonly { provider: string; externalId: string }[];
  readonly consents: readonly {
    purpose: string;
    decision: string;
    policyVersion: string;
    createdAt: string;
    evidence: {
      decisionId: string;
      sequence: string;
      channel: string | null;
      scopeFields: { fields?: ("display_name" | "timezone")[] } | null;
      scopeStatus: "absent" | "complete" | "redacted";
      textSha256: string | null;
      basis: string | null;
      priorDecisionId: string | null;
      presentation: {
        id: string;
        createdAt: string;
        consumedAt: string | null;
      } | null;
    };
    document: {
      id: string;
      documentKey: string;
      version: number;
      title: string;
      body: string;
      textSha256: string;
    } | null;
  }[];
  readonly profile: { displayName?: string; timezone?: string } | null;
  readonly reservations: readonly {
    id: string;
    status: string;
    startsAt?: string;
  }[];
  readonly clientBookings: readonly {
    bookingHandle: `bk1.${string}`;
    state:
      "reserved" | "booked" | "cancelled" | "expired" | "completed" | "no_show";
    createdAt: string;
    startsAt?: string;
  }[];
  readonly feedback: readonly { reservationId: string; rating: number }[];
  readonly messageAccounting: {
    packageCount: number;
    eventCount: number;
    ledgerEntryCount: number;
  };
  readonly catalogSnapshots: readonly {
    catalogRequestId: string;
    expiresAt: string;
    cards: readonly Record<string, unknown>[];
  }[];
}

export interface ErasureJob {
  readonly jobId: string;
  readonly status: "pending" | "processor_complete" | "backup_verified";
  readonly contentRefsDeleted: number;
  readonly profileFieldsDeleted: number;
  readonly ledgerFactsPreserved: number;
  readonly auditFactsPreserved: number;
}

export interface StartErasureCommand {
  readonly targetUserId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly pseudonym: string;
}

export interface PrivacyRepository {
  withdrawConsentAtomically(
    command: WithdrawConsentCommand,
  ): Promise<WithdrawalReceipt>;
  exportOwnedSubject(userId: string): Promise<SubjectExport>;
  startErasureAtomically(command: StartErasureCommand): Promise<ErasureJob>;
  listCurrentConsents(userId: string): Promise<readonly ConsentStateView[]>;
}

export interface PrivacyService {
  withdrawConsent(command: WithdrawConsentCommand): Promise<void>;
  exportSubject(command: ExportSubjectCommand): Promise<SubjectExport>;
  eraseSubject(command: EraseSubjectCommand): Promise<ErasureJob>;
  listConsents(
    command: ListConsentsCommand,
  ): Promise<readonly ConsentStateView[]>;
}

export interface PrivacyDependencies {
  readonly repository: PrivacyRepository;
  /** Repository transactions append audit facts. This port is retained for composition compatibility only. */
  readonly audit: {
    append(event: Record<string, unknown>): Promise<void> | void;
  };
  readonly pseudonymize: (userId: string) => string;
  readonly capability?: { enabled: boolean };
}

function assertOwner(principalUserId: string, targetUserId: string): void {
  if (principalUserId !== targetUserId) {
    throw new Error("Cross-subject privacy access denied");
  }
}
const CONSENT_PURPOSES = new Set([
  "client_profile",
  "expert_note",
  "expert_handoff",
  "follow_up",
  "client_messaging",
  "selarti_ai_processing",
]);

/** The caller supplies a per-environment key from its secret manager; it is never persisted. */
export const createEnvironmentHmacPseudonymizer =
  (environmentKey: string) =>
  (userId: string): string =>
    `hmac:${createHmac("sha256", environmentKey).update(userId).digest("hex")}`;

export const createPrivacyService = (
  deps: PrivacyDependencies,
): PrivacyService => ({
  async listConsents(command) {
    assertOwner(command.principalUserId, command.targetUserId);
    return deps.repository.listCurrentConsents(command.targetUserId);
  },
  async withdrawConsent(command) {
    if (!deps.capability?.enabled)
      throw new Error("Privacy mutations are disabled");
    assertOwner(command.principalUserId, command.targetUserId);
    if (!CONSENT_PURPOSES.has(command.purpose))
      throw new Error("Unknown privacy consent purpose");
    // Audit and projection outbox are deliberately part of this serializable repository command.
    await deps.repository.withdrawConsentAtomically(command);
  },
  async exportSubject(command) {
    assertOwner(command.principalUserId, command.targetUserId);
    return deps.repository.exportOwnedSubject(command.targetUserId);
  },
  async eraseSubject(command) {
    if (!deps.capability?.enabled)
      throw new Error("Privacy mutations are disabled");
    assertOwner(command.principalUserId, command.targetUserId);
    return deps.repository.startErasureAtomically({
      targetUserId: command.targetUserId,
      correlationId: command.correlationId,
      idempotencyKey: command.correlationId,
      pseudonym: deps.pseudonymize(command.targetUserId),
    });
  },
});
import { createHmac } from "node:crypto";
