# W1. Карта «пункт ТЗ ↔ текущий код» (BASE-01)

**ТЗ:** «ии-Тоня: согласия и защита персональных данных», версия 1.0 от 21.09.2026 —
`docs/spec/consent-pd-tz-2026-09-21.md`, sha256 `22d566fcadde3f402e8b69b55e1ae32dfea049e4c190f96fcf386d34b7c39fd5`.
**Ревизия кода, к которой снята карта:** ветка `codex/fin-001-client-access-policy`, PR #98
(база `main` = `cb07bd18`). **Дата:** 2026-09-21. **Метод:** шесть независимых read-only
обследований + повторная проверка нагружающих фактов командой из этого прогона.

Правило пометок (Приложение А к ТЗ): **В** = проверено командой этого прогона (файл:строка
открыты лично); **А** = сообщено обследованием, вторично не перепроверено; **Н** = не проверяемо
из дерева репозитория (нужен сервер, договор или оценка оператора). «Подтверждение не получено» —
не то же самое, что «не соответствует».

## 1. Что уже соответствует ТЗ

| Пункт ТЗ | Факт в коде | Пометка |
| --- | --- | --- |
| EGRESS-06 «клик не включает провайдера» | `SELARTI_ENABLED`/`PLANERKA_ENABLED`/`TELEGRAM_ENABLED`/`LLM_ENABLED`/`MAKE_*`/`GOOGLE_SHEETS_*` = `z.literal("false")` (`packages/config/src/env.ts:50-57`); вместо адаптеров — `DisabledSelartiAdapter` и заглушки (`apps/api/src/server.ts:348-357`); локальный fallback возвращает явную причину, а не имитацию ответа | В |
| T04 `/start`, сообщение, оплата, молчание ≠ согласие | ни одного `insert into consents … 'granted'` в коде нет вообще; единственный писатель таблицы пишет только `denied` (`packages/db/src/repositories/privacy-repository.ts:169-171, 220-223`) | В |
| T14 связка сайт↔бот по `username`/имени | ключ сопоставления — только числовой `external_id` в `channel_identities`; `username` в проверках не участвует | А |
| BOT-03 `callback_data` 1..64 байта и непрозрачность | `ct2.`/`cv1.` = 48 B, `xr1.` = 44 B, все HMAC-токены; claims (резервация, эксперт, actor, версия, срок) лежат серверно; лимит проверяется и при выпуске, и при приёме (`apps/api/src/routes/telegram-webhook.ts:368-374`) | А |
| T09/T10 «чужой» и просроченный токен | несовпадение `claims.telegramUserId` с `from.id` → отказ; `expiresAt` → отказ; атомарный consume (`callback-token.ts:186-197`, `expert_telegram_residency_callbacks.consumed_at`) | А |
| BOT-05 без ложного успеха | `answerCallbackQuery("processed")` только после успешной мутации, иначе `unavailable` + `inbox.fail` + 503 | А |
| EGRESS-02 allowlist полей | `exactRecord`-равенство ключей на telegram/local-operator/catalog темах; per-topic allowlist в Make-sink; `zod .strict()` на входящих Selarti/YooKassa | А |
| T06 дубликаты webhook | `webhook_inbox` с UNIQUE(provider, external_event_id) + lease; на клиентском пути — уникальный `(provider, bot_key, provider_update_id)` + tombstone | А |
| DATA-02 «сначала российский backend» для web | в `apps/web` ноль сетевых вызовов (`fetch`/`sendBeacon` — 0 совпадений), форма-заглушка `aria-disabled`; личных данных с клиента не уходит | В (моя правка TRACK-01) |
| CONS-02 независимость целей | 6 целей в коде соответствуют таблице ТЗ (`client_profile`, `expert_note`, `expert_handoff`, `follow_up`, `client_messaging`, `selarti_ai_processing`); объединяющего «одним событием» пути нет | В |
| RET-01 recovery-потолок 7 суток | `expert_ai_request_receipts.expires_at default now() + interval '7 days'` с удалением `for update skip locked` | А |
| `consents` append-only (защита истории) | триггер `consents_append_only` → `reject_append_only_change()`, errcode 55000 (`packages/db/migrations/0000_mvp.sql:246-256`) | В |
| T43 «откат не возвращает прежний обход» | частично: default-off флаги и preflight-проверка совместимости (`apps/api/src/client-capability-preflight.ts:15-46`) не позволяют включить маршрут без runtime-возможности | А |

