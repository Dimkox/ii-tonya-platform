# Готовность live-интеграций

Дата аудита: 2026-07-28

Итог: **NO-GO для live-трафика**

Аудит выполнен в read-only режиме. Значения токенов, API-ключей, webhook URL и иных секретов не читались в отчёт и не сохранялись. Внешнее состояние не изменялось; для Telegram выполнен только безопасный метод `getMe`.

## Сводка

| Интеграция    | Статус                          | Что подтверждено                                                             | Что блокирует live                                                                                                        |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GitHub        | READY для работы с репозиторием | `gh` авторизован как `Dimkox`; приватный `Dimkox/ii-tonya-platform` доступен | Авторизация широкая; для CI/CD нужен отдельный минимально привилегированный контур                                        |
| Telegram      | BLOCKED                         | Найден валидный бот, проверенный только через `getMe`                        | Это `@ExtndBstBot` / `Extended boost`, а не выделенный бот ii-tonya; нет project-owned token/webhook/secret/chat mapping  |
| Selarti       | BLOCKED                         | Публичный официальный REST-контракт и webhook payload подтверждены           | Нет API key, company/task/AI/channel IDs, webhook receiver и runtime mappings                                             |
| Planerka      | BLOCKED                         | Подтверждены получение API-токена в аккаунте и webhook events/payload        | Нет токена/tenant context; точные REST endpoints и auth header доступны только после авторизации и сейчас не подтверждены |
| Make          | BLOCKED                         | В исходном snapshot есть только placeholder webhook URL                      | Нет project-owned webhook/scenario/API credentials, IDs и развёрнутых сценариев                                           |
| Google Sheets | BLOCKED                         | В исходном snapshot есть только placeholder spreadsheet ID                   | Нет spreadsheet ID, deployable auth identity, scopes и ACL                                                                |

## Локальная инвентаризация

### Project-owned конфигурация

В репозитории нет `.env`, `.env.*` или другого рабочего env/config с параметрами Selarti, Planerka, Make, Telegram или Google Sheets. В process/user/machine environment Windows релевантных переменных также не найдено.

Единственное упоминание полного набора — текстовый snapshot, не исполняемая конфигурация:

`C:\Users\Dmitry\Documents\Codex\2026-07-28\new-chat\work\ii-tonya-platform\docs\source\ii-tonya-expert-full-source-2026-07-28.txt`

Имена placeholder-переменных:

- `GOOGLE_SHEETS_ID`
- `MAKE_WEBHOOK_URL`
- `PLANERKA_API_KEY`
- `PLANERKA_BASE_URL`
- `SELARTI_API_KEY`
- `SELARTI_WEBHOOK_URL`
- `TELEGRAM_ADMIN_CHAT_ID`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_EXPERT_CHAT_ID`

### Найденные Telegram credential locations

Вне проекта найдены два env-файла с именем переменной `TELEGRAM_BOT_TOKEN`:

- `C:\Users\Dmitry\Documents\Codex\2026-07-08\new-chat\secrets\domestos.env`
- `C:\Users\Dmitry\Documents\Codex\2026-07-20\new-chat\work\multi-exchange-engine\.env`

Оба location через `getMe` разрешаются в один и тот же бот:

- метод проверки: [Telegram Bot API — getMe](https://core.telegram.org/bots/api#getme);
- bot id: `8882213343`
- username: `@ExtndBstBot`
- display name: `Extended boost`
- `is_bot=true`
- `can_join_groups=true`
- `can_read_all_group_messages=false`
- `supports_inline_queries=false`
- `can_connect_to_business=false`
- `has_main_web_app=false`

Credential value не выводился. По имени и существующему назначению этот бот не считается выделенным ботом ii-tonya. Переиспользование без явного решения владельца создаст общий blast radius между продуктами.

## GitHub

Проверено:

- активная `gh`-сессия на `github.com`: пользователь `Dimkox`;
- Git protocol: HTTPS;
- приватный репозиторий `Dimkox/ii-tonya-platform` доступен;
- default branch: `main`.

Ни commit, ни push, ни изменение репозитория через GitHub API не выполнялись. Для production CI/CD следует использовать отдельный fine-grained credential/GitHub App с минимальными правами вместо пользовательской сессии широкого доступа.

## Selarti: подтверждённый минимальный контракт

Официальные источники: [Selarti Public API](https://docs.selarti.com/), [интеграция с внешним мессенджером](https://manual.selarti.com/vneshnie-integracii/integraciya-s-vneshnim-messendzherom), [типы webhook](https://manual.selarti.com/dopolnitelno/tipy-vebkhukov-i-integracii-s-servisami).

### Авторизация

1. `POST https://selarti.com/api/1.1/wf/auth`
2. JSON body: `{"key":"{api_key}"}`
3. Полученный token передаётся в дальнейшие `/api/1.1/wf/*` запросы как `Authorization: Bearer {token}`.

