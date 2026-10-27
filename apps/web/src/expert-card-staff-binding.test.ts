import { afterEach, expect, it, vi } from "vitest";
import {
  bindExpertVerificationActions,
  renderExpertVerificationPage,
} from "./expert-verification-view.js";
const id = "11111111-1111-4111-8111-111111111111";
const workflow = {
  applicationId: id,
  draftId: id,
  revision: 1,
  status: "manager_review",
  entryCount: 1,
  materialStatus: "waiting_content",
  promoConfirmed: false,
};
const card = {
  ...workflow,
  publicCard: null,
  approvedReviewId: null,
  materials: null,
  promoProofs: [],
  entries: [
    {
      id,
      kind: "document",
      text: null,
      reference: "telegram:file:PrivateSyntheticDoc",
      revision: 1,
    },
  ],
};
class E {
  textContent = "";
  value = "";
  disabled = false;
  hidden = false;
  type = "";
  href = "";
  rel = "";
  children: E[] = [];
  onclick: (() => void) | null = null;
  oninput: (() => void) | null = null;
  replaceChildren() {
    this.children = [];
    this.textContent = "";
  }
  append(...c: E[]) {
    this.children.push(...c);
  }
  click() {
    if (!this.disabled) this.onclick?.();
  }
}
function setup(fetcher: typeof fetch) {
  vi.stubGlobal("fetch", fetcher);
  const win = new EventTarget(),
    doc = { defaultView: win, createElement: () => new E() };
  const bNames = [
      "token",
      "connect",
      "logout",
      "refresh",
      "status",
      "queue",
      "detail",
      "approve",
      "reject",
      "reason",
      "recover",
      "payment",
      "invoice",
    ],
    cNames = [
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
    ];
  const b = new Map(bNames.map((n) => [n, new E()])),
    c = new Map(cNames.map((n) => [n, new E()]));
  const cards = {
    ownerDocument: doc,
    querySelector: (s: string) =>
      c.get(s.replace("[data-card-", "").replace("]", "")) ?? null,
  };
  const root = {
    ownerDocument: doc,
    querySelector: (s: string) =>
      s === "[data-expert-card-root]"
        ? cards
        : (b.get(s.replace("[data-verification-", "").replace("]", "")) ??
          null),
  };
  bindExpertVerificationActions(root as unknown as HTMLElement);
  return { b: (n: string) => b.get(n)!, c: (n: string) => c.get(n)!, win };
}
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });
afterEach(() => vi.unstubAllGlobals());
it("wires actual card panel to the same issued session and clears both on pagehide", async () => {
  const requests: string[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      requests.push(path);
      expect(init?.credentials).toBe("omit");
      expect(init?.cache).toBe("no-store");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer synthetic-session-token-1234567890",
      );
      return path.includes("/expert-verification?")
        ? json({ kind: "ok", items: [] })
        : path.includes("/expert-cards?")
          ? json({ kind: "ok", items: [workflow] })
          : json({ kind: "ok", item: card });
    },
  );
  const f = setup(fetcher);
  expect(renderExpertVerificationPage()).toContain("data-expert-card-root");
  expect(f.c("refresh").disabled).toBe(true);
  f.b("token").value = "synthetic-session-token-1234567890";
  f.b("connect").click();
  await flush();
  expect(f.c("refresh").disabled).toBe(false);
  f.c("refresh").click();
  await flush();
  f.c("queue").children[0]!.click();
  await flush();
  expect(
    f
      .c("detail")
      .children.map((n) => n.textContent)
      .join(" "),
  ).toContain("telegram:file:PrivateSyntheticDoc");
  expect(requests.every((p) => p.startsWith("/v1/admin/"))).toBe(true);
  expect(f.b("token").value).toBe("");
  f.win.dispatchEvent(new Event("pagehide"));
  expect(f.c("queue").children).toHaveLength(0);
  expect(f.c("detail").children).toHaveLength(0);
  expect(f.b("queue").children).toHaveLength(0);
  expect(f.c("refresh").disabled).toBe(true);
});
it("shared logout rejects a late real-client draft response", async () => {
  const waiting = Promise.withResolvers<Response>();
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("/expert-verification?")
      ? json({ kind: "ok", items: [] })
      : String(input).includes("/expert-cards?")
        ? json({ kind: "ok", items: [workflow] })
        : waiting.promise,
  );
  const f = setup(fetcher);
  f.b("token").value = "synthetic-session-token-1234567890";
  f.b("connect").click();
  await flush();
  f.c("refresh").click();
  await flush();
  f.c("queue").children[0]!.click();
  f.b("logout").click();
  waiting.resolve(json({ kind: "ok", item: card }));
  await flush();
  expect(f.c("detail").children).toHaveLength(0);
  expect(f.c("summary").value).toBe("");
  expect(f.c("approve").disabled).toBe(true);
});
