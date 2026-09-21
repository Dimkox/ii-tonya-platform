# TASK-PLT-025: Журналы: перестать писать URI и текст ошибки, вернуть безопасную диагностику (TRACK-05, T29)

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Санитизация URI/query и текста исключения в `msg`; тест, что телефон, почта и `botKey` не проходят в лог.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md). Источник требования — ТЗ по ПД от 2026-09-21 (`docs/spec/consent-pd-tz-2026-09-21.md`), TRACK-05 и приёмка T29.

**Tech Stack:** TypeScript, pino, Fastify 5, nginx.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Зависимости: нет. Решения: нет.

## Что уже есть

Замерено 2026-09-21: в `msg` попадает сырой путь с query (404 Fastify: `Route GET:/nope?email=…&code=EXPE-RT-12345 not found`) и текст 5xx-исключения; правила для URI/query в `packages/observability/src/logger.ts` нет (греп по uri|query|referrer пуст). Обратная сторона: в access-строке нет ни method, ни statusCode, ни шаблона маршрута, ни remote address. `botKey` — сегмент пути webhook-а, а `deploy/nginx/ii-tonya` не задаёт `access_log`/`log_format` (grep пуст) ⇒ секрет уходит в журнал nginx. Обработчиков `unhandledRejection`/`uncaughtException` нет; воркер не импортирует логгер.

## Файлы

**Прочитать:**

- [logger.ts](../../../../packages/observability/src/logger.ts)
- [app.ts](../../../../apps/api/src/app.ts)
- [ii-tonya](../../../../deploy/nginx/ii-tonya)
- [main.ts](../../../../apps/worker/src/main.ts)
- [outbox-runner.ts](../../../../packages/worker/src/outbox-runner.ts)


**Изменить:**

- [logger.ts](../../../../packages/observability/src/logger.ts)
- [app.ts](../../../../apps/api/src/app.ts)
- [ii-tonya](../../../../deploy/nginx/ii-tonya)


**Создать:**

- [log-hygiene.test.ts](../../../../tests/repo/log-hygiene.test.ts)


**Проверки:**

- [log-hygiene.test.ts](../../../../tests/repo/log-hygiene.test.ts)


## Пункты задачи

- [ ] Санитизация URI/query и текста исключения в `msg`; тест, что телефон, почта и `botKey` не проходят в лог.
- [ ] Явная allow-list запись завершения запроса (метод, шаблон маршрута, код статуса, длительность, корреляция) — безопасность и диагностика одновременно.
- [ ] `log_format`/`access_log` в nginx с шаблоном маршрута вместо сырого URI; `botKey` — из пути в заголовок или в шаблон.
- [ ] Перехват unhandled-исключений через санитизатор и структурированные reason-code строки в воркере.


## Шаги

- [ ] Собрать пакет observability перед проверкой (dist устарел — D20), иначе тесты врут.
- [ ] Не ослаблять существующие sensitiveKey-якоря ради «меньше шуметь» (риск перестать резать реальные message/url/body).
- [ ] Не подменять продуктовое решение: `botKey` в пути убирается только вместе с совместимым контрактом webhook (нужен прогон на синтетике).


## Критерии приёмки

- [ ] T29: тест с заведомо «грязным» URL/телом даёт [REDACTED] и при этом сохраняет метод, шаблон маршрута и статус.
- [ ] В тестовом выводе нет ни одного совпадения с телефон/почта/botKey-формой.
- [ ] Контроль переворота: при отключении правила тест краснеет.


## Команды проверки

```bash
pnpm exec vitest run tests/repo/log-hygiene.test.ts packages/observability
pnpm --filter @ii-tonya/observability build
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация не объявляется.
- [ ] Пакет observability пересобран до прогонов (иначе зелёный результат не относится к исходникам).