### Tenant и служебные данные

- `GET /api/1.1/wf/get_company?company_id={company_id}`
- `GET /api/1.1/wf/get_task?company_id={company_id}&task_id={task_id}`
- `GET /api/1.1/wf/get_ai?company_id={company_id}&ai_id={ai_id}`
- `GET /api/1.1/wf/get_thread?external_id={external_id}&limit=20&offset=0`
- `GET /api/1.1/wf/get_message?thread_id={thread_id}&message_id={message_id}&limit=20&offset=0&start_date={date}`

### Отправка сообщений

- `POST /api/1.1/wf/send_message`
  - body: `thread`, `message`, `message_type`;
  - `message_type`: `bot` или `operator`.
- `POST /api/1.1/wf/send_message_external`
  - required body: `task_id`, `chat_id`, `message`;
  - optional: `message_type`.

Для создания target официальный API также описывает:

- `POST https://api.selarti.com/v1/add_target?task_id={task_id}`
  - required: `target`;
  - optional: first/last name, context, `external_id`, start message.

### Webhook

Для двустороннего мессенджера нужен тип интеграции «Все сообщения» (`wh_type=all_messages`). Официально подтверждённые поля payload включают:

- `channel_id`
- `company_id`
- `external_chat_id`
- `message_id`
- `message_text`
- `message_type`
- `task_id`
- `thread_id`
- `wh_type`

Обычный integration webhook не поддерживает произвольные дополнительные поля. Способ аутентификации/подписи входящего webhook в изученной публичной документации не подтверждён и должен быть отдельно согласован с Selarti.

### Не хватает

- `SELARTI_API_KEY`
- `SELARTI_COMPANY_ID`
- `SELARTI_TASK_ID`
- `SELARTI_AI_ID`, если платформа будет управлять AI-настройками
- выбранный `channel_id`/integration ID
- реальный HTTPS webhook receiver URL
- mapping `external_chat_id` / `chat_id` / `thread_id` / `message_id`
- подтверждённый механизм проверки подлинности входящего webhook

## Planerka: подтверждённый минимальный контракт

