import { expect, it, vi } from "vitest";
import { deferredId } from "./expert-early-bird-deferred-id.js";
import { EarlyBirdDeferredReviewPreparation } from "./expert-early-bird-deferred-review.js";

it("materializes only a revalidated approved later choice with a stable account ID", async () => {
  const userId = crypto.randomUUID(),
    baseId = crypto.randomUUID(),
    choiceId = crypto.randomUUID(),
    configId = crypto.randomUUID(),
    event = {
      eventId: crypto.randomUUID(),
      applicationId: crypto.randomUUID(),
    },
    key = Buffer.alloc(32, 3);
  const source = {
      resolve: vi
        .fn()
        .mockResolvedValue({ userId, baseId, choiceId, configId }),
    },
    payments = { prepare: vi.fn() };
  const preparation = new EarlyBirdDeferredReviewPreparation(
    source as never,
    payments as never,
    key,
  );
  await preparation.afterApproval(event);
  expect(payments.prepare).toHaveBeenCalledWith({
    userId,
    baseId,
    choiceId,
    configId,
    accountId: deferredId(key, "account", userId, choiceId),
  });
  source.resolve.mockResolvedValue(null);
  await preparation.afterApproval(event);
  expect(payments.prepare).toHaveBeenCalledOnce();
});
