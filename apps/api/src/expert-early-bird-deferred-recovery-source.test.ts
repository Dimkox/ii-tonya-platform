import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import { PostgresDeferredRecoverySource } from "./expert-early-bird-deferred-recovery-source.js";
it("uses immutable invoice dispatch metadata and rechecks scoped live identity without receipt retention", async () => {
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  const scope = {
    accountId: ids[0]!,
    offerId: ids[1]!,
    choiceId: ids[2]!,
    botId: "expert",
    botKey: "expert",
    chatId: "1",
    telegramUserId: "1",
  };
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ marked: "2026-11-01T12:00:00Z" }] });
  const source = new PostgresDeferredRecoverySource({
    transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as never);
  expect(await source.read(scope, ids[3]!, ids[4]!)).toEqual({
    kind: "unknown",
    createdFrom: "2026-11-01T11:55:00.000Z",
    createdBefore: "2026-11-02T11:55:00.000Z",
  });
  const query = new PgDialect().sqlToQuery(execute.mock.calls[1]![0]);
  expect(query.sql).not.toMatch(
    /ciphertext|receipt_contacts|deferred_requests/iu,
  );
  for (const gate of [
    "u.active",
    "expert_card_current_messaging_authority",
    "expert_sales_erased_cohorts",
    "ci.status='active'",
    "for share of i,a,u,b,c",
  ])
    expect(query.sql).toContain(gate);
  for (const id of ids) expect(query.params).toContain(id);
  execute
    .mockReset()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ marked: null }] });
  expect(await source.read(scope, ids[3]!, ids[4]!)).toEqual({
    kind: "not_dispatched",
  });
  execute
    .mockReset()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  expect(await source.read(scope, ids[3]!, ids[4]!)).toEqual({
    kind: "unavailable",
  });
});
