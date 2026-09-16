# TASK-PLT-013: Конфигурация, секреты и журнал интеграций

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Конфигурация, секреты и журнал интеграций с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `verified_pending_review`; readiness: `ready`.
- Тип: verification; исполнитель: ops; приоритет: P0.
- Depends on: нет.
- Решения: нет.
- Вопросы: Q-038 (остаётся открытым осознанно; блокирует форму хранения секретов, но не инвентарь, не redaction и не default-off).
- Статус live: ничего не включено и не активировано; задача только проверяет поверхность конфигурации и закрывает найденные пробелы redaction.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [packages/config/src/env.ts](../../../../packages/config/src/env.ts)
- [.env.example](../../../../.env.example)
- [scripts/validate-runtime-env.sh](../../../../scripts/validate-runtime-env.sh)
- [packages/observability/src/logger.ts](../../../../packages/observability/src/logger.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/config/src/env.ts](../../../../packages/config/src/env.ts) — не изменён намеренно: объявлять форму переноса секретов без закрытого `Q-038` значило бы изобрести контракт, который потом переписывает владелец.
- [.env.example](../../../../.env.example) — удалён второй `TELEGRAM_WEBHOOK_SECRET`.
- [scripts/validate-runtime-env.sh](../../../../scripts/validate-runtime-env.sh) — не изменён: добавление проверки прав может уронить живой деплой, а сам скрипт контент-пиннуется `tests/repo/scope-boundary.test.ts`; сниппет предложен в инвентаре и ждёт решения оператора.
- [packages/observability/src/logger.ts](../../../../packages/observability/src/logger.ts) — закрыты три пробела redaction.

**Создать:**

- [docs/operations/owner-update-secret-inventory.md](../../../../docs/operations/owner-update-secret-inventory.md)

**Проверки:**

