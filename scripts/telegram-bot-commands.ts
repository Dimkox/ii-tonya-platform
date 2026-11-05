/**
 * SCRUM-130: reproducible BotFather command registration.
 *
 *   tsx scripts/telegram-bot-commands.ts plan
 *   tsx scripts/telegram-bot-commands.ts apply --confirm
 *
 * Tokens are read only from the environment and are never printed. Applying is
 * an operator action; this repository does not enable bots or change webhooks.
 */
import { pathToFileURL } from "node:url";

type TelegramRequest = (
  token: string,
  payload: {
    commands: readonly { command: string; description: string }[];
    scope: { type: "all_private_chats" };
  },
) => Promise<{ ok: boolean }>;

export const BOTFATHER_COMMAND_SCOPES = [
  {
    role: "client",
    tokenEnv: "TELEGRAM_BOT_TOKEN",
    commands: [
      ["start", "Начать навигацию"],
      ["help", "Показать доступные разделы"],
      ["catalog", "Открыть каталог услуг"],
      ["privacy", "Политика конфиденциальности"],
      ["account", "Открыть личный кабинет"],
      ["delete_data", "Запросить удаление своих данных"],
    ],
  },
  {
    role: "expert_promo",
    tokenEnv: "EXPERT_PROMO_TELEGRAM_BOT_TOKEN",
    commands: [
      ["start", "Начать или продолжить сценарий"],
      ["my_tariff", "Показать актуальный тариф"],
      ["verification", "Перейти к анкете резидента"],
    ],
  },
  {
    role: "expert_work",
    tokenEnv: "EXPERT_TELEGRAM_BOT_TOKEN",
    commands: [
      ["start", "Открыть главное меню"],
      ["schedule", "Показать расписание"],
      ["client", "Найти клиента: /client имя"],
      ["stats", "Показать статистику"],
      ["referral", "Показать реферальную сводку"],
      ["residency", "Показать тарифы резидентства"],
    ],
  },
] as const;

const defaultTelegramRequest: TelegramRequest = async (token, payload) => {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/setMyCommands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) return { ok: false };
  return (await response.json()) as { ok: boolean };
};

export async function runTelegramBotCommandsCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
  request: TelegramRequest = defaultTelegramRequest,
): Promise<number> {
  const [command, flag] = argv;
  if (command !== "plan" && command !== "apply") {
    out("usage: plan | apply --confirm");
    return 2;
  }
  if (command === "apply" && flag !== "--confirm") {
    out("apply requires --confirm (run plan first)");
    return 2;
  }
  for (const scope of BOTFATHER_COMMAND_SCOPES) {
    const token = env[scope.tokenEnv];
    if (!token) throw new Error(`telegram_bot_token_required:${scope.role}`);
    const commands = scope.commands.map(([commandName, description]) => ({
      command: commandName,
      description,
    }));
    out(
      `${command === "plan" ? "plan" : "apply"} ${scope.role}: ${commands.map(({ command }) => `/${command}`).join(" ")} (all_private_chats)`,
    );
    if (command === "apply") {
      const result = await request(token, {
        commands,
        scope: { type: "all_private_chats" },
      });
      if (!result.ok)
        throw new Error(`telegram_set_my_commands_failed:${scope.role}`);
    }
  }
  return 0;
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  runTelegramBotCommandsCli(process.argv.slice(2), process.env, (line) =>
    console.log(line),
  ).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message.split("\n")[0] : "failed",
      );
      process.exitCode = 1;
    },
  );
}
