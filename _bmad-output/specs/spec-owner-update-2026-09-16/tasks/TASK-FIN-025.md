# TASK-FIN-025: Проверить active financial content against selected policy

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Approved vs superseded copy inventory with required disclosures.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: content; исполнитель: product-owner; приоритет: P1.
- Depends on: [TASK-FIN-021](TASK-FIN-021.md), [TASK-FIN-022](TASK-FIN-022.md), [TASK-FIN-024](TASK-FIN-024.md), [TASK-DEC-FIN-005](TASK-DEC-FIN-005.md), [TASK-FIN-007](TASK-FIN-007.md), [TASK-DEC-FIN-008](TASK-DEC-FIN-008.md), [TASK-FIN-015](TASK-FIN-015.md), [TASK-DEC-FIN-027](TASK-DEC-FIN-027.md).
- Решения: DEC-FIN-005, DEC-FIN-007, DEC-FIN-008, DEC-FIN-014, DEC-FIN-022, DEC-FIN-027.
- Вопросы: Q-082, Q-083, Q-089, Q-146, Q-159, Q-163, Q-177.

## Что уже есть

Source mixes active, legacy and test-demo price/coupon messages; no canonical active content matrix was provided.

## Файлы

**Прочитать:**

- [_bmad-output/specs/spec-owner-update-2026-09-16/source-claims.json](../../../../_bmad-output/specs/spec-owner-update-2026-09-16/source-claims.json)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-active-content-matrix.md](../../../../docs/superpowers/implementation-artifacts/fin-active-content-matrix.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-004.05** — Экспертская коммуникация может объяснять купон как скидку первой сессии и разрешать заложить скидку в цену, но не обещает повторную покупку и не подменяет правила компенсации эксперту.
  - Проверка: Утверждённый контент не содержит гарантии постоянного клиента и ссылается на фактический финансовый механизм.

- [ ] **REQ-FIN-006.02** — Коммерческие объяснения в тестовом экспертском сценарии не включают спорные старые цены как активную оферту.
  - Проверка: Snapshot тестового контента не содержит неутверждённых цен/гарантий.

- [ ] **REQ-FIN-014.03** — До подтверждения участия можно спросить о коллегах, но полные материалы, сообщения, промокоды и регистрационные инструкции выдаются только после утверждённого момента оформления.
  - Проверка: Контент и API-gating используют один установленный статус участия.

- [ ] **REQ-FIN-018.01** — Поздняя версия источника предлагает сохранить старую недельную динамику 8–14 тысяч и V3-диапазоны в коде неактивными. Применимость этого перехода фиксируется вместе с выбранной новой policy; прежняя формула не удаляется или активируется самим разбором.
  - Проверка: Новый quote не может выбрать legacy weekly table без явного historical policy version.

- [ ] **REQ-FIN-018.02** — Early Birds — отдельный невыбранный вариант: 30 мест, публичный min(счётчик,10), 30000 за 365 дней, 15000+15000 через 30 дней и overdue без блокировки доступа; его запуск/архивация требует явного решения.
  - Проверка: При отсутствии решения Early Birds не доступен в checkout и контент помечен архивным.

- [ ] **REQ-FIN-018.03** — Публичный контент о тарифе, эксклюзиве, купонах и экспертской выгоде использует только утверждённую policy version и не показывает старую цену как действующую.
  - Проверка: Контент-проверка не находит superseded values в active templates.

## Шаги

- [ ] Map each price/discount/coupon statement to policy version.
- [ ] Remove/mark unsupported promises such as guaranteed repeat client.

## Критерии приёмки

- [ ] No active template cites a superseded price, unchosen expiry or unchosen bonus cap.

## Команды проверки

```bash
rg -n '8000|9000|10000|12000|20000|Early Birds|2 месяца по цене 1' docs packages
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
