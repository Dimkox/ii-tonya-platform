import { expect, it } from "vitest";
import {
  createResidentVerificationService,
  type ResidentFormRepository,
  type ResidentFormSnapshot,
} from "./resident-verification-service.js";
import { applyResidentPatch } from "@ii-tonya/domain";
const scope = {
  botId: "717171",
  botKey: "resident-promo",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
};
function fixture(initial: Partial<ResidentFormSnapshot> = {}) {
  const s: ResidentFormSnapshot = {
    id: "00000000-0000-4000-8000-000000000001",
    revision: 0,
    draft: {},
    status: "PENDING_DOCS",
    progress: "FORM_FILLING",
    replay: false,
    ...initial,
  };
  const receipts = new Map<
    string,
    { digest: string; result: ResidentFormSnapshot }
  >();
  const repository: ResidentFormRepository = {
    async mutate(input) {
      const prior = receipts.get(input.requestKey);
      if (prior) {
        if (prior.digest !== input.requestDigest)
          throw Error("resident_idempotency_conflict");
        return { ...structuredClone(prior.result), replay: true };
      }
      if (input.action !== "start") {
        if (input.expectedRevision !== s.revision) throw Error("stale");
        if (input.action === "patch")
          s.draft = applyResidentPatch(s.draft, input.patch);
        s.revision++;
        s.currentField = input.field ?? null;
      }
      const result = structuredClone(s);
      receipts.set(input.requestKey, { digest: input.requestDigest, result });
      return result;
    },
  };
  return {
    service: createResidentVerificationService({ enabled: true, repository }),
    snapshot: () => s,
  };
}
it("renders role union then explicit primary selection with durable revisions", async () => {
  const f = fixture();
  const first = await f.service.handle({ ...scope, text: "/verification" });
  expect(JSON.stringify(first)).toContain("EXPERT");
  const callback = (updateId: number, op: string) =>
    f.service.handle({
      ...scope,
      updateId,
      text: "",
      callbackData: `rv:00000000-0000-4000-8000-000000000001:${f.snapshot().revision}:${op}`,
    });
  const chosen = await callback(2, "r:CENTER");
  expect(f.snapshot().draft.roles).toEqual(["CENTER"]);
  expect(f.snapshot().draft.primaryRole).toBeUndefined();
  expect(JSON.stringify(chosen)).toContain("r:EXPERT");
  await callback(3, "r:EXPERT");
  const next = await callback(4, "next");
  expect(JSON.stringify(next)).toContain("p:CENTER");
  const primary = await callback(5, "p:EXPERT");
  expect(f.snapshot().draft.primaryRole).toBe("EXPERT");
  expect(JSON.stringify(primary)).toContain("EXCLUSIVE");
  expect(
    (
      await f.service.handle({
        ...scope,
        updateId: 6,
        text: "",
        callbackData: "rv:00000000-0000-4000-8000-000000000001:0:r:EXPERT",
      })
    )?.status,
  ).toBe("handled");
});
it("keeps amenities multi-select until Next and allows none", async () => {
  const f = fixture({
    draft: {
      roles: ["CENTER"],
      primaryRole: "CENTER",
      category: "BASIC",
      tax: "IP",
      city: "Москва",
      socialLinks: ["https://example.com/me"],
      motivation: "Участие",
      capacity: 20,
      propertyEvidence: [
        { kind: "document", fileId: "f", mimeType: "application/pdf", size: 1 },
      ],
    },
  });
  const a = await f.service.handle({
    ...scope,
    text: "",
    callbackData: `rv:${f.snapshot().id}:0:a:wifi`,
  });
  expect(JSON.stringify(a)).toContain("a:parking");
  expect(JSON.stringify(a)).toContain("next");
  await f.service.handle({
    ...scope,
    updateId: 2,
    text: "",
    callbackData: `rv:${f.snapshot().id}:1:a:none`,
  });
  expect(f.snapshot().draft.amenities).toEqual(["none"]);
  const done = await f.service.handle({
    ...scope,
    updateId: 3,
    text: "",
    callbackData: `rv:${f.snapshot().id}:2:next`,
  });
  expect(JSON.stringify(done)).toContain("submit");
  expect(JSON.stringify(done)).not.toContain("education");
});
it("persists a normal edit cursor across calls and keeps exact replay stable", async () => {
  const f = fixture({
    draft: {
      roles: ["OTHER"],
      primaryRole: "OTHER",
      category: "BASIC",
      tax: "IP",
      city: "Москва",
      socialLinks: ["https://example.com/me"],
      motivation: "Участие",
      path: "Опыт",
      cases: "Практика",
    },
  });
  await f.service.handle({
    ...scope,
    text: "",
    callbackData: `rv:${f.snapshot().id}:0:e:y`,
  });
  const answer = { ...scope, updateId: 2, text: "Казань" };
  const first = await f.service.handle(answer);
  expect(f.snapshot().draft.city).toBe("Казань");
  expect(await f.service.handle(answer)).toEqual(first);
  expect(f.snapshot().revision).toBe(2);
  expect((await f.service.handle({ ...answer, text: "Уфа" }))?.status).toBe(
    "rejected",
  );
});

it("rejects prototype names as permanent invalid edit controls", async () => {
  const f = fixture();
  for (const [i, field] of ["constructor", "toString", "__proto__"].entries()) {
    const result = await f.service.handle({
      ...scope,
      updateId: 800 + i,
      text: `/set ${field} value`,
    });
    expect(result?.status).toBe("handled");
    expect(f.snapshot().revision).toBe(0);
  }
});
