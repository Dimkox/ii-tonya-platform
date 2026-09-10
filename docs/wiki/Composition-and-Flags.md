# Состав, флаги и точка сборки

Проверено по `origin/main` (`f0d67cc`), а не по старым веткам: состав точки сборки между ними различается.

## Что исполняется, а что нет

`apps/api/src/server.ts` строит боевой lifecycle (`createDefaultLifecycle`) и подставляет
`disabledService()` — Proxy, где любой вызов бросает `Error("<name> is disabled")` — для четырёх
сервисов: `conversationService` ("conversation ingress"), `bookingService` ("booking ingress"),
`catalogService` ("catalog ingress"), `privacyService` ("privacy ingress"). Плюс захардкоженные
заглушки `selarti: new DisabledSelartiAdapter()` и `telegramCallbacks` с
`isAuthorizedIdentity → false`, `verifyCallback → false`, `process → throw`.

Одновременно с этим боевой lifecycle **реально собирает** клиентский MVP-контур
(`clientSessionService`, `clientCatalogService`, `clientBookingService` через
`createClient*Service` + Postgres-репозитории), `adminService`, `operatorCases`,
`expertReferralAdminService`, `adminApprovals` и `expertCodeKeyring` — всё под флагами и с
`assertClientCapabilityPreflight`, который роняет старт, если флаг включён без capability.

`apps/api/src/app.ts::assertDisabled` роняет старт, если любой интеграционный флаг отличен от `false`,
**кроме платежей** (`payments` принудительно `false` в проверке) — то есть платёжный контур выведен из-под
этого запрета и регулируется `PAYMENTS_ENABLED`/`YOOKASSA_ENABLED` и внешними гейтами.

