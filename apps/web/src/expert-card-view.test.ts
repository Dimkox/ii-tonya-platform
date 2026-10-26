import { expect, it, vi } from "vitest";
import {
  bindExpertCardReview,
  renderExpertCardReview,
} from "./expert-card-view.js";
import { createExpertCardClient } from "./expert-card-client.js";
import type {
  ExpertCardAdminClient,
  ExpertCardDraft,
} from "./expert-card-client.js";
const id = "11111111-1111-4111-8111-111111111111",
  reviewId = "22222222-2222-4222-8222-222222222222";
const publicCard = {
  displayName: "Эксперт",
  profession: "Коуч",
  city: "Москва",
  summary: "Описание практики",
};
const draft: ExpertCardDraft = {
  applicationId: id,
  draftId: id,
  revision: 3,
  status: "manager_review",
  entryCount: 2,
  materialStatus: "waiting_content",
  promoConfirmed: false,
  publicCard,
  approvedReviewId: null,
  materials: null,
  promoProofs: [],
  entries: [
    {
      id,
      kind: "text",
      text: "<img src=x> PRIVATE",
      reference: null,
      revision: 1,
    },
    {
      id: reviewId,
      kind: "document",
      text: null,
      reference: "telegram:file:SyntheticDoc",
      revision: 2,
    },
  ],
};
class E {
  textContent = "";
  value = "";
  disabled = false;
  checked = false;
  onchange: (() => void) | null = null;
  hidden = false;
  type = "";
  innerHTML = "";
  children: E[] = [];
  onclick: (() => void) | null = null;
  replaceChildren() {
    this.children = [];
    this.textContent = "";
  }
  append(...children: E[]) {
    this.children.push(...children);
  }
  setAttribute() {}
  click() {
    if (!this.disabled) this.onclick?.();
  }
}
function setup(clientOverride?: ExpertCardAdminClient) {
  const names = [
    "refresh",
    "queue",
    "detail",
    "status",
    "displayName",
    "profession",
    "city",
    "summary",
    "save",
    "approve",
    "return",
    "promo",
    "warning-ack",
  ];
  const nodes = new Map(names.map((n) => [n, new E()]));
  const root = {
    ownerDocument: { createElement: () => new E() },
    querySelector: (s: string) =>
      nodes.get(s.replace("[data-card-", "").replace("]", "")) ?? null,
  };
  const port = {
    list: vi.fn(async () => [draft]),
    read: vi.fn(async () => draft),
    edit: vi.fn(async () => ({ ...draft, revision: 4, replay: false })),
    review: vi.fn(async () => ({ ...draft, replay: false })),
    confirmPromo: vi.fn(async () => ({
      ...draft,
      promoConfirmed: true,
      replay: false,
    })),
  };
  let client: ExpertCardAdminClient | undefined = clientOverride ?? port;
  const unauthorized = vi.fn();
  let keySequence = 0;
  const ui = bindExpertCardReview(root as unknown as HTMLElement, {
    getClient: () => client,
    onUnauthorized: unauthorized,
    randomKey: () => `synthetic-key-${++keySequence}`,
  });
  return {
    get: (n: string) => nodes.get(n)!,
    port,
    ui,
    unauthorized,
    disconnect: () => {
      client = undefined;
      ui.reset();
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
async function select(f: ReturnType<typeof setup>) {
  f.get("refresh").click();
  await flush();
  f.get("queue").children[0]!.click();
  await flush();
}
it("renders actual edit/approve/return/promo controls without paid or sent toggles", () => {
  const html = renderExpertCardReview();
  expect(html).toContain("data-card-save");
  expect(html).toContain("data-card-approve");
  expect(html).toContain("data-card-return");
  expect(html).toContain("data-card-promo");
  expect(html).not.toMatch(/data-card-(?:paid|active|sent)/u);
});
it("shows protected raw refs as text and separates public editing", async () => {
  const f = setup();
  await select(f);
  expect(
    f
      .get("detail")
      .children.map((n) => n.textContent)
      .join(" "),
  ).toContain("<img src=x> PRIVATE");
  expect(
    f
      .get("detail")
      .children.map((n) => n.textContent)
      .join(" "),
  ).toContain("telegram:file:SyntheticDoc");
  expect(f.get("detail").innerHTML).toBe("");
  expect(f.get("summary").value).toBe(publicCard.summary);
  expect(f.get("promo").disabled).toBe(true);
});
it("does not auto-copy private interview text into a missing public payload", async () => {
  const f = setup();
  f.port.read.mockResolvedValueOnce({ ...draft, publicCard: null });
  await select(f);
  expect(f.get("displayName").value).toBe("");
  expect(f.get("summary").value).toBe("");
  expect(f.get("approve").disabled).toBe(true);
});
it("edits strict public fields then approves the refreshed revision", async () => {
  const f = setup();
  f.port.read
    .mockResolvedValueOnce(draft)
    .mockResolvedValueOnce({
      ...draft,
      revision: 4,
      publicCard: { ...publicCard, summary: "Исправленный текст" },
    })
    .mockResolvedValueOnce({
      ...draft,
      revision: 4,
      status: "approved",
      approvedReviewId: reviewId,
    });
  await select(f);
  f.get("summary").value = "Исправленный текст";
  f.get("save").click();
  f.get("save").click();
  await flush();
  expect(f.port.edit).toHaveBeenCalledWith(id, {
    expectedRevision: 3,
    publicCard: { ...publicCard, summary: "Исправленный текст" },
    idempotencyKey: "synthetic-key-1",
  });
  expect(f.port.edit).toHaveBeenCalledTimes(1);
  f.get("approve").click();
  await flush();
  expect(f.port.review).toHaveBeenCalledWith(id, {
    expectedRevision: 4,
    action: "approve",
    idempotencyKey: "synthetic-key-2",
  });
});
it("reuses an uncertain mutation key/payload instead of silently editing its authority", async () => {
  const f = setup();
  f.port.edit.mockRejectedValueOnce(new Error("private network prose"));
  await select(f);
  f.get("summary").value = "Исправленный текст";
  f.get("save").click();
  await flush();
  f.get("summary").value = "Другой текст";
  f.get("save").click();
  await flush();
  expect(f.port.edit.mock.calls[0]).toEqual(f.port.edit.mock.calls[1]);
  expect(f.get("status").textContent).not.toContain("private network prose");
});
it("confirms promo only for actually delivered current approved review and proofs", async () => {
  const f = setup();
  f.port.read.mockResolvedValueOnce({
    ...draft,
    status: "approved",
    materialStatus: "delivered",
    approvedReviewId: reviewId,
    materials: { jobId: id, status: "delivered", contentVersion: "v1" },
    promoProofs: [
      {
        id,
        kind: "link",
        reference: "https://example.test/proof",
        revision: 3,
        reviewId,
      },
    ],
  });
  await select(f);
  expect(f.get("promo").disabled).toBe(false);
  f.get("promo").click();
  await flush();
  expect(f.port.confirmPromo).toHaveBeenCalledWith(id, {
    expectedRevision: 3,
    idempotencyKey: "synthetic-key-1",
  });
});
it("clears raw refs/form/pending state and rejects a late response after shared logout", async () => {
  const f = setup();
  const waiting = Promise.withResolvers<ExpertCardDraft>();
  f.port.read.mockImplementationOnce(() => waiting.promise);
  f.get("refresh").click();
  await flush();
  f.get("queue").children[0]!.click();
  f.disconnect();
  waiting.resolve(draft);
  await flush();
  expect(f.get("detail").children).toHaveLength(0);
  expect(f.get("summary").value).toBe("");
  expect(f.get("approve").disabled).toBe(true);
});
it("delegates authorization failure to shared session teardown", async () => {
  const f = setup();
  f.port.list.mockRejectedValueOnce(new Error("verification_unauthorized"));
  f.get("refresh").click();
  await flush();
  expect(f.unauthorized).toHaveBeenCalledOnce();
});

it("keeps promo confirmation disabled while delivery outcome is unknown", async () => {
  const f = setup();
  f.port.read.mockResolvedValueOnce({
    ...draft,
    status: "approved",
    materialStatus: "unknown_outcome",
    approvedReviewId: reviewId,
    materials: { jobId: id, status: "unknown_outcome", contentVersion: "v1" },
    promoProofs: [
      {
        id,
        kind: "link",
        reference: "https://example.test/proof",
        revision: 3,
        reviewId,
      },
    ],
  });
  await select(f);
  expect(f.get("promo").disabled).toBe(true);
  expect(
    f
      .get("detail")
      .children.map((n) => n.textContent)
      .join(" "),
  ).toContain("Исход доставки неизвестен");
  f.get("promo").click();
  expect(f.port.confirmPromo).not.toHaveBeenCalled();
});

it("returns the current revision for changes through the actual staff control", async () => {
  const f = setup();
  f.port.read
    .mockResolvedValueOnce(draft)
    .mockResolvedValueOnce({ ...draft, status: "changes_requested" });
  await select(f);
  f.get("return").click();
  await flush();
  expect(f.port.review).toHaveBeenCalledWith(id, {
    expectedRevision: 3,
    action: "return_changes",
    idempotencyKey: "synthetic-key-1",
  });
  expect(f.get("approve").disabled).toBe(true);
});

it("requires visible current-warning acknowledgment and sends the displayed content digest", async () => {
  const f = setup();
  const sensitive = {
    ...draft,
    effectiveFields: { "entry:current": "#приворот" },
    safety: {
      policyId: id,
      revision: 3,
      digest: "a".repeat(64),
      blocked: false,
      issues: [
        {
          field: "entry:current",
          ruleId: id,
          severity: "WARNING" as const,
          reason: "Личное рассмотрение",
        },
      ],
    },
  };
  f.port.read.mockResolvedValue(sensitive);
  await select(f);
  expect(
    f
      .get("detail")
      .children.map((n) => n.textContent)
      .join(" "),
  ).toContain("#приворот");
  expect(f.get("approve").disabled).toBe(true);
  f.get("warning-ack").checked = true;
  f.get("warning-ack").onchange?.();
  expect(f.get("approve").disabled).toBe(false);
  f.get("approve").click();
  await flush();
  expect(f.port.review).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ warningAcknowledgment: "a".repeat(64) }),
  );
  expect(f.get("warning-ack").checked).toBe(false);
});
it("lets the manager return an approved card whose current policy blocks its content", async () => {
  const f = setup();
  f.port.read.mockResolvedValue({
    ...draft,
    status: "approved",
    approvedReviewId: reviewId,
    safety: {
      policyId: id,
      revision: 3,
      digest: "b".repeat(64),
      blocked: true,
      issues: [
        {
          field: "entry:current",
          ruleId: id,
          severity: "BLOCKER",
          reason: "Исправьте ответ",
        },
      ],
    },
  });
  await select(f);
  expect(f.get("return").disabled).toBe(false);
  f.get("return").click();
  await flush();
  expect(f.port.review).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ action: "return_changes" }),
  );
});

