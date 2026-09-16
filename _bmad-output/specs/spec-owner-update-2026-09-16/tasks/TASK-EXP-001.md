# TASK-EXP-001: Ограничитель клиентской копии ии-Тони

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Словарь допустимых тем и запрещённых утверждений для клиентской копии.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `implemented_pending_review`; readiness: `ready`.
- Тип: content; исполнитель: product-owner; приоритет: P0.
- Depends on: нет.
- Решения: нет.
- Вопросы: нет.
- Статус live: guard активен в коде и в тестах; активацию внешних каналов и production эта задача не включает и не подтверждает.

## Что уже есть

Лендинг использует имя «ии-Тоня»; единый runtime-guard клиентской копии не подтверждён.

## Файлы

**Прочитать:**

- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)
- [packages/domain/src/safety.ts](../../../../packages/domain/src/safety.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)
- [apps/web/src/landing-view.ts](../../../../apps/web/src/landing-view.ts)
- [apps/web/src/legal-view.ts](../../../../apps/web/src/legal-view.ts)
- [apps/web/src/styles.css](../../../../apps/web/src/styles.css)
- [packages/domain/src/safety.ts](../../../../packages/domain/src/safety.ts)
- [packages/domain/src/index.ts](../../../../packages/domain/src/index.ts)
- [packages/application/src/conversation-service.ts](../../../../packages/application/src/conversation-service.ts)
- [packages/application/src/selarti-response-service.ts](../../../../packages/application/src/selarti-response-service.ts)

**Создать:**

Нет (по факту исполнения добавлен тестовый мост [tests/repo/client-copy-guard.test.ts](../../../../tests/repo/client-copy-guard.test.ts) — см. «Отклонения» в Evidence).

**Проверки:**

- [apps/web/src/content.test.ts](../../../../apps/web/src/content.test.ts)
- [apps/web/src/landing-view.test.ts](../../../../apps/web/src/landing-view.test.ts)
- [apps/web/src/legal-view.test.ts](../../../../apps/web/src/legal-view.test.ts)
- [packages/application/src/prompt-safety.test.ts](../../../../packages/application/src/prompt-safety.test.ts)
- [packages/application/src/selarti-response-service.test.ts](../../../../packages/application/src/selarti-response-service.test.ts)
- [tests/repo/client-copy-guard.test.ts](../../../../tests/repo/client-copy-guard.test.ts)

## Пункты задачи

- [x] **REQ-EXP-001.01** — Имя клиентского ассистента — только «ии-Тоня»; он информирует о сервисе, тарифах, экспертах, пакетах, купонах, записи Planerka, отзывах, истории и справочных обновлениях.
  - Проверка: Рендер не содержит иного написания имени. — `guardClientCopy` проверяет каждое упоминание имени; публичный документ прогоняется тем же guard'ом в `tests/repo/client-copy-guard.test.ts`.

- [x] **REQ-EXP-001.02** — Запретить диагнозы, лечение, давление, перебивание, спам и слова «лучший», «топ», «хит», «скидка», «выгода», «экономия», «успей», «специально для вас», «рекомендуем», «запишитесь сейчас».
  - Проверка: Каждая запрещённая фраза отклоняется copy guard. — 19 формулировок из всех десяти слов и их словоформ отклоняются до отправки ответа.

## Точные подпункты и каталоги

Применить каждый подпункт в пределах утверждённых решений; для отвергнутого варианта сохранить причину и ссылку на решение.

