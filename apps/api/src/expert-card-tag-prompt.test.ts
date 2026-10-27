import { expect, it, vi } from "vitest";
import { createExpertCardTagPrompt } from "./expert-card-tag-prompt.js";
const token = "818181:synthetic_fixture_only";
const input = () => ({ chatId: "42", signal: new AbortController().signal });
const message = {
  message_id: 9,
  from: { id: 818181, is_bot: true },
  chat: { id: 42, type: "private" },
};
it("binds only a successful original bot message in the requested private chat", async () => {
  for (const result of [
    message,
    { ...message, from: { id: 99, is_bot: true } },
    { ...message, chat: { id: 99, type: "private" } },
    { ...message, chat: { id: 42, type: "group" } },
    { ...message, message_id: 0 },
  ]) {
    const send = createExpertCardTagPrompt(
      token,
      "818181",
      async () => new Response(JSON.stringify({ ok: true, result })),
    );
    expect(await send(input())).toBe(result === message ? "9" : null);
  }
});
it("caps body bytes and sanitizes unknown transport failures without retry", async () => {
  let calls = 0;
  const send = createExpertCardTagPrompt(token, "818181", async () => {
    calls++;
    throw new Error("transport bearer " + token);
  });
  expect(await send(input())).toBeNull();
  expect(calls).toBe(1);
  expect(
    await createExpertCardTagPrompt(
      token,
      "818181",
      async () => new Response("x".repeat(16385)),
    )(input()),
  ).toBeNull();
});
it("returns unknown within two seconds even when transport ignores abort", async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const pending = createExpertCardTagPrompt(token, "818181", async () => {
      calls++;
      return new Promise<Response>(() => {});
    })(input());
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBeNull();
    expect(calls).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