## 2. Чистые кодовые дефекты (реализуемы сейчас, без внешних бумажек)

| # | Пункт ТЗ / приёмка | Дефект | Пометка |
| --- | --- | --- | --- |
| D1 | BOT-02, RET-01, SENS-03 | Исполнитель очистки чувствительного текста **нигде не вызывается**: `runB2SensitiveRetention` определён (`packages/worker/src/b2-sensitive-retention.ts:6`) и протестирован, но в `apps/` нет ни одного вызова — воркер регистрирует только catalog- и session-retention (`apps/worker/src/main.ts:339, 351`). То есть 30-дневный TTL сырого текста (`hybrid-message-repository.ts:105`) не исполняется даже как «удаляется по истечении» | В |
| D2 | EVID-03, T07, MIG-02 | «Текущее состояние согласия» вычисляется **двумя несовместимыми способами**: `distinct on (consent_type) … order by created_at desc, id desc` (`test-expert-consent-authority.ts:19-24`) против `created_at = (select max(...))` + `bool_and(decision='granted')` (`booking-repository.ts:625-636`, `expert-telegram-query-repository.ts:349-370`). На двух строках с одинаковым `created_at` первая даёт один ряд, вторая — `false`: одно и то же данные означают разное — **закрыто 2026-09-21**: единая формула `packages/db/src/repositories/consent-current.ts`, три читателя переведены на неё, `distinct on … id desc` с uuid-тай-брейкером удалён, ничья в одном мгновении = fail-closed (`tests/integration/consent-current-derivation.test.ts`) Писатель отзыва (`privacy-repository`) переведён на тот же оракул: `revoked` ставится только если решение действительно действовало, иначе возвращается `denied`. Трипвайр против второй деривации — `tests/repo/consent-current-derivation-boundary.test.ts`. | В (закрыто) |
| D3 | T11, MIG-01, EVID-03 | `consents` не имеет ни CHECK на `decision`, ни UNIQUE/индекса, ни защиты от **подстановки прошлого timestamp**: колонка `created_at` обычная с default (0000_mvp.sql:31), триггер блокирует только UPDATE/DELETE ⇒ backdated-INSERT структурно разрешён, а «latest row wins» такой ряд послушает | В |
| D4 | T33, RIGHTS-07 | `backup_verified` выставляется **по одним часам**: `where status='processor_complete' and backup_expires_at <= verifiedAt` (`privacy-repository.ts:888-896`), и сам код это признаёт константой `backupDeletionClaim: "expiry_evidence_only"` (:105). Плюс примирительный путь генерирует `receipt_ref = 'reconciled:<ключ>'` без артефакта поставщика. Итог: «поставщик не подтвердил» может выглядеть как «уничтожено» | В |
| D5 | EGRESS-01, T18 | Повторной проверки согласия **непосредственно перед отправкой** нет ни на одном пути: диспетчер `telegram.send_text.v1` проверяет только флаг, тему и схему payload (`packages/worker/src/telegram-send-text-dispatcher.ts:66-78`); в SQL выборки очередей privacy-предиката нет (`outbox-repository.ts:146-215`) | А |
| D6 | EGRESS-03, T12, T25 | Барьера ревизии (монотонной) нет: отзыв — это вставка `denied` под advisory-lock; гонка «enqueue vs revoke» сериализуется общим замком, а «dispatch после отзыва» — нет. `booking.handoff_revoked` порождается, но потребителя в allowlist воркера нет (`TASK-PLT-022`) | В (потребитель), А (остальное) |
| D7 | T20 | Поздний ответ провайдераenqueue-ит доставку по одному лишь дедлайну, без повторной сверки согласия (`selarti-proposal-repository.ts:152-172`) | А |
| D8 | RIGHTS-03/04, T31 | Нет ни записи об обращении, ни разных сроков, ни рабочего календаря: intake ограничен типами `safety|negative_feedback|delivery_failure`, часов обязательств нет; повсеместно один горизонт «35 дней» (`docs/operations/data-retention.md:7-11`) | А |
| D9 | RIGHTS-05, T32 | Удаление не трогает `dialogue_inbound`/`dialogue_deliveries`/`dialogue_route_decisions`, очередь/`integration_outbox` субъекта, `notifications`, строки `reservations`/`conversations` (обнуляются только ссылки), файлы (пишется манифест, клиента хранилища нет); продуцентов `privacy_retention_items` нет вовсе | А |
| D10 | RIGHTS-08 | Экспорт неатомен (9 независимых чтений), не пишется в аудит и не имеет собственного транспорта/ссылки; в UX отзыв и удаление не разделены | А |
| D11 | BOT-04 | `callback_query`-ветка не читает `chat.type` ⇒ групповой callback не отвергается; экспертный webhook-маршрут не имеет `botKey`, поиск `channel_identities` без `bot_key`; IP-допуск сетей Telegram отсутствует; webhook-секрет экспертного маршрута может быть рандомным на каждый старт (`apps/api/src/server.ts:379-380`) — **закрыто частично 2026-09-21**: `callback_query`-ветка сверяет `chat.type` и отвергает не-приватный чат (`apps/api/src/routes/telegram-webhook.ts`); тесты: групповой 403, приватный 200, контроль снятием стража — групповой возвращает 200. Остаток: экспертный webhook-маршрут без обязательного `botKey` | А (частично закрыто) |
| D12 | BOT-05 | Нет `editMessageReplyMarkup`/`deleteMessage` вообще: отработанная клавиатура не убирается, «старая кнопка» остаётся видимой (сервер лишь отказывает на consume) | А |
| D13 | BOT-01/07, CONS | Согласительного сообщения, кнопок «СОГЛАСЕН/НЕ СОГЛАСЕН», пунктов «Мои согласия/Отозвать/Мои данные/Удалить данные/Поддержка» и команд `/privacy|/consents|/revoke|/delete_me|/stop` — ноль | А |
| D14 | WEB-04/05 | Нет ни одной web-команды согласия (в `apps/api/src/routes/` privacy-маршрутов нет, `privacyService` = `disabledService`, `apps/api/src/server.ts:337`), нет и first-party анонимного идентификатора сессии — приписать согласие сессии, не человеку, сегодня нечем | В |
| D15 | RET-04, T34/T35 | Восстановление не перечитывает журнал отзыва/удаления: `docs/operations/disaster-recovery.md` (11 строк) не содержит ни слова о ре-применении, изоляции площадки или заморозке исходящих; намерение записано только как гейт PRIV-04 | А |
| D16 | TRACK-05, T29 | В `msg` попадают сырой путь с query (404 Fastify) и текст 5xx-исключения; правила для URI/query в санитизаторе нет | В (правило отсутствует) / А (вывод) |
| D17 | TRACK-05 «не уничтожать диагностику» | Access-лог потерял method, statusCode, шаблон маршрута и remote address: `sanitizeTelemetry` разворачивает `req`/`res` через `Object.entries` и не видит прототипные геттеры | А |
| D18 | TRACK-05, SEC-03 | `botKey` — сегмент пути `/v1/webhooks/telegram/client/:botKey`, а в `deploy/nginx/ii-tonya` нет `access_log`/`log_format` ⇒ секрет уходит в default combined-журнал nginx | В |
| D19 | TRACK-05 | Нет `unhandledRejection`/`uncaughtException`: Node пишет стек в stderr мимо санитизатора; воркер не логирует ничего (`outbox-runner.ts:440` сводит исключение к reason-code) | А |
| D20 | SEC-03, T30 | Ловушка проверки: `packages/observability/dist` — сборка 11.09 без исправления Error, пакет потребляется через `dist` ⇒ «зелёный» локальный прогон может идти на устаревшем коде | В |
| D21 | SEC-03 | Бандлы полной истории (≈5,6 МБ) в рабочем дереве не были в `.gitignore` — закрыто этим прогоном (`*.bundle`, `*.tar.gz`; `git check-ignore` подтверждает) | В (закрыто) |

