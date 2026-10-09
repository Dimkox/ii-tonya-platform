import { expect, it } from "vitest";
import { runErasureRequests } from "./erasure-requests.js";
it("does no execution without explicit prerequisites and isolates failed requests", async () => {
  let calls = 0;
  const repository = {
    pendingRequests: async () => [
      { id: "one", userId: "owner" },
      { id: "two", userId: "other" },
    ],
  };
  expect(await runErasureRequests({ repository })).toEqual({
    started: 0,
    awaitingExecution: 0,
    reason: "execution_prerequisites_unbound",
  });
  const result = await runErasureRequests({
    repository,
    execution: {
      begin: async (request) => {
        calls++;
        if (request.id === "one") throw new Error("private provider failure");
      },
    },
  });
  expect(calls).toBe(2);
  expect(result).toEqual({ started: 1, awaitingExecution: 1 });
});
