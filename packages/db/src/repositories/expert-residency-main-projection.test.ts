import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { restoreSettledMainCardProjection } from "./expert-residency-main-projection.js";
import type { ExpertCardTransaction } from "./expert-card-repository.js";
const userId = "00000000-0000-4000-8000-000000000111",
  expertId = "00000000-0000-4000-8000-000000000112";
const oldOrder = "00000000-0000-4000-8000-000000000113",
  chainEndOrder = "00000000-0000-4000-8000-000000000114";
const dialect = new PgDialect();
describe("canonical continuous paid-chain publication projection", () => {
  it.each([false, true])(
    "never restores an old current-period endpoint when authoritative prepaid-chain binding is absent or mismatched: %s",
    async (hasCoverage) => {
      const statements: string[] = [];
      const tx = {
        execute: async (query: SQL) => {
          const text = dialect.sqlToQuery(query).sql;
          statements.push(text);
          if (text.includes("select status from expert_residency_lifecycle"))
            return { rows: [{ status: "payment_required" }] };
          if (text.includes("expert_residency_current_coverage"))
            return {
              rows: hasCoverage
                ? [
                    {
                      sourceOrderId: chainEndOrder,
                      endsAt: "2026-12-23T00:00:00.000Z",
                    },
                  ]
                : [],
            };
          if (
            text.includes(
              "from expert_card_main_orders m join expert_residency_orders o",
            )
          )
            return {
              rows: [
                {
                  orderId: oldOrder,
                  applicationId: userId,
                  reviewId: userId,
                  revision: 1,
                  publicDigest: `sha256:${"a".repeat(64)}`,
                  endsAt: "2026-11-23T00:00:00.000Z",
                },
              ],
            };
          return { rows: [] };
        },
      } as unknown as ExpertCardTransaction;
      expect(
        await restoreSettledMainCardProjection(tx, { userId, expertId }),
      ).toBe(false);
      expect(
        statements.filter((text) =>
          text.includes("expert_residency_current_coverage"),
        ),
      ).toHaveLength(1);
      expect(
        statements.some((text) => /^(?:update|insert)/u.test(text.trim())),
      ).toBe(false);
      expect(
        statements.some((text) => text.includes("from expert_card_drafts")),
      ).toBe(false);
    },
  );
});
