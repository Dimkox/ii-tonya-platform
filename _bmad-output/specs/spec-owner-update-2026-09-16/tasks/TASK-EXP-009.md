# TASK-EXP-009: Продажный диалог эксперта и handoff

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Карта тегов, вопросов и handoff без FAQ-спама и гарантий.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-EXP-007](TASK-EXP-007.md).
- Решения: нет.
- Вопросы: Q-085, Q-093, Q-099, Q-101, Q-147.

## Что уже есть

Есть trial и operator cases; policy тегов, objections и запрет гарантий клиентов не собраны в один flow.

## Файлы

**Прочитать:**

- [packages/application/src/test-expert-telegram-service.ts](../../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/application/src/operator-case-service.ts](../../../../packages/application/src/operator-case-service.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/test-expert-telegram-service.ts](../../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/application/src/operator-case-service.ts](../../../../packages/application/src/operator-case-service.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../../packages/application/src/test-expert-telegram-service.test.ts)
- [packages/application/src/operator-case-service.test.ts](../../../../packages/application/src/operator-case-service.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-009.01** — FAQ выдаётся только на вопрос; price question создаёт «интерес»; также метки тест_эксперт, готовность, сомнение, запись_на_встречу, передан_менеджеру, запросил_ссылки.
  - Проверка: Без вопроса не показывается полный FAQ.

- [ ] **REQ-EXP-009.02** — Спросить каналы и сложности, ждать ответы, обработать низкую конверсию, дорогую рекламу, поток, холодных клиентов, трудоёмкость, маркировку; фиксированная плата объясняется диагностикой/сопровождением/мотивацией/клубами.
  - Проверка: Ветка не гарантирует клиентов.

- [ ] **REQ-EXP-009.03** — Недостающие поля: приоритетные услуги, число клиентов, каналы, соцсети/сайт, организация офлайн/онлайн событий; ответы грамотны, кратки, персональны, с next step, вопросом/действием, без спама/перебивания/гарантий.
  - Проверка: Гарантия клиентов отклоняется guard.

## Шаги

- [ ] Отдавать FAQ только на явный вопрос и создавать тег «интерес» при вопросе о цене.
- [ ] Сохранять теги тест_эксперт, готовность, сомнение, запись_на_встречу, передан_менеджеру, запросил_ссылки.
- [ ] Собирать каналы, сложности, услуги, число клиентов, соцсети/сайт, офлайн/онлайн события с ожиданием ответа.
- [ ] Обрабатывать низкую конверсию, дорогую рекламу, поток, холодных клиентов, трудоёмкость и маркировку с вопросом/действием; при нужде создать manager handoff.

## Критерии приёмки

- [ ] Без вопроса полный FAQ не отправляется.
- [ ] Вопрос о цене создаёт «интерес».
- [ ] Текст не гарантирует клиентов или доход.
- [ ] Повтор передачи менеджеру сохраняет один case на одинаковое событие.

## Команды проверки

```bash
pnpm vitest run packages/application/src/test-expert-telegram-service.test.ts packages/application/src/operator-case-service.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
