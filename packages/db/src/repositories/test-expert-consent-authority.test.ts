import { describe, expect, it } from "vitest";
import { hasCurrentTestExpertConsent } from "./test-expert-consent-authority.js";

const executor = (rows: readonly Record<string, unknown>[]) => ({
  execute: async () => ({ rows }),
});

describe("test-expert consent authority", () => {
  it("requires current granted client messaging and residual AI purposes", async () => {
    await expect(
      hasCurrentTestExpertConsent(
        executor([
          {
            purpose: "client_messaging",
            decision: "granted",
            policyVersion: "m1",
          },
          {
            purpose: "selarti_ai_processing",
            decision: "granted",
            policyVersion: "s1",
          },
        ]) as never,
        {
          userId: "00000000-0000-4000-8000-000000000001",
          messagingPolicyVersion: "m1",
          selartiPolicyVersion: "s1",
        },
      ),
    ).resolves.toBe(true);
  });

  it.each([
    ["missing", []],
    [
      "revoked",
      [
        {
          purpose: "client_messaging",
          decision: "revoked",
          policyVersion: "m1",
        },
      ],
    ],
    [
      "wrong version",
      [
        {
          purpose: "client_messaging",
          decision: "granted",
          policyVersion: "old",
        },
      ],
    ],
  ])("fails closed for %s consent", async (_label, rows) => {
    await expect(
      hasCurrentTestExpertConsent(executor(rows) as never, {
        userId: "00000000-0000-4000-8000-000000000001",
        messagingPolicyVersion: "m1",
      }),
    ).resolves.toBe(false);
  });
});
