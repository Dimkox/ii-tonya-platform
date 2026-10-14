import { describe, expect, it } from "vitest";
import { hasCurrentTestExpertConsent } from "./test-expert-consent-authority.js";

// Деривация «текущее решение по цели» живёт в SQL и проверяется на реальной БД в
// tests/integration/consent-current-derivation.test.ts. Здесь проверяется только контракт
// самой функции: какие цели она обязана спросить, в каком порядке, останавливается ли после
// отказа и как трактует ответ БД. Мок отвечает по порядку вызовов, потому что порядок
// запросов зафиксирован реализацией.
const askedPurposes = ["client_messaging", "selarti_ai_processing"] as const;

const fakeExecutor = (answers: readonly unknown[]) => {
  const asked: string[] = [];
  let call = 0;
  const executor = {
    execute: async () => {
      const purpose = askedPurposes[call];
      if (purpose === undefined) {
        throw new Error(
          `запрос №${call + 1}: реализация спрашивает больше двух целей`,
        );
      }
      asked.push(purpose);
      const granted = answers[call] ?? false;
      call += 1;
      return { rows: [{ granted }] };
    },
  };
  return { executor, asked };
};

const userId = "00000000-0000-4000-8000-000000000001";

describe("test-expert consent authority", () => {
  it("requires current granted client messaging and residual AI purposes", async () => {
    const { executor, asked } = fakeExecutor([true, true]);
    await expect(
      hasCurrentTestExpertConsent(executor as never, {
        userId,
        messagingPolicyVersion: "m1",
        selartiPolicyVersion: "s1",
      }),
    ).resolves.toBe(true);
    expect(asked).toEqual(["client_messaging", "selarti_ai_processing"]);
  });

  it("does not ask about the residual AI purpose when its version is not supplied", async () => {
    const { executor, asked } = fakeExecutor([true]);
    await expect(
      hasCurrentTestExpertConsent(executor as never, {
        userId,
        messagingPolicyVersion: "m1",
      }),
    ).resolves.toBe(true);
    expect(asked).toEqual(["client_messaging"]);
  });

  it("denies when the residual AI purpose is not current, whatever messaging says", async () => {
    const { executor } = fakeExecutor([true, false]);
    await expect(
      hasCurrentTestExpertConsent(executor as never, {
        userId,
        messagingPolicyVersion: "m1",
        selartiPolicyVersion: "s1",
      }),
    ).resolves.toBe(false);
  });

  it("stops after messaging is denied and never reaches the AI purpose", async () => {
    const { executor, asked } = fakeExecutor([false]);
    await expect(
      hasCurrentTestExpertConsent(executor as never, {
        userId,
        messagingPolicyVersion: "m1",
        selartiPolicyVersion: "s1",
      }),
    ).resolves.toBe(false);
    expect(asked).toEqual(["client_messaging"]);
  });

  it.each([
    ["no row", []],
    ["a non-boolean answer", ["true"]],
    ["a null answer", [null]],
  ])("fails closed on %s", async (_label, rows) => {
    const answers = rows as readonly unknown[];
    const { executor } = fakeExecutor(answers);
    await expect(
      hasCurrentTestExpertConsent(executor as never, {
        userId,
        messagingPolicyVersion: "m1",
      }),
    ).resolves.toBe(false);
  });
});
