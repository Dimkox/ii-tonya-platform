import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { createReceiptContactFence } from "./receipt-disclosure-contact-fence.js";
it("durably captures and revokes a deferred receipt contact before acknowledging withdrawal", async () => {
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  const revoke = vi.spyOn(gateway, "revokeContactToken").mockResolvedValue();
  const events: string[] = [];
  const contact = "2526c71d-803f-4c3d-9b57-74e902170002";
  const execute = vi.fn(async (query) => {
    const text = new PgDialect().sqlToQuery(query).sql;
    if (text.includes("to_regclass"))
      return { rows: [{ present: true, deferredPresent: true }] };
    if (text.includes("select id from early_bird_deferred_receipt_contacts"))
      return { rows: [{ id: contact }] };
    if (text.includes("select id from")) return { rows: [] };
    if (text.includes("insert into receipt_revocation_outbox")) {
      events.push("insert");
      return { rows: [] };
    }
    if (text.includes("delete from receipt_revocation_outbox")) {
      events.push("delete");
      return { rows: [] };
    }
    if (text.includes("select exists")) return { rows: [{ pending: false }] };
    throw new Error("unexpected query");
  });
  revoke.mockImplementation(async () => {
    events.push("revoke");
  });
  expect(
    await createReceiptContactFence(gateway, "v1")(
      { execute } as never,
      "2526c71d-803f-4c3d-9b57-74e902170001",
    ),
  ).toBeUndefined();
  expect(revoke).toHaveBeenCalledWith(gateway.contactToken(contact), contact);
  expect(events).toEqual(["insert", "revoke", "delete"]);
});
