import { expect, it, vi } from "vitest";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { createReceiptContactFence } from "./receipt-disclosure-contact-fence.js";
it("revokes the exact sorted contacts for a locked subject and never revokes the user identity", async () => {
  const gateway = new ExperimentalGatewayIpc({
      address: "\0unused",
      key: Buffer.alloc(32, 1),
      authKey: Buffer.alloc(32, 2),
      timeoutMs: 10,
    }),
    revoke = vi.spyOn(gateway, "revokeContactToken").mockResolvedValue(),
    user = vi.spyOn(gateway, "revokeUser");
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        { id: "2526c71d-803f-4c3d-9b57-74e902170002" },
        { id: "2526c71d-803f-4c3d-9b57-74e902170001" },
      ],
    })
    .mockResolvedValueOnce({
      rows: [{ present: true, deferredPresent: false }],
    })
    .mockResolvedValueOnce({
      rows: [
        { id: "2526c71d-803f-4c3d-9b57-74e902170003" },
        { id: "2526c71d-803f-4c3d-9b57-74e902170001" },
      ],
    })
    .mockResolvedValue({ rows: [{ pending: false }] });
  await createReceiptContactFence(gateway, "v1")({ execute } as never, "user");
  expect(revoke).toHaveBeenCalledTimes(3);
  expect(user).not.toHaveBeenCalled();
});
it("attempts global stop and reports unknown when contact cancellation fails", async () => {
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  vi.spyOn(gateway, "revokeContactToken").mockRejectedValue(
    new Error("offline"),
  );
  const stop = vi.spyOn(gateway, "stopAll").mockResolvedValue();
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [{ id: "2526c71d-803f-4c3d-9b57-74e902170001" }],
    })
    .mockResolvedValueOnce({
      rows: [{ present: false, deferredPresent: false }],
    })
    .mockResolvedValue({ rows: [{ pending: false }] });
  expect(
    await createReceiptContactFence(gateway, "v1")(
      { execute } as never,
      "user",
    ),
  ).toMatchObject({ message: "receipt_disclosure_cancellation_uncertain" });
  expect(stop).toHaveBeenCalledOnce();
});
it("keeps deletion uncertain while any previous key version has a pending token", async () => {
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  const stop = vi.spyOn(gateway, "stopAll").mockResolvedValue();
  vi.spyOn(gateway, "barrier").mockResolvedValue();
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{ present: false, deferredPresent: false }],
    })
    .mockResolvedValueOnce({ rows: [{ pending: true }] });
  const result = await createReceiptContactFence(gateway, "v2")(
    { execute } as never,
    "2526c71d-803f-4c3d-9b57-74e902170001",
  );
  expect(result).toMatchObject({
    message: "receipt_disclosure_cancellation_uncertain",
  });
  expect(stop).toHaveBeenCalledOnce();
});
it("requires a gateway readiness ACK even when no contacts remain", async () => {
  const gateway = new ExperimentalGatewayIpc({
    address: "\0unused",
    key: Buffer.alloc(32, 1),
    authKey: Buffer.alloc(32, 2),
    timeoutMs: 10,
  });
  vi.spyOn(gateway, "barrier").mockRejectedValue(new Error("offline"));
  const stop = vi.spyOn(gateway, "stopAll").mockResolvedValue();
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{ present: false, deferredPresent: false }],
    })
    .mockResolvedValueOnce({ rows: [{ pending: false }] });
  expect(
    await createReceiptContactFence(gateway, "v1")(
      { execute } as never,
      "2526c71d-803f-4c3d-9b57-74e902170001",
    ),
  ).toMatchObject({ message: "receipt_disclosure_cancellation_uncertain" });
  expect(stop).toHaveBeenCalledOnce();
});