it("R4 actual client refusal unlocks public correction and uses a fresh key without a success display", async () => {
  const sent: Record<string, unknown>[] = [];
  let current = { ...draft };
  const client = createExpertCardClient(async (path, body) => {
    if (body) {
      sent.push(structuredClone(body as Record<string, unknown>));
      if (sent.length === 1)
        return {
          kind: "ok",
          item: {
            ...current,
            replay: false,
            safetyBlocked: true,
            safetyIssues: [
              {
                field: "public:summary",
                ruleId: id,
                severity: "BLOCKER",
                reason: "Исправьте обещание лечения",
              },
            ],
          },
        };
      current = {
        ...current,
        revision: 4,
        publicCard: (body as { publicCard: typeof publicCard }).publicCard,
      };
      return { kind: "ok", item: { ...current, replay: false } };
    }
    return path.startsWith("?")
      ? { kind: "ok", items: [current] }
      : { kind: "ok", item: current };
  });
  const f = setup(client);
  await select(f);
  f.get("summary").value = "вылечу рак";
  f.get("save").click();
  await flush();
  expect(f.get("status").textContent).toContain("Исправьте обещание лечения");
  expect(f.get("status").textContent).not.toContain("Действие сохранено");
  expect(f.get("summary").disabled).toBe(false);
  f.get("summary").value = "Работаю с темой благополучия";
  f.get("save").click();
  await flush();
  expect(sent).toHaveLength(2);
  expect(sent[1]!.idempotencyKey).not.toBe(sent[0]!.idempotencyKey);
  expect(sent[1]!.publicCard).toMatchObject({
    summary: "Работаю с темой благополучия",
  });
  expect(f.get("status").textContent).toContain("Действие сохранено");
});
it("R4 actual client refusal permits fresh current-warning acknowledgment while unknown transport retains exact retry", async () => {
  const sent: Record<string, unknown>[] = [];
  let current: ExpertCardDraft = {
    ...draft,
    safety: {
      policyId: id,
      revision: 3,
      digest: "a".repeat(64),
      blocked: false,
      issues: [
        {
          field: "entry:current",
          ruleId: id,
          severity: "WARNING",
          reason: "Личное рассмотрение",
        },
      ],
    },
  };
  const client = createExpertCardClient(async (path, body) => {
    if (body) {
      sent.push(structuredClone(body as Record<string, unknown>));
      if (sent.length === 1) {
        current = {
          ...current,
          safety: { ...current.safety!, digest: "b".repeat(64) },
        };
        return {
          kind: "ok",
          item: {
            ...current,
            replay: false,
            safetyBlocked: true,
            safetyIssues: current.safety!.issues,
          },
        };
      }
      if (sent.length === 2) throw new Error("network_unknown");
      current = { ...current, status: "approved", approvedReviewId: reviewId };
      return { kind: "ok", item: { ...current, replay: false } };
    }
    return path.startsWith("?")
      ? { kind: "ok", items: [current] }
      : { kind: "ok", item: current };
  });
  const f = setup(client);
  await select(f);
  f.get("warning-ack").checked = true;
  f.get("warning-ack").onchange?.();
  f.get("approve").click();
  await flush();
  expect(f.get("status").textContent).not.toContain("Действие сохранено");
  await select(f);
  expect(f.get("warning-ack").checked).toBe(false);
  f.get("warning-ack").checked = true;
  f.get("warning-ack").onchange?.();
  f.get("approve").click();
  await flush();
  expect(sent[1]!.idempotencyKey).not.toBe(sent[0]!.idempotencyKey);
  expect(sent[1]!.warningAcknowledgment).toBe("b".repeat(64));
  expect(f.get("summary").disabled).toBe(true);
  f.get("approve").click();
  await flush();
  expect(sent[2]).toEqual(sent[1]);
  expect(f.get("status").textContent).toContain("Действие сохранено");
});
