---
title: "Production cutover status"
date: "2026-09-17"
release_status: "NO-GO"
---

# Автоматический прогон до продакшена — стоп-линия

Владелец: «все автоматом делай до продакшена». Ниже — что закрыто в репозитории
и что **нельзя** включить без людей/секретов/хоста.

## Сделано в этой поставке (software)

- DEC-FIN-009, DEC-EXP-005, DEC-EXP-006 приняты консервативно (no-change / текущий код).
- 39/39 реестровых DEC закрыты.
- Контракты когорт и партнёров:
  `fin-client-access-policy.md`,
  `fin-client-package-policy.md` (цены TBD),
  `fin-expert-pricing-policy.md`,
  `fin-center-policy.md`,
  `fin-organizer-policy.md`,
  `fin-group-event-settlement.md`,
  `fin-expert-code-lifecycle.md`.
- PLT-008 substrate + expert_handoff read-path уже на `main` (#97).
- Все `*_ENABLED` на **продакшене** остаются `false` (`PAYMENTS_ENABLED=false`).
  Локальный `.env` на Claw не копировался в `/etc/ii-tonya/runtime.env`.

## Не исполняется автоматически (go-live)

Из `docs/runbooks/go-live-evidence.md`, статус **NO-GO**:

| Gate                                                    | Почему агент не закрывает                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Подпись native bundle                                   | **PASS** 2026-09-17 для `origin/main` `cb07bd18`: `docs/test-evidence/releases/cb07bd1821d8106b0b0088b17bcf305662a1b792/artifacts.md`. Не задеплоен                                                                                   |
| Claw CI `cb07bd18`                                      | **FAIL gitleaks**; build/lint/typecheck/coverage PASS. Allowlist committed on this branch; cannot green the signed SHA without a new commit                                                                                           |
| Claw Database Gate `cb07bd18`                           | **PASS** 2026-09-18: `docs/test-evidence/claw/cb07bd1821d8106b0b0088b17bcf305662a1b792/database.md`                                                                                                                                   |
| Native smoke `cb07bd18`                                 | **PASS** 2026-09-18: `docs/test-evidence/releases/cb07bd1821d8106b0b0088b17bcf305662a1b792/native-smoke.md` (Claw `ii_tonya_native_smoke` only)                                                                                       |
| Transfer + runtime.env + migration preflight `cb07bd18` | **PASS** read-only 2026-09-18: `docs/test-evidence/production/cb07bd18-preflight-2026-09-18.md`. Incoming на хосте; `current` не переключён. Approve SHA still `7498ce65`. Restore drill не делался                                   |
| YooKassa test-shop / fiscal / registry                  | BLOCKED; пустые креды должны остаться пустыми                                                                                                                                                                                         |
| Provider staging (Planerka/Selarti)                     | default-off, нет RF-доказательства региона                                                                                                                                                                                            |
| Clinical safety directory + outage drill                | DEC-EXP-006 = не выдумывать клинический ритм                                                                                                                                                                                          |
| Retention/legal approval                                | **PASS** 2026-09-17: `docs/legal/owner-update-legal-review.md`; владелец подтвердил уведомление РКН (ст. 22 152-ФЗ); номер реестра не передавался                                                                                     |
| Manual production environment approval                  | человек                                                                                                                                                                                                                               |
| Смена `/opt/ii-tonya-platform/current`                  | **DONE** 2026-09-18: `current` → `cb07bd18`; previous `7498ce65`. Evidence `docs/test-evidence/production/cb07bd18-deploy-2026-09-18.md`                                                                                              |
| Rollback drill                                          | **PASS rehearsal** 2026-09-17: `docs/test-evidence/rollback-drill-2026-09-17.md`. Host SSH **PASS** 2026-09-17: `docs/test-evidence/production/host-identity-2026-09-17.md`. Live `deploy-native-remote.sh rollback` **not executed** |

Текущий native runtime на хосте: `cb07bd1821d8106b0b0088b17bcf305662a1b792`
(`current` = `origin/main` at sign time). Previous:
`7498ce656e1e49fe2d92c83f02d9667eb3f86b9b`. `233f3cf7` still on disk.
Production `PAYMENTS_ENABLED=false`.

## Цены клиентских пакетов

Владелец 2026-09-17: Старт **4999**, Базовый **5999**, Глубокий **7999**,
Максимальный **10990** ₽. Купонный грант = ×2 цены (DEC-FIN-003). Каталог:
`docs/superpowers/implementation-artifacts/fin-client-package-policy.md`.
Код SKU/миграция — TASK-FIN-021.

## Следующий автоматический код (после merge этой ветки)

Не live: закрытие review FIN-001/007/012–015; затем design FIN-005/008/016/018/020
по принятым DEC; код FIN-021 только после цен.