- [tests/repo/env-policy.test.ts](../../../../tests/repo/env-policy.test.ts)
- [packages/config/src/env.test.ts](../../../../packages/config/src/env.test.ts)
- [packages/observability/src/logger.test.ts](../../../../packages/observability/src/logger.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-004.03** — Конфигурация должна внешне задавать идентификатор Sheets и имена 8 листов, URL/API-учётные данные Planerka и Selarti, токен Telegram и admin chat id, а также константы: min_hours_before_slot=24, reservation_hours=72, reminder_days=3, package_days=60, coupon_days=90.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.
  - **Остаётся НЕисполненным.** Инвентарь установил: 20 из 24 требуемых имён отсутствуют в zod-схеме `packages/config/src/env.ts`, из них 15 отсутствуют и в `.env.example` (включая все 8 имён листов и все пять констант); ещё 5 объявлены в шаблоне, но не читаются кодом. Установка любого из них сегодня ничего не меняет. Подключение — предмет `TASK-PLT-001`/`TASK-PLT-002`/`TASK-PLT-005`, форма переноса секретов блокируется `Q-038` и `DEC-PLT-003`.

- [x] **REQ-PLT-004.07** — Источник содержит идентификаторы интеграций и секретные учетные данные; их нельзя печатать, коммитить, хранить в промптах или использовать без отдельной безопасной настройки.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат. — Проверено: ни одного секрета в репозитории и в шаблоне (только `__PLACEHOLDER_*__`), три реальных пробела redaction закрыты с регресс-тестами, использование без отдельной настройки невозможно (восемь переключателей интеграций зафиксированы в `z.literal("false")`, адаптеры выбрасывают disabled-ошибку).

## Шаги

- [x] Составить инвентарь имён env без значений: Telegram, Selarti, Planerka, Sheets и13 сценариев. — [docs/operations/owner-update-secret-inventory.md](../../../../docs/operations/owner-update-secret-inventory.md); имена сгруппированы по статусам `LIVE` / `UNWIRED` / `ABSENT`, значений нет.
- [x] Проверить redaction логов, ограничение доступа и default-off при неполных параметрах. — Redaction: найдены и закрыты три утечки (голый токен Telegram вне `/bot…/`-URL, формы `sk_live_`/`sk_test_`/`pk_`/`rk_`, ключи `apiKey`/`password`/`passphrase`/`credential`/`*Key`-компаунды). Default-off: 29 из 29 `*_ENABLED` в шаблоне `false` и все объявлены в схеме. Ограничение доступа: файл-гейт проверяет regular/no-symlink, но **не проверяет права и владельца** `/etc/ii-tonya/runtime.env` — находка зафиксирована с готовым сниппетом и не применена (может уронить живой деплой; скрипт контент-пиннуется `tests/repo/scope-boundary.test.ts`).
- [x] Передать владельцу список требующих замены доступов из источника; не менять внешние секреты автоматически. — Список из 13 имён плюс пароль `DATABASE_URL` в разделе «Access restriction and rotation» инвентаря. Ни один внешний ключ не создан, не отозван и не заменён.
- [x] Если focused-проверка выявляет пробел env/redaction/default-off, исправить существующий конфигурационный путь и добавить регрессионную проверку; внешние ключи не менять. — Исправлено: `packages/observability/src/logger.ts` (+4 теста в `logger.test.ts`, включая анти-кейс «не-секретные `*Key` остаются видимыми») и удалён дубль `TELEGRAM_WEBHOOK_SECRET` в `.env.example` (+регресс-проверка на уникальность имён в обоих шаблонах в `tests/repo/env-policy.test.ts`).

## Критерии приёмки

- [x] Нет секретов в репозитории/промптах/логах/примерныхpayload. — Подтверждено `tests/repo/gitleaks-policy.test.ts`, `tests/repo/env-policy.test.ts` и новыми тестами redaction. Остаточные ограничения названы в инвентаре: нет детектора высокоэнтропийных строк вообще, голый chat id считается адресом получателя, а не кредитом.
- [x] Отсутствующая конфигурация даёт disabled adapter и понятную ошибку. — `DisabledPlanerkaAdapter` → `Planerka integration is disabled` (`packages/integrations/src/planerka/disabled-planerka-adapter.ts:8`), `disabled-selarti-adapter.ts:14,23`, `apps/api/src/server.ts:357`; покрытие `tests/contract/planerka-port.test.ts`.
- [x] Инвентарь содержит только имена и ответственных, без открытых значений.

## Команды проверки

```bash
pnpm exec vitest run tests/repo/env-policy.test.ts
pnpm exec vitest run tests/repo/env-policy.test.ts packages/config/src/env.test.ts packages/observability/src/logger.test.ts tests/repo/gitleaks-policy.test.ts
```

## Evidence и завершение

- [x] Сохранить результаты проверок и связь с пунктами исходника.
- [x] Закрыть связанные DEC/Q или явно оставить задачу blocked. — **`Q-038` остаётся открытым намеренно:** он блокирует выбор физической формы хранения/ротации (env-файл против secret manager), поэтому имена переноса секретов в схему не изобретались. `DEC-PLT-003` (контракты провайдеров) тоже открыт и держит подключение адаптеров.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.

### Прогон проверок (claw, 2026-09-15)

| Проверка | Результат |
|---|---|
| `vitest run tests/repo/env-policy.test.ts packages/config/src/env.test.ts packages/observability/src/logger.test.ts tests/repo/gitleaks-policy.test.ts` | 36 passed |
| `vitest run packages/observability` (весь пакет) | 38 passed |
| RED до правок: 3 теста redaction + тест на дубль имени | падали ровно по названным местам, анти-кейс проходил |
| `eslint` по трём изменённым TS-файлам | exit 0 |
| `tsc --noEmit -p tsconfig.tests.json` и `tsc --noEmit` в `packages/observability` | exit 0 |
| `prettier --check docs/operations docs/runbooks docs/architecture` | exit 0 |
| инвентаризация множеств (78 имён в `.env.example`: 61 имеют читателя — 59 через zod-схему или `process.env`, ещё 2 вне схемы (`NODE_ENV`, `EXPERT_REFERRAL_HMAC_KEYS_JSON`), — и 17 не читаются кодом; 20 из 24 имён карточки вне схемы; 24ч в 9 файлах, 72ч в 3) | посчитано скриптом по фактическим файлам, сведено в инвентарь |
