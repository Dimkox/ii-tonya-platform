# Гейты go-live и их статус

Источник: [`docs/runbooks/go-live-evidence.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/go-live-evidence.md) (последняя правка 14.08.2026).
Распределение по состоянию: 10 × BLOCKED, 4 × PASS, 1 × PENDING.

| Gate                                                               | Evidence URI/checksum                                                          | Date         | Owner            | Reviewer           | Status               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------ | ---------------- | ------------------ | -------------------- |
| Frozen install, build, lint, typecheck, tests, production audit    | `docs/test-evidence/claw/87e49af2822dfcea96084dafc2708b29c08615a7/ci.md`       | 2026-08-13   | Engineering      | unassigned         | PASS at recorded SHA |
| Direct Claw Database Gate                                          | `docs/test-evidence/claw/a0ee5f6f5b347c64ab185e5ed871ce46381061c9/database.md` | 2026-08-13   | Platform         | unassigned         | PASS at recorded SHA |
| Native API/worker bundle, SBOM, provenance, import smoke           | `docs/test-evidence/claw/887c462065bc8d4f480b5474135638a5bc063b8c/release.md`  | 2026-08-13   | Platform         | unassigned         | PASS at recorded SHA |
| Native API readiness and worker heartbeat against one Claw DB      | same release record                                                            | 2026-08-13   | Platform         | unassigned         | PASS at recorded SHA |
| Signed immutable native bundle                                     | unavailable                                                                    | not executed | Release          | unassigned         | blocked              |
| PostgreSQL migration preflight and restore drill                   | unavailable                                                                    | not executed | Platform         | unassigned         | blocked              |
| Daily and release reconciliation                                   | unavailable                                                                    | not executed | Operations       | unassigned         | pending              |
| Retention/legal/minor-data approval                                | unavailable                                                                    | not executed | Privacy          | unassigned         | blocked              |
| Clinical safety directory and outage drill                         | unavailable                                                                    | not executed | Clinical safety  | unassigned         | blocked              |
| Provider-connected staging record                                  | `docs/runbooks/provider-staging-evidence.md`                                   | not executed | Integrations     | unassigned         | blocked              |
| YooKassa test-shop, legal/fiscal, registry and activation approval | `docs/runbooks/yookassa-provider.md`                                           | not executed | Payments/Legal   | unassigned         | blocked              |
| Rollback drill using prior immutable release directory             | unavailable                                                                    | not executed | Incident command | unassigned         | blocked              |
| Manual production environment approval                             | unavailable                                                                    | not executed | Release          | unassigned         | blocked              |
| Sandbox payment container lifecycle (`SBX-TST-009`)                | `docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md`    | not executed | Platform         | independent review | blocked: no image    |
| Sandbox/native-production closure inventory and security scan      | same record                                                                    | not executed | Security/Release | unassigned         | blocked              |

## Почему правка документации не открывает релиз

`release.yml` (лежит в ветках, с main удалён 14.08) в джобе `evidence_gate` вычитает ровно строки
`Release status: GO` и `Provider staging status: PASS`. При этом
[`tests/repo/release-assets.test.ts`](https://github.com/Dimkox/ii-tonya-platform/blob/main/tests/repo/release-assets.test.ts) содержит утверждение
`expect(providerEvidence).not.toContain("Provider staging status: PASS")`. То есть попытка «поставить
галочку» ломает текстовый тест.

## Неотказуемые условия

[`docs/security/threat-model-and-go-live-gates.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/security/threat-model-and-go-live-gates.md) §17 «Non-waivable NO-GO conditions»:
безопасность человека, защита данных и отсутствие независимого ревьюера блокируют релиз независимо от
того, насколько зелёные локальные проверки.

## Требования по провайдерам

[`docs/contracts/provider-activation.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/provider-activation.md) — поля доказательств на каждого провайдера, все три
записи имеют статус `NO-GO`. Открытые блокировки: YooKassa [https://github.com/Dimkox/ii-tonya-platform/issues/55](https://github.com/Dimkox/ii-tonya-platform/issues/55),
Telegram [https://github.com/Dimkox/ii-tonya-platform/issues/56](https://github.com/Dimkox/ii-tonya-platform/issues/56), Selarti [https://github.com/Dimkox/ii-tonya-platform/issues/57](https://github.com/Dimkox/ii-tonya-platform/issues/57),
privacy/minor-data [https://github.com/Dimkox/ii-tonya-platform/issues/61](https://github.com/Dimkox/ii-tonya-platform/issues/61).

← [Home](Home.md) · [Верификация](Verification-Claw.md)