## 3. Требуется подтверждение оператора/вендора/юриста — код это не решит

| Пункт ТЗ | Чего нет в дереве |
| --- | --- |
| VENDOR-01/03 | реестра получателей как данных (нет таблицы/файла); договорных условий Selarti и фактической цепочки LLM-провайдеров; режимов обучения/журналов/прекращения |
| DATA-03, VENDOR-02, T41 | документов FirstVDS по арендуемой услуге, снимкам, резервному хранилищу, администрированию, мониторингу; «Москва» от заказчика — исходное условие, не документ (Н) |
| DATA-04, BOT-08, T40 | заключения по фактическому потоку Telegram и статусу оператора, проверки применимости ст. 15 41-ФЗ (Н) |
| CONS-05, LEGAL-01/02 | утверждённых текстов (полное согласие, политика, оферта, cookies), реквизитов оператора, уведомления РКН; публикация по-прежнему под `DEC-PLT-007` |
| SENS-01/02 | основания для специальных категорий — карточек `DEC-PLT-011…014` достаточно нет; релиз их и не требует (подписи нет) |
| RET-01 | утверждённой машиночитаемой политики сроков (строки ТЗ — предложение, требует утверждения `DEC-PLT-004`/`PLT-012`) |
| EGRESS-05 | recovery-контракта: сейчас удаление стирает `client_booking_receipts` (`packages/worker/src/client-booking-erasure.ts:163-166`), а возврат в YooKassa требует живой контакт под согласием — отозванное согласие может застрять финансовую операцию (`payment-adapter.ts:285-292`) |
| MIG-03 | снятия противоречия: `docs/operations/owner-update-data-matrix.md:80` «молчание = отказ, жёсткое удаление T0+61» против ТЗ «молчание не считается отказом и не требует вымышленной записи» |
| SEC-01 | инвентаризации ИСПДн, модели угроз и уровня ИСПДн (УЗ-2 объявлялось по признаку «нет спецкатегорий», ТЗ требует оценки) (Н) |
| LEGAL-04 | даты применяемой редакции: изменения по 289-ФЗ/290-ФЗ со 02.10.2026 на момент ТЗ не действовали — при переносе релиза за дату требуется отдельная оценка |
| QA-01/02 | независимого privacy/security-ревью, точных прогонов Claw CI/Database Gate и canary-трасс по включаемым маршрутам |

