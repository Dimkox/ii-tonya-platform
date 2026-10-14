# TASK-PLT-024: Убрать предсогласиевую аналитику из публичной оболочки (TRACK-01/02/03)

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Публичная оболочка не создаёт сторонних запросов до выбора пользователя (TRACK-01, T27).

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md). Источник требования — полный ТЗ по ПД от 2026-09-21 (`docs/spec/consent-pd-tz-2026-09-21.md`), TRACK-01/02/03.

**Tech Stack:** TypeScript, Vite-оболочка `apps/web`, статический HTML.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `implemented_pending_review`; readiness: `ready`.
- Тип: implementation; исполнитель: frontend; приоритет: P0.
- Зависимости: нет. Решения: нет (требование внешнего документа, не DEC-карты этого пакета).
- Носитель: ТЗ по ПД, `TRACK-01` (запрет немедленной загрузки Метрики, включая `noscript`-пиксель) и приёмка `T27`.
- Статус live: nothing deployed; задеплоенная копия прода счётчика не содержит (замер `curl --noproxy '*'` 2026-09-21).

## Что уже есть

TRACK-01 исполнен на ветке 2026-09-21: из `apps/web/index.html` удалён inline-блок Я.Метрики (wc счётчик 111827123, webvisor:true, clickmap:true, ecommerce, trackLinks) и `noscript`-пиксель `mc.yandex.ru/watch/...`; текст-подсказка про JavaScript сохранена. Тесты ранее **закрепляли** нарушение (`index-shell.test.ts` исполнял inline-скрипт в vm и сверял опции; `test-expert-trial-traceability.test.ts` требовал наличия счётчика) — переписаны в негативные (5 и 1 проверок). Контроль переворота: с возвращённой Метрикой падают 6 тестов, без неё — 8 зелёные. Замер прода: `curl --noproxy '*' https://ii-tonya.ru/` отдаёт статический HTML 1604 байта (Last-Modified 27.08.2026) **без** счётчика, то есть задеплоенная копия нарушения не содержала; дефект жил в исходниках лендинга и в локальной сборке `apps/web/dist` (артефакт, не в git).

## Файлы

**Прочитать:**

- [index.html](../../../../apps/web/index.html)
- [index-shell.test.ts](../../../../apps/web/src/index-shell.test.ts)
- [main.ts](../../../../apps/web/src/main.ts)
- [ii-tonya](../../../../deploy/nginx/ii-tonya)
- [policy.txt](../../../../apps/web/src/legal/policy.txt)


**Изменить:**

- [index.html](../../../../apps/web/index.html)
- [index-shell.test.ts](../../../../apps/web/src/index-shell.test.ts)
- [test-expert-trial-traceability.test.ts](../../../../tests/repo/test-expert-trial-traceability.test.ts)


**Создать:**

Нет.


**Проверки:**

- [index-shell.test.ts](../../../../apps/web/src/index-shell.test.ts)


## Пункты задачи

- [ ] Публичная оболочка не создаёт сторонних запросов до выбора пользователя (TRACK-01, T27).
- [ ] Негативные CI-проверки оболочки: ни inline-скриптов, ни сторонних хостов, ни запроса в noscript-ветке.
- [ ] Остаток объёма: TRACK-02 (запрет Webvisor на экранах с ПД — требуется экран согласия), TRACK-03 (чистый bootstrap приватной части — требует решения владельца о наличии web-кабинета), CSP в nginx (защетный барьер), файл подтверждения владения `apps/web/public/yandex_bece38d2993630d3.html` (нужно слово владельца: оставлять ли верификацию аккаунта Яндекса).


## Шаги

- [ ] Держать аналитику полностью выключенной, пока нет утверждённого выбора `cookies_analytics` и записи в реестре обработчиков.
- [ ] Любое будущее включение — только динамически загружаемым модулем после серверного `granted`, никогда inline в оболочке.
- [ ] Не объявлять TRACK-02/T28 выполненными, пока в web нет приватного экрана: проверять нечего (замер: в `apps/web/src/main.ts` только `/`, `/oferta`, `/privacy`; роутера и кабинета нет).


## Критерии приёмки

- [ ] `index.html` не содержит ни одного стороннего URL и ни одного inline-<script> (тест).
- [ ] noscript-ветка не содержит <img|<script|url( (тест).
- [ ] Возврат счётчика или любого тег-менеджера делает CI красным (проверено переворотом).


## Команды проверки

```bash
pnpm exec vitest run apps/web/src/index-shell.test.ts tests/repo/test-expert-trial-traceability.test.ts
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [x] Метрика и `noscript`-пиксель удалены из `apps/web/index.html` (замер: 0 совпадений `mc.yandex`).
- [x] Негативные тесты переписаны; контроль переворота: 6 падений при возврате счётчика, 8 зелёных без него.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
- [ ] TRACK-02/T28 и TRACK-03 — только после решения владельца о приватном web-экране и о самом наличии аналитики.
- [ ] Файл подтверждения владения `apps/web/public/yandex_bece38d2993630d3.html` — судьба за владельцем.
