import { expect, it } from "vitest";
import {
  createResidentVerificationService,
  type ResidentFormRepository,
  type ResidentFormSnapshot,
} from "./resident-verification-service.js";
import { applyResidentPatch, type ResidentPolicy } from "@ii-tonya/domain";
const scope = {
  botId: "717171",
  botKey: "resident-promo",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
};
function fixture(
  initial: Partial<ResidentFormSnapshot> = {},
  policy?: ResidentPolicy,
) {
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
    service: createResidentVerificationService({
      enabled: true,
      repository,
      ...(policy ? { policy } : {}),
    }),
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
it("remediation: text role changes clear incompatible primary and preserve other answers", async () => {
  const f = fixture({
    draft: {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      city: "Москва",
      specialization: "Практика",
    },
  });
  const reply = await f.service.handle({
    ...scope,
    updateId: 900,
    text: "/set roles OTHER",
  });
  expect(reply?.status).toBe("handled");
  expect(f.snapshot().draft).toEqual({
    roles: ["OTHER"],
    city: "Москва",
    specialization: "Практика",
  });
  expect(JSON.stringify(reply)).toContain("p:OTHER");
});
it("remediation: rejects unexpected media and empty supplements as permanent corrective responses", async () => {
  const f = fixture({
    draft: {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      category: "BASIC",
      tax: "IP",
    },
    currentField: "city",
  });
  const before = structuredClone(f.snapshot());
  const reply = await f.service.handle({
    ...scope,
    updateId: 901,
    text: "",
    media: {
      kind: "document",
      fileId: "wrong_place",
      mimeType: null,
      size: null,
    },
  });
  expect(reply?.status).toBe("handled");
  expect(f.snapshot()).toEqual(before);
  const submitted = fixture({ status: "UNDER_REVIEW", progress: "AUTO_CHECK" });
  expect(
    (await submitted.service.handle({ ...scope, updateId: 902, text: "  " }))
      ?.status,
  ).toBe("handled");
  expect(submitted.snapshot().revision).toBe(0);
});
it("remediation: policy mismatch is read-only manual review without new-policy controls", async () => {
  const f = fixture({
    policyVersion: "saved_v1",
    educationRequirement: "required",
    draft: { roles: ["EXPERT"] },
  } as Partial<ResidentFormSnapshot>);
  const reply = await f.service.handle({
    ...scope,
    updateId: 903,
    text: "/verification",
  });
  expect(reply?.status).toBe("handled");
  expect(reply?.text).toContain("правила анкеты изменились");
  expect(JSON.stringify(reply)).not.toContain("inline_keyboard");
  expect(f.snapshot().revision).toBe(0);
});
it("remediation: optional documents can be skipped, removed and replaced at the limit", async () => {
  const f = fixture({
    currentField: "education",
    draft: {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      education: Array.from({ length: 10 }, (_, i) => ({
        kind: "document",
        fileId: `private_${i}`,
        mimeType: null,
        size: null,
      })),
    },
  });
  const menu = await f.service.handle({
    ...scope,
    updateId: 904,
    text: "/verification",
  });
  expect(JSON.stringify(menu)).toContain("back");
  expect(JSON.stringify(menu)).toContain("replace:d");
  expect(JSON.stringify(menu)).toContain("rm:d_9");
  const click = (updateId: number, op: string) =>
    f.service.handle({
      ...scope,
      updateId,
      text: "",
      callbackData: `rv:${f.snapshot().id}:${f.snapshot().revision}:${op}`,
    });
  await click(905, "rm:d_9");
  expect(f.snapshot().draft.education).toHaveLength(9);
  await click(906, "replace:d");
  expect(f.snapshot().draft.education).toEqual([]);
  await click(907, "back");
  expect(f.snapshot().currentField).toBeNull();
});
it("remediation: confirmation summarizes bounded owned facts without private document IDs", async () => {
  const f = fixture({
    draft: {
      roles: ["OTHER"],
      primaryRole: "OTHER",
      category: "BASIC",
      tax: "INDIVIDUAL",
      city: "Казань",
      socialLinks: ["https://example.com/me"],
      motivation: "я".repeat(3000),
      path: "Путь",
      cases: "Кейсы",
      education: [
        {
          kind: "document",
          fileId: "private_never_display",
          mimeType: null,
          size: null,
        },
      ],
    },
  });
  const reply = await f.service.handle({
    ...scope,
    updateId: 908,
    text: "/verification",
  });
  expect(reply?.text).toContain("Казань");
  expect(reply?.text).toContain("Физическое лицо");
  expect(reply?.text).toContain("Образование: 1");
  expect(reply?.text?.length).toBeLessThan(2000);
  expect(JSON.stringify(reply)).not.toContain("private_never_display");
});

it("remediation: required document cursor has no skip and rejects a forged back action", async () => {
  const policy = { version: "required_v1", education: "required" as const };
  const f = fixture(
    {
      policyVersion: policy.version,
      educationRequirement: policy.education,
      currentField: "education",
      draft: { roles: ["EXPERT"], primaryRole: "EXPERT" },
    },
    policy,
  );
  const prompt = await f.service.handle({
    ...scope,
    updateId: 950,
    text: "/verification",
  });
  expect(JSON.stringify(prompt)).not.toContain('"back"');
  expect(
    (
      await f.service.handle({
        ...scope,
        updateId: 951,
        text: "",
        callbackData: `rv:${f.snapshot().id}:0:back`,
      })
    )?.status,
  ).toBe("rejected");
  expect(f.snapshot().revision).toBe(0);
});
it("remediation: cumulative caption overflow is corrective and preserves the saved draft", async () => {
  const f = fixture({
    currentField: "propertyEvidence",
    draft: {
      roles: ["EXPERT", "CENTER"],
      primaryRole: "CENTER",
      education: Array.from({ length: 10 }, (_, i) => ({
        kind: "document",
        fileId: `private_${i}`,
        mimeType: null,
        size: null,
        caption: "я".repeat(3000),
      })),
    },
  });
  const before = structuredClone(f.snapshot());
  const reply = await f.service.handle({
    ...scope,
    updateId: 952,
    text: "",
    media: {
      kind: "document",
      fileId: "too_much_combined",
      mimeType: null,
      size: null,
      caption: "я".repeat(3000),
    },
  });
  expect(reply?.status).toBe("handled");
  expect(reply?.text).toContain("не изменены");
  expect(f.snapshot()).toEqual(before);
});

it("remediation: Russian choice labels preserve canonical callback enum values", async () => {
  const f = fixture();
  const role = await f.service.handle({
    ...scope,
    updateId: 953,
    text: "/verification",
  });
  expect(JSON.stringify(role)).toContain("Образовательный проект");
  expect(JSON.stringify(role)).toContain(":r:EDU_PROJECT");
  const tax = fixture({
    currentField: "tax",
    draft: { roles: ["EXPERT"], primaryRole: "EXPERT" },
  });
  const taxReply = await tax.service.handle({
    ...scope,
    updateId: 954,
    text: "/verification",
  });
  expect(JSON.stringify(taxReply)).toContain("Самозанятый");
  expect(JSON.stringify(taxReply)).toContain(":t:SELF_EMPLOYED");
});
it("closure: Unicode URL expansion is a permanent correction and preserves the saved draft", async () => {
  const f = fixture({
    currentField: "socialLinks",
    draft: { socialLinks: ["https://example.com/saved"], city: "Казань" },
  });
  const before = structuredClone(f.snapshot());
  const response = await f.service.handle({
    ...scope,
    updateId: 960,
    text: "https://example.com/" + "я".repeat(100),
  });
  expect(response?.status).toBe("handled");
  expect(response?.text).toContain("не изменены");
  expect(f.snapshot()).toEqual(before);
});
it.each([
  ["1500050", "15 000,50 ₽"],
  ["999999999999", "9 999 999 999,99 ₽"],
  ["0", "0,00 ₽"],
])(
  "closure: confirmation shows applicant average check %s with integer-safe formatting",
  async (averageCheckMinor, formatted) => {
    const f = fixture({
      draft: {
        roles: ["EXPERT"],
        primaryRole: "EXPERT",
        category: "BASIC",
        tax: "SELF_EMPLOYED",
        city: "Москва",
        socialLinks: ["https://example.com/me"],
        motivation: "я".repeat(3000),
        specialization: "Практика",
        averageCheckMinor,
        education: [
          {
            kind: "document",
            fileId: "private_never_show",
            mimeType: null,
            size: null,
          },
        ],
      },
    });
    const response = await f.service.handle({
      ...scope,
      updateId: 961,
      text: "/verification",
    });
    expect(response?.status).toBe("handled");
    expect(response?.text).toContain(`Ваш средний чек услуг: ${formatted}`);
    expect(response?.text).toContain("не цена подписки");
    expect(response?.text?.length).toBeLessThan(2000);
    expect(response?.text).not.toContain("private_never_show");
  },
);
