export type MessageClass = "ordinary_inbound" | "ordinary_outbound" | "system" | "safety" | "error";
export type PackageKind = "admin" | "paid" | "intro";

export interface AvailablePackage {
  id: string;
  kind: PackageKind;
  ledgerBalance: number;
  expiresAt: Date | null;
  grantedAt: Date;
}

export type LedgerFact =
  | { sequence: number; kind: "grant"; delta: number; idempotencyKey: string }
  | { sequence: number; kind: "debit"; delta: -1; idempotencyKey: string }
  | { sequence: number; kind: "free"; delta: 0; idempotencyKey: string }
  | { sequence: number; kind: "compensation"; delta: 1; idempotencyKey: string }
  | { sequence: number; kind: "revocation"; delta: number; idempotencyKey: string };

export const chargeDelta = (messageClass: MessageClass): -1 | 0 =>
  messageClass === "ordinary_inbound" || messageClass === "ordinary_outbound" ? -1 : 0;

export function derivePackageBalance(facts: readonly LedgerFact[]): number {
  const seen = new Set<string>();
  let balance = 0;

  for (const fact of facts.toSorted((left, right) => left.sequence - right.sequence)) {
    if (seen.has(fact.idempotencyKey)) continue;
    seen.add(fact.idempotencyKey);

    const next = balance + fact.delta;
    if (next < 0) throw new Error("Ledger fact would make package balance negative");
    balance = next;
  }

  return balance;
}

export function choosePackage(packages: readonly AvailablePackage[], at: Date): AvailablePackage | null {
  return packages
    .filter((value) =>
      value.ledgerBalance > 0
      && (value.expiresAt === null || value.expiresAt.getTime() > at.getTime()))
    .toSorted((left, right) => {
      const introOrder = Number(left.kind === "intro") - Number(right.kind === "intro");
      if (introOrder !== 0) return introOrder;

      const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftExpiry - rightExpiry || left.grantedAt.getTime() - right.grantedAt.getTime()
        || left.id.localeCompare(right.id);
    })[0] ?? null;
}
