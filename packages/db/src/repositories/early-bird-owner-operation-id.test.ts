import { expect, it } from "vitest";
import { deriveEarlyBirdOwnerOperationIds } from "./early-bird-owner-operation-id.js";
const input = {
  userId: "2526c71d-803f-4c3d-9b57-74e902170001",
  choiceId: "2526c71d-803f-4c3d-9b57-74e902170002",
};
it("derives stable, distinct v4-compatible IDs from a secret and choice", () => {
  const key = Buffer.alloc(32, 7);
  const result = deriveEarlyBirdOwnerOperationIds(key, input);
  expect(result).toEqual(deriveEarlyBirdOwnerOperationIds(key, input));
  expect(new Set(Object.values(result)).size).toBe(3);
  for (const id of Object.values(result))
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  expect(
    deriveEarlyBirdOwnerOperationIds(key, { ...input, choiceId: input.userId }),
  ).not.toEqual(result);
  expect(
    deriveEarlyBirdOwnerOperationIds(Buffer.alloc(32, 8), input),
  ).not.toEqual(result);
  expect(() =>
    deriveEarlyBirdOwnerOperationIds(Buffer.alloc(31), input),
  ).toThrow();
});
it("derives a new stable identity after an earlier attempt is abandoned", () => {
  const key = Buffer.alloc(32, 7);
  const first = deriveEarlyBirdOwnerOperationIds(key, input);
  const next = deriveEarlyBirdOwnerOperationIds(key, {
    ...input,
    generation: 1,
  });
  expect(next).not.toEqual(first);
  expect(next).toEqual(
    deriveEarlyBirdOwnerOperationIds(key, { ...input, generation: 1 }),
  );
});
