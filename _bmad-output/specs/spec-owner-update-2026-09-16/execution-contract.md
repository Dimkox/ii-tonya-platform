# Контракт исполнения на claw

## Среда

- SSH: `pall@192.168.0.229`; секрет аутентификации не хранится в артефактах.
- Основная копия: `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform`.
- Рабочий каталог этой поставки: `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/owner-spec-2026-09-16`.
- Ветка: `codex/owner-spec-2026-09-16`, исходный SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d`.
- Node 24, pnpm 11.9.0. Перед реализацией выполнить `pwsh -File scripts/check-development-environment.ps1`; для PostgreSQL/контейнерной проверки добавить `-RequireDocker`.
- Установка зависимостей только `pnpm install --frozen-lockfile`; SQL миграции вручную + journal. Не запускать `drizzle-kit generate`.

## Порядок работы

1. Прочитать AGENTS.md, SPEC.md, companions и карточку выбранной задачи.
2. Проверить Git identity, исходные файлы, зависимости и связанные DEC/Q. Задача `planned` не исполнена.
3. Владелец закрывает бизнес/правовые альтернативы в decision register через memlog. Исполнитель документирует технические уточнения в пределах действующего контракта.
4. Для изменения поведения: добавить предметный RED-тест из критериев карточки; проверить отказ; внести минимальную реализацию; выполнить focused GREEN, typecheck/lint по изменённым пакетам и `git diff --check`.
5. Для контента/дизайна: создать перечисленные материалы и провести визуальную/редакционную проверку указанных размеров, вариантов и текста. Автоматический unit-тест не заменяет просмотр.
6. Обновить traceability и evidence, пройти независимый review. Функция может быть закончена в коде и оставаться выключенной для live; эти статусы фиксируются отдельно.

## Проверки

Не запускать full suite или multi-path Vitest более одного раза за задачу; focused PostgreSQL/concurrency-файл — максимум три запуска. Full `pnpm verify` — только завершение ветки или явный запрос. Test commands в карточках — будущие проверки; они не были выполнены при подготовке этого backlog.

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
git diff --check
```

## Границы

PostgreSQL сохраняет финансовую/идемпотентную authority; Make/Sheets/промпты не получают права менять баланс или подтверждать платёж. Включение Telegram/Selarti/Planerka/YooKassa — отдельная операция после контрактов и evidence. Production — native systemd/PostgreSQL/nginx; Claw и Docker — тестовый контур. Задачи в этой поставке не дают команды на deploy, публикацию, удаление данных, рассылку или ротацию внешних секретов.