- [x] **DET-001** — Приветствие: «Привет, я ии-Тоня. Помогу сориентироваться в сервисе: расскажу, как работают пакеты, купоны и запись к экспертам.» — зафиксирован принятым примером в guard-тесте.
- [x] **DET-002** — Предоставлять информацию о сервисе, тарифах и экспертах. — принятые нейтральные примеры в guard-тесте.
- [x] **DET-003** — Помогать выбрать подходящий формат работы на основе запроса. — принято; копия «подбираю подходящие варианты» вместо отвергнутой «лучшие варианты».
- [x] **DET-004** — Отвечать о купонах, пакетах сообщений и сроках их действия. — принято нейтральными примерами.
- [x] **DET-005** — Записывать к экспертам через Planerka. — принято; «ии-Тоня записывает к экспертам через Planerka.» проходит guard.
- [x] **DET-006** — Собирать обратную связь после визитов только по желанию клиента. — применено на уровне копии («обратную связь только по желанию» принимается, обещание давления/рассылки отклоняется). Поведенческое исполнение относится к TASK-EXP-002/TASK-EXP-003.
- [x] **DET-007** — Вести историю состояний и отражать изменения только по запросу клиента. — применено на уровне копии; поведенческая часть — TASK-EXP-003.
- [x] **DET-008** — Справочно сообщать о новых экспертах и мероприятиях словами «в базе появился» и «доступны слоты». — зафиксировано принятым примером; имевшееся в лендинге «ии-Тоня рекомендует вас/тебя клиентам» переписано на «показывает», потому что форма «рекоменду*» входит в запрещённый список.

## Шаги

- [x] Сверить landingContent и шаблоны клиентских ответов с закреплённым именем и разрешёнными темами.
- [x] Внести проверку запрещённых слов, диагнозов, лечения, давления, перебивания и спама в prompt-safety.
- [x] Подключить отклонение до отправки клиентского текста и добавить нейтральные допустимые примеры.

## Критерии приёмки

- [x] Имя в публичной и клиентской копии выводится только как «ии-Тоня».
- [x] Все слова: «лучший», «топ», «хит», «скидка», «выгода», «экономия», «успей», «специально для вас», «рекомендуем», «запишитесь сейчас» отклоняются.
- [x] Текст с диагнозом, лечением, давлением, перебиванием или спамом не проходит guard.
- [x] Нейтральная справка о тарифах, экспертах, пакетах, купонах, записи и отзывах проходит guard.

## Команды проверки

```bash
pnpm vitest run apps/web/src/content.test.ts packages/application/src/prompt-safety.test.ts
```

## Evidence и завершение

- [x] Сохранить результаты проверок и связь с пунктами исходника.
- [x] Закрыть связанные DEC/Q или явно оставить задачу blocked. — Связанных DEC/Q нет (`decision_ids: []`, `open_question_ids: []`).
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.

### Что реализовано

- `packages/domain/src/safety.ts`: `guardClientCopy`, таблица `CLIENT_COPY_PROHIBITED_RULES` (15 правил, 5 кодов отказа), `CLIENT_ASSISTANT_NAME`, правило канонического имени с разрешёнными падежными формами («ии-Тоня», «ии-Тоне», «ии-Тоню», «ии-Тоней», «ии-Тони»). Экспорт — `packages/domain/src/index.ts`.
- `packages/application/src/conversation-service.ts`: guard подключён в ветке `kind === "answer"` до формирования `selarti.send`; коды guard'а добавлены в `IntentRejectionReason`. Экспертский путь (`validateExpertIntentProposal`) не затронут. Отказ рождает `human_handoff` с тем же `reasonCode` — поведение fail-closed, новых обращений в БД не появляется (`reason_code` в миграциях — `text` без CHECK по значениям, миграция не требуется).
- `packages/application/src/selarti-response-service.ts`: тот же `guardClientCopy` стоит в `decodeProviderTextProposal` до `proposals.accept` (ошибка `selarti_response_copy_prohibited` → `rejected`, репозиторий не мутируется). Это второй путь клиентского текста: webhook `POST /v1/webhooks/selarti/responses` → outbox `telegram.send_text.v1`.
- `apps/web/src/content.ts`: три нарушения исходной копии переписаны — «подбираю ~~лучшие~~ → подходящие варианты», «ии-Тоня ~~рекомендует~~ → показывает вас/тебя клиентам» (`expertSteps[1]`, `faq[12]`). Дайджест FAQ в `content.test.ts` перепоставлен на `905e710c596a95446b1dd6866e1be3719add17f1f5f58a41e462838d53a7a38e` (менялся только этот ответ).
- Публичный бренд в `landing-view.ts` и `legal-view.ts`: видимый текст `<span>ии-</span>Тоня`, `gap: 0` у `.brand`. Рендер больше не даёт DOM-текст «ииТоня».

