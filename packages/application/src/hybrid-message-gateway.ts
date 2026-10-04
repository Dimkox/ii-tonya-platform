import { createHash } from "node:crypto";

export type HybridRoute = "deterministic" | "complex_dialogue";
export type HybridResult =
  | { readonly status: "accepted"; readonly route: HybridRoute }
  | {
      readonly status:
        "duplicate" | "conflict" | "rejected" | "disabled" | "unavailable";
    };
type Update = {
  update_id: bigint;
  message: {
    chat: { id: number; type: "private" };
    from: { id: number };
    text: string;
  };
};
export interface HybridMessageGatewayDeps {
  enabled?: boolean;
  botKey?: string;
  routingEnabled?: boolean | undefined;
  costAdmissionEnabled?: boolean | undefined;
  clock?: () => Date;
  messagingConsentPolicyVersion?: string;
  selartiConsentPolicyVersion?: string;
  hasMessagingConsent?: (userId: string) => Promise<boolean>;
  budgetMetric?: (
    outcome: "admitted" | "warning" | "soft_stop" | "hard_stop",
  ) => void;
  persist: (input: {
    updateId: bigint;
    provider: "telegram";
    botKey: string;
    externalUserId: string;
    externalChatId: string;
    payloadHash: string;
    text: string;
    route: HybridRoute;
    routingEnabled: boolean;
    costAdmissionEnabled?: boolean;
    correlationId: string;
    locale: string;
    deadline: string;
    occurredAt: string;
    messagingConsentPolicyVersion: string;
    selartiConsentPolicyVersion?: string;
    localReplyText?: string;
  }) => Promise<
    | "claimed"
    | "warning"
    | "duplicate"
    | "conflict"
    | "rejected"
    | "soft_stop"
    | "hard_stop"
  >;
}
const control = /[\u0000-\u001F\u007F-\u009F]/u;
const deterministic = /^(?:\/help|\/start|\/stop|старт|помощь|отмена)$/iu;
const parse = (value: unknown): Update | null => {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const m = root.message;
  const id =
    typeof root.update_id === "number" && Number.isSafeInteger(root.update_id)
      ? BigInt(root.update_id)
      : typeof root.update_id === "string" && /^\d+$/u.test(root.update_id)
        ? BigInt(root.update_id)
        : null;
  if (id === null || !m || typeof m !== "object") return null;
  const r = m as Record<string, unknown>;
  const c = r.chat;
  const f = r.from;
  if (!c || typeof c !== "object" || !f || typeof f !== "object") return null;
  const chat = c as Record<string, unknown>;
  const from = f as Record<string, unknown>;
  if (
    chat.type !== "private" ||
    !Number.isSafeInteger(chat.id) ||
    !Number.isSafeInteger(from.id) ||
    chat.id !== from.id ||
    typeof r.text !== "string" ||
    r.text.length === 0 ||
    Buffer.byteLength(r.text, "utf8") > 4096 ||
    control.test(r.text)
  )
    return null;
  return {
    update_id: id,
    message: {
      chat: { id: chat.id as number, type: "private" },
      from: { id: from.id as number },
      text: r.text,
    },
  };
};
export class HybridMessageGateway {
  constructor(private readonly deps: HybridMessageGatewayDeps) {}
  async handle(raw: unknown): Promise<HybridResult> {
    if (this.deps.enabled !== true) return { status: "disabled" };
    const update = parse(raw);
    if (!update || !this.deps.botKey) return { status: "rejected" };
    const canonical = JSON.stringify({
      updateId: update.update_id.toString(),
      botKey: this.deps.botKey,
      chatId: update.message.chat.id,
      userId: update.message.from.id,
      text: update.message.text,
    });
    const route = deterministic.test(update.message.text)
      ? "deterministic"
      : "complex_dialogue";
    if (route === "complex_dialogue" && this.deps.routingEnabled !== true)
      return { status: "unavailable" };
    if (!this.deps.messagingConsentPolicyVersion) return { status: "rejected" };
    if (route === "complex_dialogue") {
      if (this.deps.hasMessagingConsent === undefined)
        return { status: "rejected" };
      try {
        if (
          !(await this.deps.hasMessagingConsent(String(update.message.from.id)))
        )
          return { status: "rejected" };
      } catch {
        return { status: "unavailable" };
      }
    }
    const occurredAt = (this.deps.clock ?? (() => new Date()))();
    const result = await this.deps.persist({
      updateId: update.update_id,
      provider: "telegram",
      botKey: this.deps.botKey,
      externalUserId: String(update.message.from.id),
      externalChatId: String(update.message.chat.id),
      payloadHash: createHash("sha256").update(canonical).digest("hex"),
      text: update.message.text,
      route,
      routingEnabled: this.deps.routingEnabled === true,
      costAdmissionEnabled: this.deps.costAdmissionEnabled === true,
      correlationId: `telegram:${this.deps.botKey}:${update.update_id}`,
      locale: "ru-RU",
      deadline: new Date(occurredAt.getTime() + 30_000).toISOString(),
      occurredAt: occurredAt.toISOString(),
      messagingConsentPolicyVersion: this.deps.messagingConsentPolicyVersion,
      ...(route === "deterministic"
        ? {
            localReplyText:
              "Я помогу с навигацией по сервису. Опишите ваш запрос одним сообщением.",
          }
        : {}),
      ...(this.deps.selartiConsentPolicyVersion === undefined
        ? {}
        : {
            selartiConsentPolicyVersion: this.deps.selartiConsentPolicyVersion,
          }),
    });
    if (
      route === "complex_dialogue" &&
      this.deps.costAdmissionEnabled === true
    ) {
      if (result === "claimed") this.deps.budgetMetric?.("admitted");
      else if (
        result === "warning" ||
        result === "soft_stop" ||
        result === "hard_stop"
      )
        this.deps.budgetMetric?.(result);
    }
    return result === "claimed" ||
      result === "warning" ||
      result === "soft_stop" ||
      result === "hard_stop"
      ? { status: "accepted", route }
      : { status: result };
  }
}
