---
title: "Expert referral code lifecycle (DEC-FIN-014 / DEC-FIN-022)"
type: "policy"
created: "2026-09-17"
status: "pending_review"
task: "TASK-FIN-015"
live_activation: false
---

# Lifecycle экспертского referral-кода

DEC-FIN-014 **①**: код **создаётся при регистрации**, **виден после первой успешной оплаты**. *Фактическая реализация сегодня: коды чеканятся админским батчем (`expert_referral.batch_generate`, two-person approval), а не при регистрации резидента, и колонки видимости нет — см. таблицу и `TASK-FIN-031`.* DEC-FIN-022 **①**: материалы коллегам — после той же оплаты.

## Namespace

Отдельные таблицы/ledger от клиентского `promo_XXXX`. Экспертский код нельзя применить как клиентский купон (существующий split expert vs client referral).

Формат остаётся действующим expert-referral namespace репозитория (не смешивать с `promo_`). Новый литерал имени не вводится этим документом.

## Состояния

| Поле | Правило |
|---|---|
| `issuedAt` (реализовано) | insert при генерации батча кодов, до оплаты резидента |
| `visibleAt` (**не реализовано**) | задуман как отметка первой successful payment по residency order; такой колонки в схеме нет: `expert_referral_codes` = `id, batchId, inviterExpertId, codeHash, keyVersion, maskedSuffix, status(issued/redeemed/revoked), issuedAt, redeemedAt, revokedAt, revokedApprovalId, revokedAdminSessionIdHash, createdAt` (`packages/db/src/schema/expert-residency.ts:218-242`); `visible_at`/`visibleAt` — 0 совпадений в `packages/` и `apps/` — проверено 2026-09-21 по коду этого чекаута → `TASK-FIN-031` |
| eligibility | display/API кода и промоматериалов — только после подтверждения первой успешной оплаты и пока код не revoked; **сегодня гейт кодом не обеспечен** (нет `visibleAt`) |
| revocation | audited `expert_referral.code_revoke`; после revoke не показывать и не начислять новые grants |

До оплаты можно спросить «есть ли коллеги»; полные материалы, промокоды и инструкции регистрации — только после `visibleAt`.

Ограничение «один резидент — один активный код» **схемой не обеспечено**: единственные unique-индексы `expert_referral_codes` — `(code_hash)` и тривиальный `(id, inviter_expert_id)` (`expert-residency.ts:244-247`), поэтому батч может выпустить N кодов `issued` на одного `inviter_expert_id` → `TASK-FIN-031`. **Коллизия с клиентским namespace не «запрещена схемой»:** клиентских таблиц купонов/промо в схеме нет вообще (`grep pgTable packages/db/src/schema/*.ts` по `coupon|promo` — пусто — проверено 2026-09-21 по коду этого чекаута), `promo_XXXX` существует только как утверждение источника (`source-claims.json`) — разделение держится отсутствием клиентской половины, а не ограничением. Расход однократный: `expert_referrals_code_unique` на `code_id` (`expert-residency.ts:301`) плюс CHECK `status='redeemed' ⇒ redeemed_at not null`; семантика «многоразового кода» из REQ-FIN-014.02 **владельцем не решена** → `TASK-FIN-031`.

### Сверка с кодом (2026-09-21, независимый review)

Документ описывал целевой lifecycle как существующий. Измерено в этом чекауте: у `expert_referral_codes`
нет ни `visibleAt`, ни ограничения «один активный код на резидента»; коды чеканятся батчем по
админ-консольному two-person пути, а не при регистрации резидента; клиентской coupon-таблицы, о коллизии
с которой шла речь, в схеме нет. Формулировки выше исправлены по замерам; реализация целевого
поведения — `TASK-FIN-031`.