### Решения по толкованию (проверяющие могут оспорить)

1. Отрицание сохраняется для классовых запретов (диагноз/лечение/давление/перебивание и спам), если в той же клаузе есть явное отрицание: `не|без|никак|никогда|нельзя|нет` в двух токенах перед совпадением или `не|нет` в четырёх токенах после. Это покрывает и препозицию («Не назначает лечение», «Я не ставлю диагнозы»), и инверсию («Диагнозы не ставим», «Давления с моей стороны нет»). Отрицание внутри самого совпадения не освобождает: иначе «Без вашего запроса пришлю…» и «пока цены не выросли» проходили бы как дисклеймер. Маркетинговый список по-прежнему без exemption.
2. Список из десяти слов отсекается безусловно, без exemption, как и требует критерий «Все слова … отклоняются».
3. «рекомендации» (существительное) не запрещено: в списке стоит глагольная форма «рекомендуем», а в лендинге остаётся карточка «Адресные рекомендации по запросу клиента». Если владелец имел в виду всё семейство слова — расширить правило одним элементом таблицы.
4. Правила строятся на `\p{L}`/lookaround, а не на `\b`/`\w`: в JavaScript `\b` и `\w` ASCII-ориентированы и на кириллице не работают (в частности, `\b` не срабатывает после «ь»), поэтому `\w*`/`\b` в русских паттернах молча ломали бы покрытие. Анти-кейсы закреплены тестами: «Фототерапия», «Архитектор», «Топливо», «Затопить подвал», «Экономический эффект», «не тонул».

### Отклонения от карточки

- Шаг 3 («подключить отклонение до отправки») невыполним в двух объявленных файлах: точки отправки — `packages/application/src/conversation-service.ts` и `packages/application/src/selarti-response-service.ts`, оба добавлены в «Изменить» и в `backlog.json`.
- `apps/web` намеренно не получает зависимостей (в `apps/web/package.json` нет ни одной, и `pnpm install --frozen-lockfile` после её добавления перестал бы совпадать с `pnpm-lock.yaml`). Поэтому проверка публичной копии через доменный guard вынесена в репозиторный тест `tests/repo/client-copy-guard.test.ts` с относительными импортами — тот же приём, что уже применяется в `tests/repo` (пакеты — `tests/repo/booking-repository-guards.test.ts`, приложения — `tests/repo/sandbox-production-isolation.test.ts`). Тест дополнительно сверяет видимый HTML бренда (`<span>ии-</span>Тоня`) у лендинга и юридических страниц.

### Прогон проверок (claw, 2026-09-16; после закрытия Critical review)

| Проверка | Результат |
|---|---|
| `vitest run packages/application/src/prompt-safety.test.ts` | 121 passed |
| `vitest run packages/application/src/selarti-response-service.test.ts` | 17 passed |
| `vitest run tests/repo/client-copy-guard.test.ts apps/web/src/content.test.ts apps/web/src/landing-view.test.ts apps/web/src/legal-view.test.ts` | 35 passed |
| `vitest run packages/application/src/conversation-service.test.ts` (сопредельный регресс) | 66 passed |
| `vitest run packages/domain` | 67 passed |
| `tsc --noEmit -p tsconfig.tests.json` и `-p apps/web` | exit 0 |
| `eslint` по изменённым `.ts` | exit 0 |
| `git diff --check` | exit 0 |

Независимый review нашёл два Critical (бренд в рендере без дефиса; provider ingress без guard) и ряд Warning. Закрыты оба Critical и Warning: окно отрицания, регистр «Ии-Тоня», суффиксы/латиница имени вне URL/email, soft hyphen/ZWSP, экспорт без `RegExp`, словоформы «успеем/успеть», «топовейший», «скидочками», «запишется/записывайтесь сейчас», «забронируйте … сегодня», «осталось N мест», «лечим», «лекарство». Не трогались омографы («лyчшие») и «диагностика» как сервисный термин лендинга.