## 4. Журналы, секреты и гигиена дерева (`TRACK-05`, `SEC-02…04`, T29, T30)

| Факт | Пометка |
| --- | --- |
| Один sanitizing слой pino: 41 redact-путь, рекурсивный блок по имени ключа, очистка значений по форме (tg `/bot…/`, `sk\|pk\|rk_(live\|test)_`, DSN, JWT, AWS, `Bearer`, `cs1./ch1./bk1.`, UUID, ISO с мс) | А |
| Исправление 17.09 (ошибка не сериализуется в `{}`) есть в исходниках (`packages/observability/src/logger.ts:96-110`, тест `logger.test.ts:179-197`), но `packages/observability/dist` — сборка 11.09, а пакет потребляется через `dist`: локальный прогон API по-прежнему даёт `"err":{}`. Ловушка «сначала собери пакет» | В |
| **T29 не выполняется:** в `msg` попадают сырой путь и query (`Route GET:/nope?email=…&code=EXPE-RT-12345 not found` — 404 Fastify) и текст 5xx-исключения; правила для URI/query в санитизаторе нет | В (правило отсутствует, греп), А (сам вывод) |
| Обратная сторона — `TRACK-05` «не уничтожать всю диагностику» не выполнена: в access-строке нет ни method, ни statusCode, ни шаблона маршрута, ни remote address (flattening `req`/`res` через `Object.entries` не видит прототипные геттеры) | А |
| `botKey` — сегмент пути `/v1/webhooks/telegram/client/:botKey`, а в `deploy/nginx/ii-tonya` нет ни `access_log`, ни `log_format` ⇒ nginx пишет сырой URI в default combined, то есть `botKey` попадает в журнал сервера | В |
| `process.on('unhandledRejection' / 'uncaughtException')` нет ни в API, ни в воркере ⇒ Node печатает стек в stderr мимо санитизатора | А |
| Воркер не логирует ничего (`apps/worker/src/main.ts` не импортирует логгер; `outbox-runner.ts:440` сводит исключение к reason-code): приватно, но без диагностики | А |
| Секретная гигиена дерева: `.env` игнорируется, в дереве только плейсхолдеры вида `{{planerka_api_key}}`; gitleaks с allowlist отпечатков и `--redact`, но исполняется локально | А |
| Подозрение «в репозитории закоммичены PII» — **проверено и снято**: 24 совпадения телефон/почта в `docs/source/*.txt` это синтетические строки учебного корпуса (`CL_001 Иван Петров +7900…`, рядом «залейте тестовых клиентов»), репозиторий приватный (`gh repo view` → `visibility: PRIVATE`), в 14 закоммиченных raw-логах `docs/test-evidence/**/*.log` совпадений телефон/почта — 0 | В |
| Закрыто этим прогоном: бандлы полной истории (≈5,6 МБ) в рабочем дереве **не были в `.gitignore`** — один `git add -A` уносил их в репозиторий. Добавлены `*.bundle`, `*.tar.gz`, `git check-ignore` подтверждает | В |
| Внешнего CI нет (`git ls-files` по `.github/workflows` пуст): «no prod dumps to CI» обеспечивается отсутствием CI, а не правилом | В |

