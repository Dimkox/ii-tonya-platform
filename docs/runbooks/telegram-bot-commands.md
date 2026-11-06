# BotFather commands (SCRUM-130 / BOT-01)

`scripts/telegram-bot-commands.ts` is the reviewed command registry for the three Telegram bots. It sets the **all_private_chats** command scope and never changes webhook, feature-flag, payment, channel, or database configuration.

## Review the plan

```sh
pnpm exec tsx scripts/telegram-bot-commands.ts plan
```

Required environment variables: `TELEGRAM_BOT_TOKEN`, `EXPERT_PROMO_TELEGRAM_BOT_TOKEN`, and `EXPERT_TELEGRAM_BOT_TOKEN`. Supply them through the operator's secret manager. Do not put tokens in a file, shell history, command line, PR, log, or BotFather message.

## Apply after operator approval

```sh
pnpm exec tsx scripts/telegram-bot-commands.ts apply --confirm
```

The command calls Telegram `setMyCommands` for each configured bot. It prints only role names and public commands. A missing token or unsuccessful API response is an error. No external configuration was applied by the code PR; the operator must perform this step and verify each bot in a private chat.

## Registered behavior

- Client: `/start`, `/help`, `/catalog`, `/privacy`, `/account`, `/delete_data`.
- Expert promo: `/start`, `/my_tariff`, `/verification`.
- Expert work: `/start`, `/schedule`, `/client`, `/stats`, `/referral`, `/residency`.

Do not publish commands that have no production handler. In particular, `/help`, `/menu`, and `/support` are not advertised for the promo/work bots until their handlers are added. `/delete_data` submits a pending erasure request only when the separately gated capability is enabled; it does not promise immediate deletion.
