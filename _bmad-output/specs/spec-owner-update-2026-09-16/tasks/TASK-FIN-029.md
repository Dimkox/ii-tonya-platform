# TASK-FIN-029: Подключить qualified referral count к расчёту партнёрской полосы

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Котировка получает фактическое число подтверждённых квалифицированных рефералов, а не литерал 0.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: `TASK-DEC-FIN-031`.
- Решения: `DEC-FIN-012`, `DEC-FIN-031`.
- Носитель: независимый review FIN-артефактов и попытка исполнения 2026-09-21.
- Статус live: ничего не включается; внешние флаги остаются `false`.

## Что уже есть

Разделено 2026-09-21. Исполнено: границы полосы закреплены тестами 0..99 на оба kind (packages/domain/src/partner-pricing.test.ts, 52 теста; контроль: при пороге 5 вместо 6 краснеют ровно кейсы «5 -> STANDARD»), плюс DB-free гарант tests/repo/partner-quote-source.test.ts, пиннящий отсутствие источника числа (проверен переворотом: добавление колонки expert_id делает его красным). Не исполнимо сейчас: сам подсчёт qualified count — связи commercial_participants с экспертами в схеме нет (замер 2026-09-21), production-путь передаёт литерал 0 (partner-commerce-repository.ts:101) → блокируется DEC-FIN-031.

## Файлы

**Прочитать:**

- [partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [partner-pricing.test.ts](../../../../packages/domain/src/partner-pricing.test.ts)
- [partner-commerce-repository.ts](../../../../packages/db/src/repositories/partner-commerce-repository.ts)
- [partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)


**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.


**Изменить:**

- [partner-commerce-repository.ts](../../../../packages/db/src/repositories/partner-commerce-repository.ts)


**Создать:**

- [partner-tier-wiring.test.ts](../../../../tests/repo/partner-tier-wiring.test.ts)


**Проверки:**

- [partner-tier-wiring.test.ts](../../../../tests/repo/partner-tier-wiring.test.ts)


## Пункты задачи

- [ ] Котировка получает фактическое число подтверждённых квалифицированных рефералов, а не литерал 0.
- [ ] Boundary-тесты на 4/5/6/9/10 подтверждают: 5 ⇒ STANDARD, 6 ⇒ REFERRED_6_9, 10 ⇒ REFERRED_10_PLUS без ретро-смены.
- [ ] Гарунт tests/repo/partner-quote-source.test.ts: отсутствие аффилиации и литерал 0 в writer зафиксированы тестом и обязаны перевернуться при добавлении связи.


## Шаги

- [ ] Взять источник qualified count из действующего движка квалификации (оплаченное/подтверждённое участие), не из числа регистраций.
- [ ] Не менять пороги DEC-FIN-012 (>=6 и >=10) и не трогать conservation-тесты полос.


## Критерии приёмки

- [ ] Ни одна новая котировка не сохраняется в STANDARD при >=6 подтверждённых рефералах (тест).
- [ ] Поведение существующих строк не меняется задним числом: пересчёт только для новых котировок.


## Команды проверки

```bash
pnpm exec vitest run tests/repo/partner-tier-wiring.test.ts
```


## Исполнено / заблокировано (2026-09-21)

- [x] Границы полосы: `packages/domain/src/partner-pricing.test.ts` дополнен cases 0..11 и 99 на
  CENTER и ORGANIZER (всего 52 теста зелёные). Контроль переворота сделан: при подмене порога `>=6`
  на `>=5` краснеют ровно кейсы «counts 5 -> STANDARD» (3 падения), после возврата — 52 зелёные.
- [x] Гарантирующий тест `tests/repo/partner-quote-source.test.ts`: пиннит отсутствие аффилиации
  `commercial_participants`↔эксперты и литерал `qualifiedExpertCount: 0` в writer. Проверен
  переворотом: временная колонка `expert_id` делает тест красным, после `git checkout --` — снова
  зелёный и диф пуст.
- [ ] Подключение реального счётчика — **заблокировано `DEC-FIN-031`**: источника числа в схеме нет,
  это не опечатка в проводке, а отсутствующая модель данных.

## Evidence и завершение

- [ ] Результаты проверок сохранены с точным коммитом.
- [ ] Независимый review пройден; live-активация не объявляется.
- [ ] Контрольный случай обязан перевернуться: тест, который не может стать красным, не является доказательством.
