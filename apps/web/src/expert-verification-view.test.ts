import { afterEach, expect, it, vi } from "vitest";
import {
  bindExpertVerificationActions,
  renderExpertVerificationPage,
} from "./expert-verification-view.js";
import type {
  VerificationDetail,
  VerificationEntry,
} from "./expert-verification-client.js";
const id = "11111111-1111-4111-8111-111111111111";
const entry: VerificationEntry = {
  applicationId: id,
  status: "pending",
  maskedContact: "telegram:***",
  quoteId: id,
  termMonths: 1,
  priceMinor: "999000",
  currency: "RUB",
};
const detail: VerificationDetail = {
  ...entry,
  userId: id,
  contact: [{ provider: "telegram", externalId: "12345" }],
  questionnaire: {
    status: "waiting_content",
    contentSlot: "TODO: Wait for Content Spec",
  },
};
class NodeDouble {
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  type = "";
  href = "";
  rel = "";
  children: NodeDouble[] = [];
  onclick: (() => void) | null = null;
  oninput: (() => void) | null = null;
  attributes = new Map<string, string>();
  replaceChildren() {
    this.children = [];
    this.textContent = "";
  }
  append(...nodes: NodeDouble[]) {
    this.children.push(...nodes);
  }
  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  }
  click() {
    if (!this.disabled) this.onclick?.();
  }
}
function setup() {
  const names = [
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
  ];
  const nodes = new Map(names.map((n) => [n, new NodeDouble()]));
  nodes.get("reason")!.value = "credentials_incomplete";
  const win = new EventTarget();
  const doc = { createElement: () => new NodeDouble(), defaultView: win };
  const root = {
    ownerDocument: doc,
    querySelector: (s: string) =>
      nodes.get(s.replace("[data-verification-", "").replace("]", "")) ?? null,
  };
  const client = {
    list: vi.fn(async () => [entry]),
    detail: vi.fn(async () => detail),
    decide: vi.fn(async () => ({
      applicationId: id,
      decision: "approved" as const,
      invoiceId: id,
      replay: false,
      payment: { status: "waiting_configuration" as const },
    })),
    recover: vi.fn(async () => ({ status: "pending" as const })),
    clear: vi.fn(),
  };
  const createClient = vi.fn(() => client);
  const dispose = bindExpertVerificationActions(
    root as unknown as HTMLElement,
    { createClient, randomKey: () => "synthetic-key-123" },
  );
  return {
    nodes,
    client,
    createClient,
    win,
    dispose,
    get: (n: string) => nodes.get(n)!,
  };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
afterEach(() => vi.unstubAllGlobals());
it("renders actual manager controls with password token and no personal cabinet", () => {
  const html = renderExpertVerificationPage();
  expect(html).toContain('type="password"');
  expect(html).toContain("data-verification-approve");
  expect(html).toContain("data-verification-reject");
  expect(html).toContain("data-verification-recover");
  expect(html).not.toContain("localStorage");
});
it("connects queue, protected detail and explicit approval buttons", async () => {
  const f = setup();
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  expect(f.get("token").value).toBe("");
  expect(f.get("queue").children[0]!.textContent).toContain("telegram:***");
  f.get("queue").children[0]!.click();
  await flush();
  expect(
    f
      .get("detail")
      .children.map((n) => n.textContent)
      .join(" "),
  ).toContain("12345");
  expect(
    f
      .get("detail")
      .children.map((n) => n.textContent)
      .join(" "),
  ).toContain("TODO: Wait for Content Spec");
  f.get("approve").click();
  f.get("approve").click();
  await flush();
  expect(f.client.decide).toHaveBeenCalledTimes(1);
  expect(f.client.decide).toHaveBeenCalledWith(
    id,
    "approved",
    "verified",
    "synthetic-key-123",
  );
  expect(f.get("recover").disabled).toBe(false);
  f.get("recover").click();
  await flush();
  expect(f.client.recover).toHaveBeenCalledWith(id);
});
it("reuses uncertain decision key and never duplicates concurrent clicks", async () => {
  const f = setup();
  f.client.decide.mockRejectedValueOnce(new Error("private synthetic error"));
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  f.get("queue").children[0]!.click();
  await flush();
  f.get("reject").click();
  await flush();
  f.get("reject").click();
  await flush();
  expect(f.client.decide.mock.calls[0]).toEqual(f.client.decide.mock.calls[1]);
  expect(f.get("status").textContent).not.toContain("private synthetic error");
});
it("clears PII and aborts memory session on logout and pagehide", async () => {
  const f = setup();
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  f.get("queue").children[0]!.click();
  await flush();
  f.win.dispatchEvent(new Event("pagehide"));
  expect(f.client.clear).toHaveBeenCalledOnce();
  expect(f.get("queue").children).toHaveLength(0);
  expect(f.get("detail").children).toHaveLength(0);
  expect(f.get("payment").children).toHaveLength(0);
  expect(f.get("approve").disabled).toBe(true);
});
it("does not render a late detail after logout", async () => {
  const f = setup();
  const pending = Promise.withResolvers<VerificationDetail>();
  f.client.detail.mockImplementationOnce(() => pending.promise);
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  f.get("queue").children[0]!.click();
  f.get("logout").click();
  pending.resolve(detail);
  await flush();
  expect(f.get("detail").children).toHaveLength(0);
});
it("clears private state on server authorization failure", async () => {
  const f = setup();
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  f.client.detail.mockRejectedValueOnce(new Error("verification_unauthorized"));
  f.get("queue").children[0]!.click();
  await flush();
  expect(f.client.clear).toHaveBeenCalledOnce();
  expect(f.get("queue").children).toHaveLength(0);
  expect(f.get("detail").children).toHaveLength(0);
});

it("recovers a known invoice after reconnecting without repeating a manager decision", async () => {
  const f = setup();
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  f.get("invoice").value = id;
  f.get("invoice").oninput?.();
  f.get("recover").click();
  await flush();
  expect(f.client.recover).toHaveBeenCalledWith(id);
  expect(f.client.decide).not.toHaveBeenCalled();
  f.get("logout").click();
  expect(f.get("invoice").value).toBe("");
});

it("recovers an existing invoice after an uncertain decision and fresh session without another decision", async () => {
  const f = setup();
  f.client.list.mockResolvedValueOnce([entry]).mockResolvedValueOnce([]);
  f.client.decide.mockRejectedValueOnce(new Error("synthetic-lost-response"));
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  f.get("queue").children[0]!.click();
  await flush();
  f.get("approve").click();
  await flush();
  f.get("logout").click();
  f.get("token").value = "synthetic-session-token-1234567890";
  f.get("connect").click();
  await flush();
  expect(f.get("queue").children).toHaveLength(0);
  f.get("invoice").value = id;
  f.get("invoice").oninput?.();
  f.get("recover").click();
  await flush();
  expect(f.client.recover).toHaveBeenCalledWith(id);
  expect(f.client.decide).toHaveBeenCalledTimes(1);
  expect(f.createClient).toHaveBeenCalledTimes(2);
});