Не снимается этим пакетом: `docs/source/*.txt` и `docs/test-evidence/**/*.log` уже в истории
коммитов; перед любой сменой видимости репозитория требуется скан всей истории и бандлов
(`SEC-03`) — это решение владельца, а не техническая задача W1.

## 5. Порядок реализации, который из этого следует

`RELEASE-02`: карта (этот документ) → тексты и основания (раздел 3) → реализация на синтетических
данных (раздел 2) → проверки удаления/отзыва/восстановления → внешние подтверждения → ограниченный
запуск. Технические предпосылки первого кода:

1. `0039` — аддитивное расширение `consents` (CHECK на `decision`, индекс `(user_id, consent_type,
   created_at desc, id desc)`, immutable-защита `created_at`) + таблицы `consent_document_versions`,
   `consent_presentations`, проекция `consent_states` с монотонной `revision`; доказательственное
   наследие ретейнить через существующие очереди, а не UPDATE/DELETE append-only таблиц (иначе
   конфликт с триггером).
2. Единая деривация «текущего решения» вместо D2, и один барьер ревизии вместо D5/D6/D7.
   Из этого пункта закрыта только деривация (2026-09-21: `consent-current.ts` для трёх читателей и
   писателя отзыва + трипвайр `tests/repo/consent-current-derivation-boundary.test.ts`);
   барьер ревизии не начат — `revision`/`revoke_epoch` в `consent_states` не читает ни одно место.
3. Подключение очистки (D1) и разделение часов (D8) — только с утверждённой политикой сроков.

Ничего из перечисленного не включает внешний маршрут и не публикует тексты.
