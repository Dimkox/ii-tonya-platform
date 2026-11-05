import { describe, expect, it, vi } from "vitest";
import {
  BOTFATHER_COMMAND_SCOPES,
  runTelegramBotCommandsCli,
} from "../../scripts/telegram-bot-commands.js";

const request = vi.fn(async (...args: [string, unknown]) => {
  void args;
  return { ok: true, result: true };
});
const env = {
  TELEGRAM_BOT_TOKEN: "synthetic_" + "client-token",
  EXPERT_PROMO_TELEGRAM_BOT_TOKEN: "synthetic_" + "promo-token",
  EXPERT_TELEGRAM_BOT_TOKEN: "synthetic_" + "expert-token",
};

describe("BotFather command configuration (SCRUM-130)", () => {
  it("publishes only each bot's implemented private-chat commands", async () => {
    request.mockClear();
    await expect(
      runTelegramBotCommandsCli(["plan"], env, () => undefined, request),
    ).resolves.toBe(0);
    expect(request).toHaveBeenCalledTimes(0);

    await expect(
      runTelegramBotCommandsCli(
        ["apply", "--confirm"],
        env,
        () => undefined,
        request,
      ),
    ).resolves.toBe(0);
    expect(request).toHaveBeenCalledTimes(BOTFATHER_COMMAND_SCOPES.length);
    const payloads = request.mock.calls.map(([, body]) => body) as Array<{
      commands: Array<{ command: string }>;
      scope: { type: string };
    }>;
    expect(
      payloads.map((entry) => entry.commands.map((c) => c.command)),
    ).toEqual([
      ["start", "help", "catalog", "privacy", "account", "delete_data"],
      ["start", "my_tariff", "verification"],
      ["start", "schedule", "client", "stats", "referral", "residency"],
    ]);
    expect(
      payloads.every((entry) => entry.scope.type === "all_private_chats"),
    ).toBe(true);
  });

  it("requires confirmation and never embeds a token in request content", async () => {
    request.mockClear();
    const lines: string[] = [];
    await expect(
      runTelegramBotCommandsCli(
        ["apply"],
        env,
        (line) => lines.push(line),
        request,
      ),
    ).resolves.toBe(2);
    expect(request).not.toHaveBeenCalled();
    expect(lines.join("\n")).not.toContain("synthetic-");
  });

  it("fails closed on missing tokens and unsuccessful Telegram replies", async () => {
    await expect(
      runTelegramBotCommandsCli(["plan"], {}, () => undefined, request),
    ).rejects.toThrow("telegram_bot_token_required:client");
    await expect(
      runTelegramBotCommandsCli(
        ["apply", "--confirm"],
        env,
        () => undefined,
        vi.fn(async () => ({ ok: false })),
      ),
    ).rejects.toThrow("telegram_set_my_commands_failed:client");
  });
});
