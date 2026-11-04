# SCRUM-504 — аудит зависимостей (03.11.2026)

Команды: `pnpm audit --json` (все зависимости), `pnpm audit --prod` (runtime).
Node 24, pnpm 11.9.0, lockfile закреплён (`--frozen-lockfile`).

## Итог

| Область            | Advisories | Результат                  |
| ------------------ | ---------- | -------------------------- |
| Runtime (`--prod`) | 0          | Нет известных уязвимостей. |
| Dev/CI             | 2 moderate | Остаточный риск, см. ниже. |

Старые 54 строки отчёта (18 версий) закрыты ранее через `overrides` в
`pnpm-workspace.yaml` (fast-uri, grpc-js, brace-expansion, esbuild, js-yaml,
nanoid, source-map-js, undici, uuid). Эти overrides сохраняются.

## Остаточные риски (dev-only, не попадают в образ)

1. **minimatch** GHSA-g3hv-75wg-m249 (DoS через globparts).
   Версии 3.1.5, 5.1.9, 9.0.9, 10.2.5 — все последние в своих major.
   Исправление только в 11.0.1+; backport нет. Пути: eslint, vitest/glob,
   testcontainers. Вход — только шаблоны из конфигов репозитория (доверенные).
   Обновление 2026-11-04 (PR #149): override `minimatch@<11.0.1` → 11.0.4.
   Проверено: `pnpm lint`, `pnpm typecheck`, `tests/repo` проходят.
   Ранний прогноз «ломает eslint» не подтвердился.
2. **glob** 10.5.0 GHSA-3g3m-2fjr-6pw4 (обход AbortSignal).
   Путь: `@testcontainers/postgresql > testcontainers > archiver > glob`.
   Только тестовая инфраструктура, сигнал отмены не используется.
   Обновление 2026-11-04 (PR #149): override `glob@<14.0.2` → 14.0.3.
3. После overrides `scripts/getzilla_vulns.py --online`: PASS, 0 находок.

## Контроль

- `pnpm audit --prod` — должен давать «No known vulnerabilities found».
- Пересмотреть при выходе eslint/testcontainers на minimatch ≥ 11 / glob ≥ 14.0.2.