Следствие: продукт «диалог в Telegram» не исполняется, потому что не собраны `conversation ingress` и
Telegram-колбэки, а не потому что нет доменных сервисов. Детали — [https://github.com/Dimkox/ii-tonya-platform/issues/45](https://github.com/Dimkox/ii-tonya-platform/issues/45).

## Разрыв «тесты vs боевая сборка»

`tests/e2e/client-session-catalog.test.ts` собирает HTTP-приложение через `buildTestApp` из
`apps/api/src/app.js` с **инъекцией** реальных capabilities. Боевой `createDefaultLifecycle` из
`server.ts` не покрывается ни одним e2e-сюжетом, а `tests/e2e/mvp-smoke.test.ts` (AC-025) вызывает
сервисы напрямую против Postgres. Отсюда сосуществование зелёной лестницы `pnpm verify` и четырёх
заглушек в проде — [https://github.com/Dimkox/ii-tonya-platform/issues/46](https://github.com/Dimkox/ii-tonya-platform/issues/46).

## Рабочие пространства

| Workspace                | Назначение                            | Заметка                                         |
| ------------------------ | ------------------------------------- | ----------------------------------------------- |
| `apps/api`               | Fastify-граница HTTP                  | живут только `/health/*` и `/v1/admin/*`        |
| `apps/worker`            | цикл задач (10 джоб)                  | 3 из 10 джоб — захардкоженные no-op             |
| `apps/web`               | лендинг, SEO, юридические страницы    | есть на main; нет в старых ветках               |
| `apps/sandbox-api`       | изолированный sandbox-контур платежей | сборка отдельно от прода                        |
| `packages/domain`        | чистые правила                        | 572 строки, 842 строки тестов, 2 property-сюита |
| `packages/db`            | Drizzle-схема, репозитории, миграции  | 54 таблицы, 25 миграций, ~10.7k строк SQL       |
| `packages/application`   | use-case и порты                      | самый большой слой после db                     |
| `packages/integrations`  | адаптеры провайдеров                  | адаптеры реальные, но не конструируются в проде |
| `packages/config`        | zod-схема окружения                   | fail-closed: часть флагов заперта literal       |
| `packages/worker`        | библиотеки задач                      | 7 функций без production-вызовов                |
| `packages/observability` | pino + OTel метрики                   | счётчики есть, экспортёра нет                   |
| `packages/contracts`     | ID, конверты, события                 | тонкий слой                                     |

## Тестовые ярусы

| Ярус             | Команда                 | Требует Docker/Postgres         |
| ---------------- | ----------------------- | ------------------------------- |
| unit (colocated) | `pnpm test:unit`        | 5 файлов из ~53                 |
| property         | `pnpm test:property`    | нет                             |
| integration      | `pnpm test:integration` | да, все файлы                   |
| contract         | `pnpm test:contract`    | нет (инжектируемые транспорты)  |
| security         | `pnpm test:security`    | нет                             |
| e2e              | `pnpm test:e2e`         | 2 из 3                          |
| repo/static      | часть `pnpm verify`     | нет                             |
| container        | `pnpm test:container`   | Docker + compose + built images |

`pnpm verify` требует и Docker, и сеть (`--frozen-lockfile`, `pnpm audit --prod`).

## Флаги окружения (из `packages/config/src/env.ts` на main)

Всего распознано 35 переменных окружения. Схема оканчивается `.passthrough()`, но наружу
из `process.env` попадают только отобранные ключи. Из них **10 заперты `z.literal`** (SELARTI_ENABLED,
SELARTI_OUTBOUND_BILLING_MODE, PLANERKA_ENABLED, TELEGRAM_ENABLED, LLM_ENABLED, MAKE_PROJECTION_ENABLED,
GOOGLE_SHEETS_PROJECTION_ENABLED, INTENT_MODEL_ENABLED, LLM_PROVIDER, MINOR_ONBOARDING_ENABLED), а
`RAW_CONVERSATION_LOGGING="true"` бросает `Raw conversation logging is prohibited` уже в `loadEnv`, и в
конфиг жёстко пишется `rawConversationLogging: false`. Остальные — `z.enum(["true","false"])` со
значением `false` по умолчанию: их можно включить значением, но дальше работают `assertDisabled`
(кроме платежей), `assertClientCapabilityPreflight` и внешние go-live гейты.

Проверка запертых literal есть в тестах: `tests/e2e/api-boundary.test.ts` утверждает, что установка
такого флага в `"true"` бросает исключение.

| Флаг                               | Схема                              | По умолчанию      | Включение                  |
| ---------------------------------- | ---------------------------------- | ----------------- | -------------------------- |
| `DATABASE_URL`                     | `z.string()`                       | `— (обязательно)` | включается явным значением |
| `ALLOW_INSECURE_LOCAL_DATABASE`    | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `SELARTI_ENABLED`                  | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `SELARTI_OUTBOUND_BILLING_MODE`    | `z.literal(`disabled`)`            | `"disabled"`      | нельзя включить схемой     |
| `PLANERKA_ENABLED`                 | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `TELEGRAM_ENABLED`                 | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `LLM_ENABLED`                      | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `MAKE_PROJECTION_ENABLED`          | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `GOOGLE_SHEETS_PROJECTION_ENABLED` | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `INTENT_MODEL_ENABLED`             | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `PAYMENTS_ENABLED`                 | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `EXPERT_REFERRAL_ENABLED`          | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `EXPERT_TELEGRAM_QUERIES_ENABLED`  | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `EXPERT_AI_INGRESS_ENABLED`        | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `WORKER_OUTBOX_DELIVERY_ENABLED`   | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `CLIENT_SESSION_ENABLED`           | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `CLIENT_CATALOG_ENABLED`           | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `CLIENT_BOOKING_ENABLED`           | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `CLIENT_BOOKING_RESERVE_ENABLED`   | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `CLIENT_FREE_ACCESS_V2_ENABLED`    | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `CLIENT_TELEGRAM_INGRESS_ENABLED`  | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `CLIENT_HYBRID_ROUTING_ENABLED`    | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `SELARTI_COST_ADMISSION_ENABLED`   | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `B2_TELEGRAM_DISPATCH_ENABLED`     | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `B2_SENSITIVE_RETENTION_ENABLED`   | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `TEST_EXPERT_PROMO_ENABLED`        | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `TEST_EXPERT_SELARTI_ENABLED`      | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `EXPERT_REFERRAL_HMAC_KEY_VERSION` | `z.string()`                       | `— (обязательно)` | включается явным значением |
| `EXPERT_REFERRAL_HMAC_KEY_REF`     | `z.string()`                       | `— (обязательно)` | включается явным значением |
| `PAYMENT_PROVIDER`                 | `z.enum([`disabled`, `yookassa`])` | `"disabled"`      | включается явным значением |
| `YOOKASSA_ENABLED`                 | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `LLM_PROVIDER`                     | `z.literal(`disabled`)`            | `"disabled"`      | нельзя включить схемой     |
| `MINOR_ONBOARDING_ENABLED`         | `z.literal(`false`)`               | `"false"`         | нельзя включить схемой     |
| `RAW_CONVERSATION_LOGGING`         | `z.enum([`true`/`false`])`         | `"false"`         | включается явным значением |
| `DISPLAY_TIMEZONE`                 | `z.string()`                       | `"Europe/Moscow"` | включается явным значением |

`z.literal("false")` означает, что значение `true` не проходит валидацию — включение провайдера требует
изменения схемы, а `tests/e2e/api-boundary.test.ts` проверяет наличие literal по тексту исходника.

← [Home](Home.md) · [Гейты](Release-Gates.md)
