import { expect, it, vi } from "vitest";
import { createExpertCardAdminService } from "./expert-card-admin-service.js";
const applicationId = "00000000-0000-4000-8000-000000000001";
const sessionHash = `sha256:${"a".repeat(64)}`;
const publicCard = {
  displayName: "Synthetic professional",
  profession: "Technical fixture",
  city: "Synthetic city",
  summary: "Synthetic approved profile",
};
const command = {
  applicationId,
  expectedRevision: 2,
  idempotencyKey: "synthetic-command-123",
};
function fixture() {
  const port = <T>(value: T) =>
    vi.fn(async (input: unknown, ...more: unknown[]) => {
      void input;
      void more;
      return value;
    });
  const repository = {
    listDrafts: port([{ applicationId, revision: 2 }]),
    readDraft: port({ applicationId, revision: 2 }),
    editPublicCard: port({ revision: 3 }),
    reviewCard: port({ revision: 2, stage: "approved" }),
    confirmPromo: port({ revision: 2, stage: "main_ready" }),
  };
  return {
    repository,
    service: createExpertCardAdminService({ enabled: true, repository }),
  };
}
it("reuses protected session for card queue and detail", async () => {
  const f = fixture();
  expect(await f.service.list(sessionHash, { limit: 20 })).toMatchObject({
    kind: "ok",
    items: [{ applicationId }],
  });
  expect(await f.service.detail(sessionHash, applicationId)).toMatchObject({
    kind: "ok",
    item: { applicationId },
  });
  expect(f.repository.readDraft).toHaveBeenCalledWith(
    sessionHash,
    applicationId,
  );
});
it("rejects missing session before any private read", async () => {
  const f = fixture();
  expect(await f.service.detail("bad", applicationId)).toEqual({
    kind: "forbidden",
  });
  expect(f.repository.readDraft).not.toHaveBeenCalled();
});
it("edits only strict public fields with revision and idempotency", async () => {
  const f = fixture();
  expect(
    await f.service.edit(sessionHash, { ...command, publicCard }),
  ).toMatchObject({ kind: "ok", item: { revision: 3 } });
  expect(f.repository.editPublicCard).toHaveBeenCalledWith({
    ...command,
    publicCard,
    sessionHash,
  });
});
it.each([
  { ...command, publicCard, paid: true },
  { ...command, publicCard: { ...publicCard, rawDocument: "private" } },
])("rejects publication/financial authority escapes", async (input) => {
  const f = fixture();
  expect(await f.service.edit(sessionHash, input as never)).toEqual({
    kind: "invalid",
  });
  expect(f.repository.editPublicCard).not.toHaveBeenCalled();
});
it.each(["approve", "return_changes"] as const)(
  "binds explicit manager review%s to revision",
  async (action) => {
    const f = fixture();
    expect(
      await f.service.review(sessionHash, { ...command, action }),
    ).toMatchObject({ kind: "ok" });
    expect(f.repository.reviewCard).toHaveBeenCalledWith({
      ...command,
      action,
      sessionHash,
    });
  },
);
it("does not accept delivery or active booleans as promo confirmation", async () => {
  const f = fixture();
  expect(
    await f.service.confirmPromo(sessionHash, {
      ...command,
      sent: true,
    } as never),
  ).toEqual({ kind: "invalid" });
  expect(f.repository.confirmPromo).not.toHaveBeenCalled();
});
it("sends only an authenticated manager action to promo gate", async () => {
  const f = fixture();
  expect(await f.service.confirmPromo(sessionHash, command)).toMatchObject({
    kind: "ok",
    item: { stage: "main_ready" },
  });
  expect(f.repository.confirmPromo).toHaveBeenCalledWith({
    ...command,
    sessionHash,
  });
});
it("keeps unexpected raw errors out of response", async () => {
  const f = fixture();
  f.repository.readDraft.mockRejectedValueOnce(
    new Error("synthetic-private-media-secret"),
  );
  expect(await f.service.detail(sessionHash, applicationId)).toEqual({
    kind: "unavailable",
  });
});

it("rejects a malformed null edit before private repository access", async () => {
  const f = fixture();
  await expect(f.service.edit(sessionHash, null as never)).resolves.toEqual({
    kind: "invalid",
  });
  expect(f.repository.editPublicCard).not.toHaveBeenCalled();
});