Официальные источники: [API Planerka](https://help.planerka.app/api), [webhook-интеграции](https://help.planerka.app/kak-intieghrirovat-planiorku-s-bitriksom-amo-crm-i-drughimi-sistiemami), [минимальное время до бронирования](https://help.planerka.app/vremya-do-bronirovaniya).

### REST API

Публично подтверждено только следующее:

1. API token создаётся/копируется в настройках аккаунта Planerka.
2. Официальная инструкция направляет пользователя на `https://planerka.app/rest/doc`.
3. В REST-документации нужно авторизоваться API token и выполнять тестовые запросы.

При unauthenticated read-only проверке 2026-07-28 `https://planerka.app/rest/doc` вернул HTTP 404. Поэтому точные REST paths, request schemas и имя auth header сейчас не подтверждены. Указанные в исходном snapshot `https://api.planerka.ru/v1`, `GET /events` и `PUT /events/{event_id}/status` нельзя считать контрактом до сверки с authenticated REST docs.

### Webhook

Webhook настраивается в интерфейсе `https://planerka.app/meet/apps`. Официальная инструкция подтверждает события создания, отмены, переноса и напоминаний; пример события — `BOOKING_CREATED`.

Подтверждённые поля примерного payload:

- `event`
- `uid`
- `title`
- `description`
- `startTime`
- `endTime`
- `customInputs`
- `organizer` (`name`, `email`, `timeZone`)
- `attendees`
- `location` (`name`, `id`, `password`, `url`)
- `eventType`

Минимальное время до записи, включая окно 24 часа, поддерживается настройкой типа встречи внутри Planerka.

### Не хватает

- `PLANERKA_API_TOKEN`/актуальный API credential
- authenticated account/tenant/organizer context
- ID типов встреч и другие account IDs, которые покажет authenticated REST docs
- точный REST base URL, paths, schemas и auth header
- реальный webhook receiver URL и выбранные event subscriptions
- подтверждённый механизм подписи/проверки webhook
- mapping `uid` / meeting type / organizer / expert к внутренним ID

## Make

В project-owned config найден только placeholder `MAKE_WEBHOOK_URL`; live URL, scenario IDs и API credential отсутствуют.

Для готовности нужны:

- project-owned `MAKE_WEBHOOK_URL`;
- `MAKE_API_TOKEN` для автоматизированного контроля, если он требуется;
- organization/team ID и zone/base URL;
- scenario IDs и экспортируемые рабочие blueprints;
- настроенные connections к Selarti, Planerka, Telegram и Google;
- retry/idempotency/error route и наблюдаемость.

Псевдо-JSON из source snapshot нельзя считать импортируемым Make blueprint или доказательством работающего сценария.

## Google Sheets

В project-owned config найден только placeholder `GOOGLE_SHEETS_ID`. Нет deployable Google credential или project binding.

Для готовности нужны:

- spreadsheet ID;
- выбранная модель auth: service account либо OAuth;
- Google Cloud project/client/service-account identity;
- минимальные scopes;
- ACL/share доступа к spreadsheet;
- однозначная схема листов и idempotent key для строк.

Подключённый пользовательский Google Drive connector, если он используется в Codex, не является backend credential приложения. Google Sheets следует оставить проекцией/экспортом, а не источником истины транзакционного workflow.

## Go-live gates

Live остаётся закрыт, пока не выполнены все пункты:

1. Выделены отдельные non-shared credentials и tenant IDs для ii-tonya.
2. Получен authenticated Planerka REST contract; paths/auth/schema зафиксированы contract tests.
3. Зарегистрированы inbound webhook receivers с проверкой подлинности, replay protection и idempotency.
4. Создан отдельный Telegram bot и настроены numeric admin/safety chat IDs.
5. Созданы реальные Make scenarios либо подтверждено, что оркестрация полностью остаётся в backend.
6. Настроен Google Sheets projection credential и ACL без превращения Sheets в источник истины.
7. Выполнен staging smoke test полного цикла без реальных клиентов и платежей.

До прохождения gates допустимы только локальная разработка, mocked/contract tests и staging/shadow-проверки без live-трафика.

## Telegram code boundary

Локальный адаптер и callback-контракт реализованы без сетевой активации:

- `TELEGRAM_ENABLED=false` остаётся обязательным;
- bot token, webhook secret и `TELEGRAM_CALLBACK_HMAC_KEY` представлены только placeholder-значениями;
- callback wire protocol — только `ct2`/version 2; все `ct1` и pre-hardening callback rows инвалидируются при migration `0006`;
- callback data содержит только версию, случайный nonce и HMAC, не содержит reservation/expert IDs, PII, заметок, meeting URL или provider credentials;
- staging/production callback secret должен состоять минимум из 32 криптографически случайных байт; HMAC domain-separated и связывает точный `ct2.` prefix, wire-version и nonce;
- внешние ошибки callback verification не раскрывают, существует ли token, binding, reservation или expert;
- retryable PostgreSQL/store outages пробрасываются типизированно и не маскируются под auth rejection;
- consume сверяет reservation ownership, текущие status/version и active+verified expert через авторитетные PostgreSQL joins, а не доверяет дублированному `callback_expert_id`;
- confirm дополнительно требует живой hold, будущий и свежий slot, active service; его callback expiry ограничен `reserved_until`; booked cancel не наследует confirm-only hold predicate;
- отправка выполняется только через инъецируемый transport с отключённым request logging;
- token-bearing URL перед логированием заменяется на `/bot[REDACTED]/sendMessage`, а неожиданные path/query/encoded URL shapes полностью скрываются;
- Telegram HTTP 5xx после записи запроса считается `unknown_outcome`, пока provider не даёт проверяемой idempotency;
- `/schedule` получает уже авторизованное представление через порт и не читает PostgreSQL из адаптера.

Live bot/client/session и HTTPS transport в текущем composition root не создаются.
