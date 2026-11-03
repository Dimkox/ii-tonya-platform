import { describe, expect, it } from "vitest";
import { ConversationServiceError } from "@ii-tonya/application";
import { conversationFixture } from "../../../packages/application/src/conversation-service.testkit.js";
import {
  createClientConversationService,
  createMessageBackedSafetyHandoff,
} from "./client-conversation-composition.js";

const OWNER = "11111111-1111-4111-8111-111111111111";

const build = (owner: string | null = OWNER) => {
  const deps = conversationFixture({ balance: 1, safety: "ordinary" });
  const service = createClientConversationService({
    messages: deps.messageRepository,
    authorization: deps.intentAuthorization,
    resolveHandoffOwner: async () => owner,
    clock: deps.clock,
  });
  return { deps, service };
};

describe("client conversation composition", () => {
  it("answers /start with the fixed menu", async () => {
    const { deps, service } = build();
    await expect(
      service.handleInbound({ ...deps.inbound, text: "/start" }),
    ).resolves.toMatchObject({ kind: "answer_queued" });
    expect(deps.outbox.topics()).toContain("selarti.send");
  });

  it("hands crisis text to the support owner without charging", async () => {
    const { deps, service } = build();
    const result = await service.handleInbound({
      ...deps.inbound,
      text: "я не хочу жить",
    });
    expect(result).toMatchObject({ kind: "human_handoff", chargedMessages: 0 });
    expect(deps.messageRepository.ledgerDeltas()).toEqual([]);
  });

  it("fails closed when no support operator exists", async () => {
    const { deps, service } = build(null);
    await expect(service.handleInbound(deps.inbound)).rejects.toBeInstanceOf(
      ConversationServiceError,
    );
  });

  it("dedupes a replayed safety event through the inbound inbox", async () => {
    const { deps } = build();
    const handoff = createMessageBackedSafetyHandoff(deps.messageRepository);
    const input = {
      provider: "selarti" as const,
      providerEventId: "ev-safety",
      providerMessageId: "msg-safety",
      userId: deps.inbound.userId,
      occurredAt: deps.inbound.occurredAt,
      correlationId: "c-safety",
      reasonCode: "self_harm",
      ownerId: OWNER,
      acknowledgeBy: "2026-07-28T14:00:00.000Z",
    } as unknown as Parameters<typeof handoff.accept>[0];
    const first = await handoff.accept(input);
    const second = await handoff.accept(input);
    expect(first.kind).toBe("accepted");
    expect(second).toEqual({
      kind: "duplicate",
      messageEventId: first.messageEventId,
    });
  });
});
