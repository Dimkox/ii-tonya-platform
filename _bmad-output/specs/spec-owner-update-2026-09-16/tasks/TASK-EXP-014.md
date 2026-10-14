# TASK-EXP-014: Визуальная система лендинга

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** После решения: палитра, hero, dialog и responsive параметры.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: design; исполнитель: designer; приоритет: P2.
- Depends on: [TASK-EXP-013](TASK-EXP-013.md), [TASK-DEC-EXP-005](TASK-DEC-EXP-005.md).
- Решения: DEC-EXP-005.
- Вопросы: Q-103, Q-110, Q-111, Q-112.

## Что уже есть

Landing styles существуют, но выбор одной конфликтующей палитры ждёт DEC-EXP-005.

## Файлы

**Прочитать:**

- [apps/web/src/landing-view.ts](../../../../apps/web/src/landing-view.ts)
- [apps/web/src/styles.css](../../../../apps/web/src/styles.css)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [apps/web/src/landing-view.ts](../../../../apps/web/src/landing-view.ts)
- [apps/web/src/styles.css](../../../../apps/web/src/styles.css)

**Создать:**

Нет.

**Проверки:**

- [apps/web/src/landing-view.test.ts](../../../../apps/web/src/landing-view.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-014.01** — Hero: женщина 30–40, тёплая/мудрая, нейтральный путь развития, точные greeting/subtitle/CTA.
  - Проверка: Hero содержит 3 текста и CTA.

- [ ] **REQ-EXP-014.02** — Палитры: eco #C67B5C/#E8D5C4/#8FBC8F/#FAF7F2/#3D2C1E/#FDFBF7; lavender #9B7B9B/#D4C5D4/#E8D5E8/#F9F5F9/#3D2C3D/#FDFBFD; blue #2C3E6B/#4A6A8B/#C9A84C/#F5F7FA/#1A2332/#FFFFFF.
  - Проверка: Каждая palette задаёт 6 tokens.

- [ ] **REQ-EXP-014.03** — Dialog 600px/20px/radius20/avatar40/bubble80%; Intersection Observer, FAQ click, hero typing, button hover; layout1200, ≤768 stack, font desktop16/mobile14; CTA 14×32/radius50/font18/hover accent−2 shadow.
  - Проверка: 768px stacks; dialog ≤600px.

## Точные подпункты и каталоги

Применить каждый подпункт в пределах утверждённых решений; для отвергнутого варианта сохранить причину и ссылку на решение.

- [ ] **DET-110** — Персонаж: женщина 30–40 лет, тёплый взгляд, мудрая улыбка, естественная красота; не «училка», а партнёр в пути.

- [ ] **DET-111** — Фон: мягкий и нейтральный, с намёком на путь/развитие/эволюцию.

- [ ] **DET-112** — Палитры: тёплый эко, мягкий лавандовый, глубокий синий с акцентами.

- [ ] **DET-113** — Текст: «Привет, я ии-Тоня 👋»; «Я помогу тебе найти того, кто поможет на твоём пути развития»; «Твой персональный навигатор по миру саморазвития».

- [ ] **DET-114** — CTA: «Попробовать бесплатно» ведёт в диалог мессенджера.

- [ ] **DET-145** — Эко: primary #C67B5C; secondary #E8D5C4; accent #8FBC8F; background #FAF7F2; text #3D2C1E; light #FDFBF7.

- [ ] **DET-146** — Лавандовая: primary #9B7B9B; secondary #D4C5D4; accent #E8D5E8; background #F9F5F9; text #3D2C3D; light #FDFBFD.

- [ ] **DET-147** — Синяя: primary #2C3E6B; secondary #4A6A8B; accent #C9A84C; background #F5F7FA; text #1A2332; light #FFFFFF.

## Шаги

- [ ] После DEC-EXP-005 выбрать одну палитру и завести ровно шесть tokens без смешения альтернатив.
- [ ] Собрать hero: женщина 30–40, тёплая/мудрая, нейтральный путь развития, заданные greeting/subtitle/CTA.
- [ ] Настроить dialog max 600px, padding 20px, radius 20px, avatar 40px, bubble max 80%.
- [ ] Проверить layout 1200, stack ≤768px, desktop 16/mobile 14, observer/FAQ click/typing/hover.

## Критерии приёмки

- [ ] До DEC-EXP-005 палитры не смешиваются в CSS.
- [ ] Выбранная палитра имеет 6 tokens.
- [ ] Dialog не шире 600px, layout складывается при ≤768px.
- [ ] CTA: 14px horizontal padding, 32px height, radius 50px, font 18px.
- [ ] Hero содержит greeting, subtitle и CTA.

## Команды проверки

```bash
pnpm vitest run apps/web/src/landing-view.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
