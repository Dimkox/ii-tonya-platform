# TASK-FIN-023: Реализовать approved partner finance policy

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Approved partner quote/settlement policy and migration.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-FIN-012](TASK-FIN-012.md), [TASK-FIN-013](TASK-FIN-013.md), [TASK-FIN-014](TASK-FIN-014.md), [TASK-FIN-020](TASK-FIN-020.md).
- Решения: DEC-FIN-012, DEC-FIN-013, DEC-FIN-020.
- Вопросы: Q-075, Q-076, Q-127, Q-148, Q-150, Q-151, Q-152, Q-164, Q-188, Q-190, Q-191.

## Что уже есть

Current partner calculator is shadow-only with >=6/10 and fixed entitlements; settlement/deposit policy is not verified.

## Файлы

**Прочитать:**

- [packages/domain/src/partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)
- [packages/db/migrations/0037_partner_commerce_a.sql](../../../../packages/db/migrations/0037_partner_commerce_a.sql)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/domain/src/partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)

**Создать:**

- [packages/domain/src/partner-finance.test.ts](../../../../packages/domain/src/partner-finance.test.ts)
- [packages/db/migrations/0041_fin_partner_policy.sql](../../../../packages/db/migrations/0041_fin_partner_policy.sql)

**Проверки:**

- [packages/domain/src/partner-pricing.test.ts](../../../../packages/domain/src/partner-pricing.test.ts)
- [packages/domain/src/partner-finance.test.ts](../../../../packages/domain/src/partner-finance.test.ts)
- [packages/db/src/repositories/partner-commerce-repository.test.ts](../../../../packages/db/src/repositories/partner-commerce-repository.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-011.01** — Центр/студия/салон имеет базу 15000 ₽/месяц и квоту 10 мероприятий вместимостью до 30; сверх квоты взимается 10% сбора, нерезидент — 15% выручки + 4500 ₽ за карточку.
  - Проверка: Quote центра возвращает 15000, entitlement 10×30 и заданные комиссии.

- [ ] **REQ-FIN-011.02** — Тариф по приведённым экспертам имеет альтернативные границы: <5/5–9/10+ = 15000/12000/8000 либо 0–5/>5–<10/10+; текущий код использует >=6 и >=10. Определить квалификацию учитываемого эксперта.
  - Проверка: Boundary-тесты на 4, 5, 6, 9 и 10 квалифицированных экспертов соответствуют принятой таблице.

- [ ] **REQ-FIN-012.01** — Организатор имеет базу 20000 ₽/месяц и включения 5 событий до 50, 3 до 100 и 1 до 500; сверх лимита — 10%, нерезидент — 15% выручки + 4500 ₽.
  - Проверка: Quote организатора возвращает три точные корзины 5×50, 3×100 и 1×500.

- [ ] **REQ-FIN-012.02** — Тариф по приведённым экспертам имеет альтернативы <5/5–9/10+ = 20000/15000/10000 и 0–5/>5–<10/10+; текущий код использует >=6. Определить, расходует ли меньшее мероприятие квоту большей корзины и кто считается квалифицированным экспертом.
  - Проверка: Boundary 5/6/10 и расход одной корзины другой покрыты тестами.

- [ ] **REQ-FIN-013.01** — Базовый резидент получает неограниченные индивидуальные услуги и одну группу до 20 человек в месяц; дополнительная группа стоит 10% расчётной выручки. Нерезидент может заказать только набор группы за 15% выручки + 4500 ₽ карточки.
  - Проверка: Quote отделяет включённую группу, дополнительную резидентскую и нерезидентскую услугу.

- [ ] **REQ-FIN-013.02** — При заявке берётся бронь 30%; исходные формулировки «30% услуги проекта» и «30% предполагаемой выручки» являются альтернативами. После набора оплачивается остаток 70%, отчёт формируется по зарегистрированным, счёт имеет срок 5 рабочих дней, набор не гарантирован.
  - Проверка: Decision определяет базу 30%; settlement использует зарегистрированных участников и сохраняет расчёт.

## Точные подпункты и каталоги

Применить каждый подпункт в пределах утверждённых решений; для отвергнутого варианта сохранить причину и ссылку на решение.

- [ ] **DET-056** — Расчётная выручка: сумма «количество мест × цена места» по всем тарифам.

- [ ] **DET-057** — Резидент: услуга проекта = расчётная выручка × 10%.

- [ ] **DET-058** — Алгоритм источника: бронь = услуга проекта × 30%; доплата = услуга проекта − бронь.

- [ ] **DET-059** — Нерезидент: услуга проекта = расчётная выручка × 15% + 4 500 ₽ за заведение карточки.

- [ ] **DET-060** — Отчёт строится по участникам, зарегистрированным в базе проекта.

## Шаги

- [ ] Implement selected tiers and consumption rules.
- [ ] Persist deposit/settlement evidence without coupling to external provider actions.

## Критерии приёмки

- [ ] Tests cover 4/5/6/9/10, all event bands, deposit and nonresident calculation.

## Команды проверки

```bash
pnpm exec vitest run packages/domain/src/partner-pricing.test.ts packages/domain/src/partner-finance.test.ts packages/db/src/repositories/partner-commerce-repository.test.ts
pnpm exec vitest run tests/repo/migration-history-integrity.test.ts
git diff --check
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
