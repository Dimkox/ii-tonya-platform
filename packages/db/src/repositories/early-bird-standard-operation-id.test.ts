import { expect, it } from "vitest";
import { deriveEarlyBirdStandardOperationIds } from "./early-bird-standard-operation-id.js";
import { deriveEarlyBirdOwnerOperationIds } from "./early-bird-owner-operation-id.js";
it("derives stable distinct standard identifiers separate from owner namespace", () => {
  const key = Buffer.alloc(32, 1),
    identity = {
      userId: "2526c71d-803f-4c3d-9b57-74e902170001",
      choiceId: "2526c71d-803f-4c3d-9b57-74e902170002",
    };
  const ids = deriveEarlyBirdStandardOperationIds(key, identity);
  expect(ids).toEqual(deriveEarlyBirdStandardOperationIds(key, identity));
  expect(ids).not.toEqual(deriveEarlyBirdOwnerOperationIds(key, identity));
  expect(
    deriveEarlyBirdStandardOperationIds(key, { ...identity, generation: 1 }),
  ).not.toEqual(ids);
});
