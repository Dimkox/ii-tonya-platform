# TASK-PLT-013: Конфигурация, секреты и журнал интеграций

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Конфигурация, секреты и журнал интеграций с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: verification; исполнитель: ops; приоритет: P0.
- Depends on: нет.
- Решения: нет.
- Вопросы: Q-038.

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

- [packages/config/src/env.ts](../../../../packages/config/src/env.ts)
- [.env.example](../../../../.env.example)
- [scripts/validate-runtime-env.sh](../../../../scripts/validate-runtime-env.sh)
- [packages/observability/src/logger.ts](../../../../packages/observability/src/logger.ts)

**Создать:**

- [docs/operations/owner-update-secret-inventory.md](../../../../docs/operations/owner-update-secret-inventory.md)

**Проверки:**

- [tests/repo/env-policy.test.ts](../../../../tests/repo/env-policy.test.ts)
- [packages/config/src/env.test.ts](../../../../packages/config/src/env.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-004.03** — Конфигурация должна внешне задавать идентификатор Sheets и имена 8 листов, URL/API-учётные данные Planerka и Selarti, токен Telegram и admin chat id, а также константы: min_hours_before_slot=24, reservation_hours=72, reminder_days=3, package_days=60, coupon_days=90.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-004.07** — Источник содержит идентификаторы интеграций и секретные учетные данные; их нельзя печатать, коммитить, хранить в промптах или использовать без отдельной безопасной настройки.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Шаги

- [ ] Составить инвентарь имён env без значений: Telegram, Selarti, Planerka, Sheets и13 сценариев.
- [ ] Проверить redaction логов, ограничение доступа и default-off при неполных параметрах.
- [ ] Передать владельцу список требующих замены доступов из источника; не менять внешние секреты автоматически.
- [ ] Если focused-проверка выявляет пробел env/redaction/default-off, исправить существующий конфигурационный путь и добавить регрессионную проверку; внешние ключи не менять.

## Критерии приёмки

- [ ] Нет секретов в репозитории/промптах/логах/примерныхpayload.
- [ ] Отсутствующая конфигурация даёт disabled adapter и понятную ошибку.
- [ ] Инвентарь содержит только имена и ответственных, без открытых значений.

## Команды проверки

```bash
pnpm exec vitest run tests/repo/env-policy.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
