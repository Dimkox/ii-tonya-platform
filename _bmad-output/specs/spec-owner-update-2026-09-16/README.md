# ии-Тоня — требования и задачи владельца

Подготовлено 16 сентября 2026. База `18af66fef61c33d21216c3b24f935cb1fe3d7b2d`. Только документация и планирование; новые функции не реализованы.

## Результат

- 5 предоставленных файлов: 01–04 идентичны, 05 полностью повторяет оферту внутри них.
- 319 исходных групп утверждений; 194 канонических пунктов в 49 тематических группах.
- 186 подробных подпунктов: полные поля анкет, словари, палитры, форматы и точные формулировки — [каталог деталей](source-details.md).
- 84 карточек задач, включая 34 задач принятия решений; 39 реестровых решений и 208 подробных вопросов.
- Все 4791 непустых строк двух снимков имеют классификацию и трассировку.

## Читать по порядку

1. [SPEC.md](SPEC.md) — границы и назначение.
2. [Решения владельца](decision-register.md) — несовместимые варианты.
3. [План и очередь задач](../../../docs/superpowers/plans/2026-09-16-owner-requirements-backlog.md) — карточки и зависимости.
4. [Пункты требований](requirements.md) — каждый пункт и его приёмка.
5. [Реестр исходников](source-register.md), [дубли](duplicates.md), [вопросы](open-questions.md).
6. [Сверка с кодом](brownfield.md), [контракт исполнения на claw](execution-contract.md).

## Машинные файлы

`requirements.json`, `backlog.json`, `source-claims.json`, `source-line-map.json`, `open-questions.json` и `code-baseline.json` содержат те же данные для исполнителей. `.memlog.md` — канонический журнал bmad-spec; SPEC и companions выводятся из него и ссылок на источники. Файл stories.yaml не создавался: это backlog задач, а не непрошедшие человеческие checkpoints BMad Story Breakdown.

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```

## На claw

`/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/owner-spec-2026-09-16`
Ветка `codex/owner-spec-2026-09-16`.

Снимки скрывают восемь строк доступов; оригинальные файлы в Downloads не изменены. Два ранее существовавших untracked bundle в основной копии не затрагивались.
