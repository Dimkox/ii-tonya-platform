import type { AdminDependencies, AdminFixture, LedgerFact } from "./admin-service.js";

export const adminFixture = (input: { approval: "valid"; packageBalance?: number }): AdminFixture => {
  const facts: LedgerFact[] = input.packageBalance === undefined ? [] : [{ id: "grant-1", packageId: "package-1", kind: "grant", delta: input.packageBalance, originalEntryId: null, packageKind: "admin", expiresAt: new Date("2026-09-26T10:00:00.000Z") }];
  const principal = { id: "admin-1", sessionIdHash: "session-1", roles: ["entitlement_admin", "catalog_admin", "security_admin", "support"] as const, mfaVerifiedAt: new Date("2026-07-28T09:59:00.000Z") };
  const dependencies: AdminDependencies = {
    principal,
    approvals: { async authorize() { return true; } },
    audit: { async append() {} },
    ledger: {
      facts: () => facts,
      async grant(command) { facts.push({ id: `grant:${command.idempotencyKey}`, packageId: command.packageId, kind: "grant", delta: command.units, originalEntryId: null, packageKind: command.packageKind, expiresAt: command.expiresAt }); },
      async revoke(command) { const balance = facts.filter((fact) => fact.packageId === command.packageId).reduce((total, fact) => total + fact.delta, 0); facts.push({ id: `revoke:${command.idempotencyKey}`, packageId: command.packageId, kind: "revocation", delta: -balance, originalEntryId: command.originalEntryId, packageKind: "admin", expiresAt: null }); },
    },
    workflow: { async grant(command) { await dependencies.ledger.grant({ packageId: `package:${command.command.idempotencyKey}`, userId: command.command.userId, units: command.command.units, packageKind: command.packageKind, expiresAt: command.expiresAt, idempotencyKey: command.command.idempotencyKey }); } },
    admin: { async mutate() {} },
  };
  return { ...dependencies, principal, ledger: dependencies.ledger };
};
