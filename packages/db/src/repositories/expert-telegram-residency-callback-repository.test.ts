import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertTelegramResidencyCallbackRepository } from "./expert-telegram-residency-callback-repository.js";

const tokenHash = "a".repeat(64);
const expertId = "00000000-0000-4000-8000-000000000101";
const tariffVersionId = "00000000-0000-4000-8000-000000000301";
const fence = "00000000-0000-4000-8000-000000000501";

describe("expert Telegram residency callback SQL guards", () => {
  it("makes repeated issuance conflict-safe only for the same token and binding", async () => {
    const query = vi.fn(async () => ({
      rows: [{ token_hash: tokenHash }],
      rowCount: 1,
    }));
    const repository = new PostgresExpertTelegramResidencyCallbackRepository({
      $client: { query },
    } as unknown as DrizzleDb);

    await repository.put(
      tokenHash,
      {
        expertId,
        telegramUserId: "123456789",
        tariffVersionId,
        action: "start_residency_checkout",
        expiresAt: new Date("2026-08-14T10:10:00.000Z"),
      },
      "telegram:quote:1:checkout:issue",
    );

    const statement = String(query.mock.calls[0]?.[0]).replace(/\s+/gu, " ");
    expect(statement).toContain("on conflict (idempotency_key) do update");
    expect(statement).toContain("c.token_hash=excluded.token_hash");
    expect(statement).toContain("c.expert_id=excluded.expert_id");
    expect(statement).toContain("c.telegram_user_id=excluded.telegram_user_id");
    expect(statement).toContain(
      "c.tariff_version_id=excluded.tariff_version_id",
    );
  });

  it("atomically downgrades a late ready URL to unavailable", async () => {
    const query = vi.fn(async () => ({
      rows: [{ checkoutStatus: "unavailable" }],
      rowCount: 1,
    }));
    const repository = new PostgresExpertTelegramResidencyCallbackRepository({
      $client: { query },
    } as unknown as DrizzleDb);

    await expect(
      repository.recordCheckoutOutcome(
        tokenHash,
        fence,
        { kind: "ready", checkoutUrl: "https://pay.example/late" },
        new Date("2026-08-14T10:10:00.000Z"),
      ),
    ).resolves.toBe(false);

    const statement = String(query.mock.calls[0]?.[0]).replace(/\s+/gu, " ");
    expect(statement).toContain(
      "when $3='ready' and expires_at<=$5 then 'unavailable'",
    );
    expect(statement).toContain(
      "when $3='ready' and expires_at>$5 then $4 else null end",
    );
  });
});
