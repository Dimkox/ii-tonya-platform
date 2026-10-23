import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  YooKassaOnboardingPaymentVerifier,
  type OnboardingPaymentBinding,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";

const clock = new Date("2026-10-23T12:00:00.000Z");
function fixture(
  rows: (query: string) => Record<string, unknown>[],
  queries: string[] = [],
) {
  const dialect = new PgDialect();
  const db = {
    transaction: async <T>(
      work: (tx: {
        execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
      }) => Promise<T>,
    ) =>
      work({
        execute: async (query) => {
          const text = dialect.sqlToQuery(query).sql;
          queries.push(text);
          return { rows: rows(text) };
        },
      }),
  } as unknown as DrizzleDb;
  return new PostgresExpertVerificationRepository(db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
}
function principal(mfa: Date | string | null, expires: Date | string) {
  return { adminId: randomUUID(), mfa, expires, revoked: null, active: true };
}
describe("raw PostgreSQL timestamp authorization and settlement boundary", () => {
  it.each(["Date", "string"] as const)(
    "authorizes current original MFA using %s driver timestamps",
    async (kind) => {
      const value = (date: Date) =>
        kind === "Date" ? date : date.toISOString();
      const admin = principal(
        value(clock),
        value(new Date(clock.getTime() + 3600000)),
      );
      const queue = {
        applicationId: randomUUID(),
        status: "pending",
        maskedContact: "telegram:***",
        quoteId: randomUUID(),
        termMonths: 1,
        priceMinor: "500000",
        currency: "RUB",
      };
      const queries: string[] = [];
      const repository = fixture(
        (query) =>
          query.includes("as authorized")
            ? [{ authorized: true }]
            : query.includes("from admin_sessions s")
              ? [admin]
              : query.includes("select clock_timestamp() as now")
                ? [{ now: value(clock) }]
                : query.includes("where a.verification_status='pending'")
                  ? [queue]
                  : [],
        queries,
      );
      expect(await repository.listQueue("synthetic-session")).toEqual([queue]);
      const authority = queries.find((query) =>
        query.includes("as authorized"),
      );
      expect(authority).toContain("isfinite(s.expires_at)");
      expect(authority).toContain("isfinite(s.mfa_verified_at)");
    },
  );
  it.each([
    { mfa: null, expires: "2026-10-23T13:00:00Z", now: clock.toISOString() },
    {
      mfa: "not-a-time",
      expires: "2026-10-23T13:00:00Z",
      now: clock.toISOString(),
    },
    { mfa: clock.toISOString(), expires: "Infinity", now: clock.toISOString() },
    {
      mfa: clock.toISOString(),
      expires: "2026-10-23T13:00:00Z",
      now: "invalid-clock",
    },
    {
      mfa: "2026-10-23T11:44:59Z",
      expires: "2026-10-23T13:00:00Z",
      now: clock.toISOString(),
    },
    {
      mfa: clock.toISOString(),
      expires: clock.toISOString(),
      now: clock.toISOString(),
    },
  ])(
    "fails closed without driver-error disclosure for invalid/expired timestamp %#",
    async ({ mfa, expires, now }) => {
      const admin = principal(mfa, expires);
      const repository = fixture((query) =>
        query.includes("as authorized")
          ? [{ authorized: false }]
          : query.includes("from admin_sessions s")
            ? [admin]
            : query.includes("select clock_timestamp() as now")
              ? [{ now }]
              : [],
      );
      await expect(repository.listQueue("synthetic-session")).rejects.toThrow(
        "verification_forbidden",
      );
    },
  );
  it.each(["Date", "string"] as const)(
    "rejects capture predating the invoice using %s driver timestamps",
    async (kind) => {
      const now = Date.now();
      const capturedAt = new Date(now).toISOString();
      const binding: OnboardingPaymentBinding = {
        invoiceId: randomUUID(),
        applicationId: randomUUID(),
        userId: randomUUID(),
        operationId: randomUUID(),
        providerObjectId: "synthetic_timestamp_payment",
        purpose: "onboarding",
        amountMinor: "300000",
        currency: "RUB",
        mode: "test",
      };
      const verifier = new YooKassaOnboardingPaymentVerifier(
        {
          getPayment: async () => ({
            id: binding.providerObjectId,
            status: "succeeded",
            paid: true,
            amount: { value: "3000.00", currency: "RUB" },
            test: true,
            createdAt: new Date(now - 60000).toISOString(),
            capturedAt,
            metadata: { order_id: binding.invoiceId },
            refundable: true,
          }),
        },
        { findOnboardingPaymentBinding: async () => binding },
      );
      const proof = await verifier.verify(binding.invoiceId);
      if (!proof) throw new Error("synthetic_proof_missing");
      const value = (date: Date) =>
        kind === "Date" ? date : date.toISOString();
      const stored = {
        ...binding,
        applicationAuditId: binding.applicationId,
        createdAt: value(new Date(now + 60000)),
      };
      const repository = fixture((query) =>
        query.includes('as "captureValid"')
          ? [{ captureValid: false }]
          : query.includes("for update of i,o")
            ? [stored]
            : query.includes("select clock_timestamp() as now")
              ? [{ now: value(new Date(now + 120000)) }]
              : [],
      );
      await expect(repository.settleVerified(proof)).rejects.toThrow(
        "verification_payment_binding_mismatch",
      );
    },
  );
});
