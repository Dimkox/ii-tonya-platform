# All-tab requirements audit — 2026-10-12

Status: audit complete; implementation and final production release incomplete.

224 audit points overlap across areas; they are not a deduplicated backlog. Counts: missing77, code_only53, conflict58, uncertain21, locally_verified2, live_verified13. Live evidence covers static publication only, not end-to-end commerce. Historical source conflicts must be reconciled with accepted owner decisions before implementation.

Source: Google Doc `14AWYM9jbE0OPU3rKY6_PpPl3REDaqQbISdMB4D2mpUc`;25tabs, account tab credential-redacted. Private SQLite registry preserves sanitized text, structured bodies, hashes, images and these findings. It must never be served publicly.

## Client Telegram / AI / booking / packages / payment / customer account

### CLIENT-001: code_only

- Source tab: t.0
- Requirement: Canonical brand, informational nonclinical role, no diagnosis, coercion, advertising or promises; concise fact-based answers.
- Source excerpt: используй только это написание имени: ии-Тоня
- Code evidence: packages/domain/src/safety.ts:487; packages/application/src/conversation-service.ts:240
- Test references (not fresh execution): packages/application/src/prompt-safety.test.ts:282
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Deterministic copy guard exists; active AI composition and deployed prompt semantics not established. Guard is not proof of all semantic restrictions.

### CLIENT-002: uncertain

- Source tab: t.0
- Requirement: Exact client greeting and final v4.8 prompt deployed to Selarti.
- Source excerpt: Привет, я ии-Тоня. Помогу сориентироваться в сервисе
- Code evidence: packages/db/src/schema/conversation.ts:22; apps/api/src/server.ts:480
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Prompt version storage is not evidence that v4.8 is loaded into the live provider; no provider access performed.

### CLIENT-003: conflict

- Source tab: t.0
- Requirement: Gradual contextual profile: name, age, gender, birthday, children, profession, district, interests, family/social status, budget and expert preferences; never a bulk questionnaire.
- Source excerpt: собирает и сохраняет в карту клиента
- Code evidence: packages/db/src/schema/conversation.ts:15; packages/application/src/hybrid-message-gateway.ts:146
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Full profiling workflow not established; persistent sensitive profile conflicts with standing DEC-PLT-004 restrictions recorded in AGENT-STATUS. Do not implement inferred demographic or third-party storage from the old prompt.

### CLIENT-004: code_only

- Source tab: t.0
- Requirement: Support the six source categories and location-aware in-person Tambov/online expert discovery.
- Source excerpt: География: Тамбов (очно) или онлайн (все регионы)
- Code evidence: apps/web/src/content.ts:26; packages/application/src/catalog-service.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Displayed taxonomy exists; current search contract is service/language/date, not complete location-aware matching. Fresh inventory experts/services/slots all zero; empty initial state is valid and is not proof onboarding code is missing.

### CLIENT-005: missing

- Source tab: t.0
- Requirement: Rank by request keywords, verified expertise/reviews, location, topic, complexity, budget, gender preference and nearest appointment; present 2–3 factual expert cards.
- Source excerpt: Критерии подбора (в порядке приоритета)
- Code evidence: packages/application/src/catalog-service.ts:67; packages/application/src/catalog-service.ts:103
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Eligibility/filtering/grouping exists; full ordered personal ranking and factual price/review enrichment are not implemented in this contract.

### CLIENT-006: missing

- Source tab: t.0
- Requirement: Offer optional multi-direction programmes with database-backed format/prices; alternatives on dissatisfaction, without replacing an ongoing expert unless client requests it.
- Source excerpt: могут быть полезны несколько направлений
- Code evidence: packages/application/src/conversation-service.ts:736
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Intent proposals only yield answer/catalog/booking/handoff; no verified course ownership, programme or preference-feedback workflow.

### CLIENT-007: conflict

- Source tab: t.0
- Requirement: Client-owned state/progress history and on-request reflection.
- Source excerpt: Вести историю состояний клиента и отражать изменения
- Code evidence: packages/db/src/schema/conversation.ts:15; apps/web/src/content.ts:14
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Generic conversation storage is not structured progress history; sensitive persistent state must reconcile DEC-PLT-004 ephemeral-only restrictions.

### CLIENT-008: missing

- Source tab: t.0
- Requirement: New expert/service/event ingestion triggers metadata analysis, new check-in scripts and relevant opt-in announcements without spam or unsolicited pressure.
- Source excerpt: Анализирует базу клиентов на предмет релевантности
- Code evidence: packages/application/src/catalog-service.ts:67
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Read-only catalogue is present; no client relevance campaign/check-in generation pipeline established. Real inventory must be entered through authorized onboarding, never fabricated.

### CLIENT-009: missing

- Source tab: t.0
- Requirement: One permanent promo_XXXX client code; invitee +500 at registration, referrer +500 only after first payment, revoke referrer grant on refund.
- Source excerpt: Новому клиенту при вводе промокода — 500 купонов
- Code evidence: apps/web/src/content.ts:43
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Client coupon/referral persistence and settlement absent in searched packages/apps production TS. Expert referral implementation is a different product.

### CLIENT-010: missing

- Source tab: t.0
- Requirement: Grant coupons at 2x actual package cash value, one coupon unit equals RUB1, sum balances; partial service payment and remaining cash.
- Source excerpt: Купоны начисляются в размере х2 от суммы оплаты пакета
- Code evidence: packages/db/src/schema/billing.ts:41; apps/web/src/content.ts:43
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Message-package ledger exists, client coupon ledger/issuance absent. Later owner policy repeats x2, not fixed coupon amounts: fin-client-package-policy.md:17.

### CLIENT-011: uncertain

- Source tab: t.0
- Requirement: Coupon redemption only against an active booking, before expiry, without two coupons for one expert/service; warn no coupon refund on cancellation.
- Source excerpt: Нельзя использовать 2 купона на одного эксперта за одну услугу
- Code evidence: packages/application/src/booking-service.ts:22
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: No coupon redemption logic found. '1 coupon = 1 ruble' and 'cannot use 2 coupons' leave instrument-versus-unit meaning ambiguous; preserve constraint for clarification, do not invent cap.

### CLIENT-012: conflict

- Source tab: t.0
- Requirement: Original 90-day coupon lifetime, expiry enforcement and three-day expiry notice.
- Source excerpt: Срок действия купонов — 90 дней
- Code evidence: apps/web/src/content.ts:43
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Amended to 45 days in tabs18–21; no active coupon ledger or expiry/reminder job. Preserve historical grants rather than silently recalculate.

### CLIENT-013: missing

- Source tab: t.s01rqhytlm1
- Requirement: Amended new-coupon lifetime 45 days, FIFO by original accrual across packages; purchase_order or equivalent durable ordering.
- Source excerpt: Купоны (Coupons): Срок действия — **45 дней**
- Code evidence: apps/web/src/content.ts:43
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: 45-day copy only; no Client_Coupons model, purchase_order or FIFO spend transaction found. Expert bonus ledger cannot satisfy this.

### CLIENT-014: missing

- Source tab: t.0
- Requirement: Paid access to balances, closed events, new experts/slots and priority booking; higher tiers enable programmes/retreats/referral privileges.
- Source excerpt: Клиенты, оплатившие пакет сообщений, имеют доступ
- Code evidence: packages/application/src/client-commercial-policy.ts:1; packages/application/src/catalog-service.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Legacy/free cohort discrimination exists; tier entitlement and priority allocation workflow not established.

### CLIENT-015: code_only

- Source tab: t.0
- Requirement: Show and reserve only slots >=24h away, with requested date/time and online/in-person location.
- Source excerpt: Слот показывается клиенту только если ... минимум 24 часа
- Code evidence: packages/application/src/booking-service.ts:160; packages/application/src/catalog-service.ts:49; apps/worker/src/client-catalog-outbox.ts:88
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:104
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Local minimum-lead logic exists. Provider inventory/mapping and real booking creation remain unavailable.

### CLIENT-016: conflict

- Source tab: t.0
- Requirement: Original fixed 72h reserve, capacity increment and durable Reserved status.
- Source excerpt: Бронь автоматически резервируется на 72 часа
- Code evidence: packages/domain/src/reservation.ts:26; packages/db/src/repositories/booking-repository.ts:1094
- Test references (not fresh execution): packages/domain/src/reservation.test.ts:5; tests/integration/booking-concurrency.test.ts:23
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Implemented deadline is min(now+72h, slot start minus confirmation buffer), deliberately preventing a hold beyond a near appointment. Source's exact72h conflicts with >=24h slots; product text must reflect capped deadline.

### CLIENT-017: code_only

- Source tab: t.w117q321zxgc
- Requirement: Atomic deduplication, finite/unlimited capacity handling, no overbooking or duplicate active selection, active package admission.
- Source excerpt: Проверка дублей: нет ли активной брони/резерва
- Code evidence: packages/db/src/repositories/booking-repository.ts:1094; packages/db/src/repositories/booking-repository.ts:1267
- Test references (not fresh execution): tests/integration/booking-concurrency.test.ts:23; tests/integration/booking-concurrency.test.ts:178
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Transactions and capacity tests exist; unlimited-event interpretation and active-package admission across new session-based route not established. No live reserve acceptance.

### CLIENT-018: code_only

- Source tab: t.0
- Requirement: Expert confirm/cancel transitions update booking/capacity, send client result and meeting address/link; optional audio handled separately.
- Source excerpt: Эксперт подтверждает (через Telegram-бота)
- Code evidence: packages/application/src/booking-service.ts:205; packages/db/src/repositories/booking-repository.ts:1291; apps/api/src/server.ts:481
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:23
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Local callback/transition/outbox logic exists, production legacy callback composition rejects authorization; actual expert delivery/provider status synchronization not established.

### CLIENT-019: missing

- Source tab: t.0
- Requirement: Reschedule atomically cancels old slot and creates new reserve with correct capacity and notifications.
- Source excerpt: Эксперт переносит ... Создаётся новый резерв
- Code evidence: packages/application/src/booking-service.ts:241; packages/domain/src/reservation.ts:5
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Confirm/cancel/expire exist; no booking reschedule command found. Payment-recovery reschedule is unrelated.

### CLIENT-020: code_only

- Source tab: t.0
- Requirement: Hourly expiry claims overdue holds once, releases capacity and notifies client; provider status becomes cancelled.
- Source excerpt: Раз в час система проверяет резервы
- Code evidence: packages/worker/src/reservation-expiry.ts:34; packages/db/src/repositories/worker-jobs-repository.ts:1
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:132
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Expiry batch logic exists; hourly production scheduling plus external notification/provider cancellation not established.

### CLIENT-021: missing

- Source tab: t.0
- Requirement: Full events offer FIFO waitlist; cancellation/expiry promotes first eligible client into a fresh hold and notifies once, removes queue entry.
- Source excerpt: первый в листе ожидания получает резерв
- Code evidence: packages/application/src/booking-service.ts:148
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: No waitlist implementation found by whole packages/apps/tests TS search. Capacity rejection alone is not queue adoption.

### CLIENT-022: code_only

- Source tab: t.0
- Requirement: Owner-scoped chat/account cancellation releases capacity, synchronizes provider and informs client/expert; coupons nonrefundable.
- Source excerpt: Клиент может отменить запись через чат
- Code evidence: packages/application/src/booking-service.ts:193; packages/db/src/repositories/booking-repository.ts:964
- Test references (not fresh execution): tests/integration/booking-concurrency.test.ts:297
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Local owner cancellation exists and booking flag true; chat ingress/provider disabled, coupon handling absent, no authenticated live cancellation proof.

### CLIENT-023: missing

- Source tab: t.0
- Requirement: Appointment reminders at 48h,24h,1h plus confirmation, showing appropriate address/link.
- Source excerpt: За 2 дня ... За 1 день ... За 1 час
- Code evidence: packages/db/src/repositories/booking-repository.ts:1535
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Booking events/outbox do not establish timed reminders; no appointment-reminder scheduler found.

### CLIENT-024: missing

- Source tab: t.0
- Requirement: Optional 30-second advice during hold and first audio task after confirmation; combine explanation/link in one billed message.
- Source excerpt: аудиокаст (ссылка + пояснение в 1 сообщении)
- Code evidence: packages/application/src/conversation-service.ts:736
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: No audiocast selection/delivery workflow found; generic text answer support is insufficient.

### CLIENT-025: conflict

- Source tab: t.0
- Requirement: Original charge every incoming/outgoing, service/button/menu/audio/reminder/expired message; expert bot excluded.
- Source excerpt: Каждое сообщение в чате = −1
- Code evidence: packages/domain/src/billing.ts:17; packages/application/src/conversation-service.ts:600
- Test references (not fresh execution): packages/domain/src/billing.test.ts:14; packages/application/src/booking-service.test.ts:23
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Code deliberately makes system/safety/error classes free and supports free cohorts. Later tab19 makes deterministic FAQ free and only Selarti generation count; scope appears expert-specific, cannot silently apply to clients.

### CLIENT-026: code_only

- Source tab: t.0
- Requirement: Choose active positive-balance nearest-expiring package separately, preserve per-package expiry and prevent negative/double debit.
- Source excerpt: Списание всегда происходит из самого «горящего» пакета
- Code evidence: packages/domain/src/billing.ts:20; packages/domain/src/billing.ts:36; packages/db/src/repositories/message-repository.ts:922
- Test references (not fresh execution): packages/domain/src/billing.test.ts:22; packages/domain/src/billing.test.ts:31
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Implemented ordering also puts intro last. Existing ledger tests are static evidence only in this audit; live dialogue disabled.

### CLIENT-027: conflict

- Source tab: t.0
- Requirement: Original paid tiers500/1000/1500/2000, 60-day duration from payment; intro80–100 unlimited expiry.
- Source excerpt: Каждый пакет действует 60 дней с момента оплаты
- Code evidence: apps/web/src/content.ts:35; packages/db/src/repositories/admin-repository.ts:369; packages/db/src/schema/billing.ts:50
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Later tabs demand30d; accepted owner decision DEC-FIN-002 restores60d and intro100. Admin grants30d are distinct. Paid checkout excluded from published43a93e2; do not mistake admin grant or planned copy for paid settlement.

### CLIENT-028: conflict

- Source tab: t.s01rqhytlm1
- Requirement: Amended 30-day subscription in tabs18/19/20/21; update all relevant configuration/prompt/payment paths consistently.
- Source excerpt: Абонемент (Subscription): Срок действия — **30 дней**
- Code evidence: apps/web/src/content.ts:35; packages/db/src/repositories/admin-repository.ts:369
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Later repository owner decision fin-client-package-policy.md:16,32 explicitly retains paid client60 calendar days UTC+3. Resolve cohort/product scope; blanket30d change would violate accepted policy.

### CLIENT-029: missing

- Source tab: t.0
- Requirement: One deduplicated package-expiry reminder containing expiring package plus all other balances; no14d/7d notices, debit policy explicit.
- Source excerpt: Только за 3 дня ... Одно объединённое сообщение
- Code evidence: packages/db/src/repositories/client-account-packages-repository.ts:28
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Balance snapshot exists; reminder selection/claim/delivery job absent. Tab1's2–4day candidate window conflicts with literal exactly3day wording.

### CLIENT-030: code_only

- Source tab: t.0
- Requirement: Block ordinary conversation on no active balance, send bounded expiry notice, preserve safety access and new-purchase path.
- Source excerpt: Если все пакеты истекли или закончились
- Code evidence: packages/application/src/conversation-service.ts:530; packages/application/src/conversation-service.ts:631
- Test references (not fresh execution): packages/domain/src/billing.test.ts:31
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: No-package branch exists; safety stays free. Source charged final notice conflicts with free-class policy; purchase/renewal path not available.

### CLIENT-031: conflict

- Source tab: t.0
- Requirement: Emergency classification for self-harm/abuse/psychosis/panic/pain, appropriate actionable contacts and safe human handoff independent of balance.
- Source excerpt: Контакты 112, 8-800-2000-122
- Code evidence: packages/domain/src/safety.ts:24; packages/domain/src/safety.ts:68; packages/application/src/conversation-service.ts:568
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Code uses region/age/freshness-validated directory; E164 validation does not accept literal112/103. Source's grounding/clinical instructions conflict with nonclinical role; approved content/directory and live handling unverified.

### CLIENT-032: missing

- Source tab: t.0
- Requirement: Crisis refusal follow-ups at1h/3h/24h, quiet mode after48h silence; no pressure, preserve chat.
- Source excerpt: Через час, 3 часа, 24 часа — мягкие проверки
- Code evidence: packages/domain/src/safety.ts:119; packages/worker/src/safety-handoff.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Handoff lifecycle/SLA is not client check-in cadence or quiet-mode state machine.

### CLIENT-033: code_only

- Source tab: t.0
- Requirement: Optional next-day review, positive feedback retained; negative private/admin only; appointment tracking and optional1–2week follow-up.
- Source excerpt: На следующий день после приёма
- Code evidence: packages/application/src/feedback-service.ts:20; packages/db/src/repositories/feedback-repository.ts:61
- Test references (not fresh execution): tests/integration/feedback-transaction.test.ts:34
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Rating/hash + negative escalation transaction exists; scheduled solicitation, client entrypoint and delivered admin alert unverified. Raw review text is not retained by repository.

### CLIENT-034: missing

- Source tab: t.0
- Requirement: Post-visit3–4day proactive pause, respond when client initiates, then resume support.
- Source excerpt: 3–4 дня тишины
- Code evidence: packages/application/src/conversation-service.ts:561
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: No visit-driven pause scheduler found; source itself also requests next-day proactive review and daily check-ins.

### CLIENT-035: conflict

- Source tab: t.0
- Requirement: Daily weekday-specific micro-check-in: mood/win/body/insight/breathing/gratitude/plans, dependent on selected mode.
- Source excerpt: Каждый день ассистент присылает одно короткое сообщение
- Code evidence: apps/web/src/content.ts:14
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: No delivery cadence/mode implementation established; persistent sensitive answers and breathing advice need reconciliation with accepted ephemeral/nonclinical scope. MVP deferral is not full completion.

### CLIENT-036: missing

- Source tab: t.0
- Requirement: Unknown expert/event request collects optional link/contact, opens admin request and later notifies if expert is added.
- Source excerpt: я передам ваш запрос администратору
- Code evidence: packages/application/src/conversation-service.ts:715; packages/application/src/operator-case-service.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Generic human handoff/operator cases exist; missing-expert request, intake dedupe and addition notification workflow not established.

### CLIENT-037: conflict

- Source tab: t.w117q321zxgc
- Requirement: Authoritative client/package/event/reservation/expert storage and auditable event/message history; original six/eight Sheets projections.
- Source excerpt: messages_available = messages_total - messages_used
- Code evidence: packages/db/src/schema/billing.ts:1; packages/db/src/schema/conversation.ts:15; packages/db/src/repositories/booking-repository.ts:1535
- Test references (not fresh execution): tests/integration/feedback-transaction.test.ts:34
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Standing contract assigns finance/idempotency/PII authority to RF PostgreSQL. Sheets/Make must be off or deidentified projections; raw Dialogs export and Sheets mutation must not be implemented literally.

### CLIENT-038: missing

- Source tab: t.5nu61c58syud
- Requirement: All13 original workflows delivered end-to-end; deployment checklist must validate client→reservation→expert decision→logging, not just import scripts or switch ON.
- Source excerpt: 13_Apply_Coupons
- Code evidence: apps/api/src/server.ts:480; apps/worker/src/main.ts:365
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Pure logic/ports cover some workflows, not all13 live scenarios. Full release impossible with current disabled providers/reserve/payments; original14–19h estimate is not evidence.

### CLIENT-039: code_only

- Source tab: t.bz7qkf4jpoor
- Requirement: Authenticated Selarti incoming/outgoing event handling and idempotent message accounting, prompt integration and outgoing delivery.
- Source excerpt: Проверить, что при каждом сообщении клиента и ответе ИИ-Тони срабатывает списание
- Code evidence: packages/application/src/conversation-service.ts:561; packages/application/src/conversation-service.ts:769; apps/api/src/server.ts:480; packages/worker/src/selarti-request-dispatcher.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Ingress/dispatcher abstractions exist; native provider mapping/transport and live flags remain incomplete. Do not label interface existence as live wiring.

### CLIENT-040: locally_verified

- Source tab: t.5nu61c58syud
- Requirement: Planerka slot retrieval, booking creation/cancel/lookup and reliable mapping of Reserved/Booked/Cancelled to provider facts.
- Source excerpt: GET /events ... PUT /events/{event_id}/status
- Code evidence: packages/integrations/src/planerka/client.ts:25; packages/integrations/src/planerka/client.ts:59; packages/config/src/env.ts:52
- Test references (not fresh execution): packages/integrations/src/planerka/client.test.ts:1
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established. Local commit690797d inspected by git show; 58offline passes reported by coordinator, not rerun.
- Remaining: Local RESTv2 client commit690797db64fd80aa1aeccea8003543de470d8c16; coordinator reports58passing offline tests. No DB/worker workflow adoption, durable uncertain-operation reconciliation or production deployment. Source's example /v1 events/status API is not the implemented RESTv2 contract.

### CLIENT-041: conflict

- Source tab: t.jpdvnz6zf4wz
- Requirement: Rename client package terminology everywhere; later v6 also says персональный тариф; preserve distinction from expert quarterly Пакет Старт.
- Source excerpt: Заменить "Пакет сообщений" на **"Абонемент"**
- Code evidence: apps/web/src/account-packages-view.ts:8; apps/web/src/content.ts:35; apps/web/src/landing-view.ts:58
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Published/current client copy retains Пакеты/Пакет сообщений. Universal replacement ambiguous because later accepted client paid policy intentionally uses packages and quarterly expert product is separate.

### CLIENT-042: code_only

- Source tab: t.m5xs71wx9lsp
- Requirement: Keep client coupons separate from expert referral bonus product, balances/redemption/namespaces; clients should not see bonus terminology.
- Source excerpt: Четко разделить таблицы/поля: `Client_Coupons` ... `Expert_Bonuses`
- Code evidence: packages/db/src/schema/billing.ts:1; packages/db/src/schema/expert-residency.ts:1; apps/web/src/content.ts:43
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Expert schema is distinct; client coupon schema missing, so full two-ledger implementation incomplete. Client-facing FAQ still calls coupons 'бонусная механика'.

### CLIENT-043: uncertain

- Source tab: t.m5xs71wx9lsp
- Requirement: Deterministic FAQ first, Selarti only unknown question/РАССЧИТАТЬ/complex objections; only generations count, demo dialogue static on request.
- Source excerpt: TG-бот отвечает на 80% вопросов ... бесплатно
- Code evidence: packages/application/src/hybrid-message-gateway.ts:72; packages/application/src/hybrid-message-gateway.ts:140
- Test references (not fresh execution): packages/application/src/hybrid-message-gateway.test.ts:166
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Tab19 context is expert bot, so client applicability unconfirmed. Client deterministic route only matches help/start/stop variants, not80% knowledge base. Static customer web demo does not prove bot demo module.

### CLIENT-044: conflict

- Source tab: t.s01rqhytlm1
- Requirement: Adult-only pilot must reject minor onboarding; source asks removal of deployment tests/gates.
- Source excerpt: Установить `ALLOW_MINOR_DATA = false`
- Code evidence: packages/config/src/env.ts:214
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: False-only minor flag exists. Source instruction to disable safeguards conflicts with standing repository no-weakening contract; adult-only rollout must retain checks and accepted age/consent requirements.

### CLIENT-045: locally_verified

- Source tab: t.0
- Requirement: Authenticated customer account displays owner-only per-package units/expiry/status and complete aggregate balance; no stale authority leakage.
- Source excerpt: Актуальные данные по каждому пакету передаются
- Code evidence: packages/db/src/repositories/client-account-packages-repository.ts:12; apps/web/src/account-packages-view.ts:31
- Test references (not fresh execution): packages/db/src/repositories/client-account-packages-repository.test.ts:48; apps/api/src/routes/browser-account-packages.test.ts:76; apps/web/src/account-packages-client.test.ts:105
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Published43a93e2 contains account readout; evidence docs/test-evidence/production/2026-10-10-account-packages-rc.md:28 reports exactRC DB5/API8/client18/browser1. Real authenticated production balance remains unverified; account UI is delivery surface for balance requirement, not a separately specified tab feature.

### CLIENT-046: missing

- Source tab: t.0
- Requirement: Client paid package purchase/renewal must settle provider-confirmed payment into exactly-once entitlement and coupon grants, recover uncertain outcomes/refunds.
- Source excerpt: с момента оплаты
- Code evidence: apps/web/src/account-packages-view.ts:8; packages/integrations/src/yookassa/payment-adapter.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: YooKassa integration exists for expert residency, not composed ordinary client checkout. Paid policy candidate on separate branch excluded from43a93e2. PAYMENTS_ENABLED=false; absent YooKassa flag is not enablement.

### CLIENT-047: uncertain

- Source tab: t.0
- Requirement: Authentic Telegram identity/login and authorized account journey required before accepting customer operation.
- Source excerpt: Записывать к экспертам через Planerka.
- Code evidence: apps/api/src/telegram-client-proof.ts:1; apps/web/src/account-packages-view.ts:35
- Test references (not fresh execution): apps/web/src/client-login-handoff.test.ts:43
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Session enabled and browser handoff code published; actual Telegram login/navigation was intercepted in release browser checks. Telegram ingress currently false. Requirement derived as prerequisite to owner-bound client workflows.

### CLIENT-048: uncertain

- Source tab: t.5nu61c58syud
- Requirement: Real verified experts/services/slots available from authorized administrative onboarding before real customer booking; demo cards must never be treated as offers.
- Source excerpt: Эксперты ... price ... timezone
- Code evidence: packages/application/src/catalog-service.ts:67; packages/db/src/repositories/admin-repository.ts:103
- Test references (not fresh execution):
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established. Fresh inventory: experts0, expert_services0, slots0.
- Remaining: Fresh DB inventory zero is a valid empty initial state, not proof of absent admin onboarding. Reviewed admin paths do not establish complete ordinary expert/service/slot onboarding; expert-audit owner must resolve workflow. No fabricated providers proposed.

### CLIENT-049: code_only

- Source tab: t.bz1p9fj1cjvd
- Requirement: Later v5/v6 reiterate Planerka booking for space slots with Telegram confirmation/cancellation; client booking must not consume unsupported space entitlements.
- Source excerpt: Статусы: `Reserved` (72 часа) → `Booked` / `Cancelled`
- Code evidence: packages/application/src/booking-service.ts:241; packages/integrations/src/planerka/client.ts:59
- Test references (not fresh execution): packages/domain/src/reservation.test.ts:65
- Live evidence: Fresh coordinator read-only evidence .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): native/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments, Selarti, Planerka, LLM, Telegram ingress, hybrid routing, response ingress and reserve creation false. Sessions, booking read/cancel and privacy true. No authenticated customer journey established.
- Remaining: Generic booking/transport exists; space quota and product-specific composition belong to partner audit and are not established by client reservation state machine.

### Source conflicts

- t.0, t.w117q321zxgc, t.5nu61c58syud, t.bz7qkf4jpoor, t.jpdvnz6zf4wz, t.m5xs71wx9lsp, t.bz1p9fj1cjvd, t.s01rqhytlm1: Client package60d/coupon90d originally amended to30d/45d in tabs18–21. Subsequent accepted repository owner DEC-FIN-002 retains paid client60 calendar days UTC+3 (docs/superpowers/implementation-artifacts/fin-client-package-policy.md:16,32), intro100 without expiry; admin grants30d are another product path. Preserve cohort/history and distinguish client/expert subscription.
- t.0, t.m5xs71wx9lsp: Original all-message charging including service/errors vs tab19 free deterministic FAQ and only Selarti generations. Tab19 is embedded in expert-bot section; do not assume client override. Current billing makes system/safety/error free and supports pinned free-client cohorts; owner DEC-FIN-001 B forbids new free cohort admission.
- t.0, t.w117q321zxgc, t.5nu61c58syud, t.bz7qkf4jpoor: Source grants Sheets/Make financial and PII authority and requires raw Dialogs logging. Repository contract/accepted DEC-PLT-004 reserve PII and transactional authority for RF PostgreSQL; off/deidentified projections only. Literal8-sheet implementation is superseded, not an excuse to omit equivalent legitimate workflows.
- t.0, t.w117q321zxgc: Fixed72h hold may extend beyond a slot allowed at24h lead. Code uses min72h and slot-start-minus-buffer; reconcile customer promise with actual bounded deadline.
- t.0, t.w117q321zxgc: Literal reminder only3days versus daily scan2–4day candidate range; source template says 'Успейте использовать!' despite explicit prohibition of urgency marketing. Require deduped scheduling and approved copy.
- t.0: Next-day feedback,3–4day post-visit silence, daily micro-check-ins and emergency1h/3h/24h follow-ups need explicit precedence/mode rules; ordinary pause cannot imply suspension of urgent handoff.
- t.0: Nonclinical/no-advice role conflicts with breathing/grounding instructions and diagnostic scripts. Sensitive profile/state persistence conflicts with accepted ephemeral-only constraints; clinical-looking original content is not authorization.
- t.0: Coupon unit is RUB1 but same source prohibits two coupons for one expert/service and says coupons sum. Distinguish denomination from grant/voucher instrument and service cap before redemption; no silent guessed cap.
- t.5nu61c58syud, t.bz7qkf4jpoor, t.bz1p9fj1cjvd, t.s01rqhytlm1: Old Planerka example GET/events and PUT/events/id/status is not the newly implemented native RESTv2 contract. Transport commit690797d offline tests do not establish status mapping, reservation ownership or worker adoption.
- t.jpdvnz6zf4wz, t.m5xs71wx9lsp, t.bz1p9fj1cjvd, t.s01rqhytlm1: Requests to remove minor CI checks conflict with standing no-weakening contract. Adult-only false flag is supported; deleting safety tests is not required for valid adult operation.
- t.0, t.jpdvnz6zf4wz, t.m5xs71wx9lsp, t.bz1p9fj1cjvd, t.s01rqhytlm1: Universal 'Абонемент' rename conflicts with retained client 'Пакет' copy and separately named quarterly expert 'Пакет Старт'. Expert bonus/promotion changes must not overwrite client coupons or client 'Старт'500-message SKU.
- t.jpdvnz6zf4wz, t.m5xs71wx9lsp, t.bz1p9fj1cjvd, t.s01rqhytlm1: Cross-area amendments preserved for expert auditor: v2.2 weekly8/9/10/12k then v3 weekly10→14k, frozen in v5/v6 in favor of Energy-of-start discounts; Early Birds30-seat/30k-year and2-for-1 promotion replaced/held by later programme. These are expert prices, not client package amounts.
- t.bz1p9fj1cjvd, t.s01rqhytlm1: Cross-area referral amendment: v5 narrative issues code after payment but normative rules generate before; v6 resolves generate on registration, show after payment, reusable. This EXPERT code must not be confused with client promo_XXXX500+500.
- t.s01rqhytlm1: Expert v6 manual competence approval/payment-link before payment and paid onboarding replaces immediate-access promises; client catalogue population depends on actual approved cards. Zero production records neither proves a defect nor authorizes synthetic real offers.
- t.5nu61c58syud, t.0: Original MVP may defer reminders/audio/waitlist/check-ins/festival mode; current full-production request is broader. Deferred items remain requirements and must not be erased from full acceptance.

## Expert residency/referrals/test-expert/tariffs/organizations

### EXP-001: code_only

- Source tab: t.erpy9175tl0t
- Requirement: Expert-only Telegram assistant with concise factual replies; no client counselling. Duplicate role/style constraints in tabs 3,6,7.
- Source excerpt: Ты — помощник эксперта в Telegram.
- Code evidence: packages/integrations/src/telegram/expert-command-processor.ts:209; packages/integrations/src/telegram/telegram-adapter.ts:449; apps/api/src/server.ts:257
- Test references (not fresh execution): packages/integrations/src/telegram/telegram-adapter.test.ts:264
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Deterministic renderers exist; expertTelegramComposition is supplied only in tests in inspected API callers. No composed live expert-bot journey demonstrated.

### EXP-002: missing

- Source tab: t.erpy9175tl0t
- Requirement: New-reservation notification must include client, service, time, format, total price, coupon/cash split and confirm/cancel/reschedule inline buttons; repeated tabs 3,6,7.
- Source excerpt: Статус: ожидает подтверждения (72 часа)
- Code evidence: packages/db/src/repositories/booking-repository.ts:202; packages/integrations/src/telegram/telegram-adapter.ts:655; apps/api/src/server.ts:416
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:7
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Reservation event and generic Telegram send port exist, but they do not establish complete rendered keyboard/payment fields or worker-to-provider delivery. Reschedule action is absent.

### EXP-003: code_only

- Source tab: t.erpy9175tl0t
- Requirement: Confirm owned reservation exactly once through explicit expert action, then update provider and notify client; repeated tabs 3,6,7.
- Source excerpt: Статус в Google Sheets → Booked.
- Code evidence: packages/application/src/booking-service.ts:207; packages/application/src/booking-service.ts:241; packages/db/src/repositories/booking-repository.ts:204
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:23
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Local atomic confirmation/outbox exists; deployed expert ingress/provider dispatch not established. Sheets authority was superseded by PostgreSQL; outbox creation does not prove client notification.

### EXP-004: code_only

- Source tab: t.erpy9175tl0t
- Requirement: Cancel reservation, free capacity, update Planerka, notify both parties and offer alternative slot/waitlist; repeated tabs 3,6,7.
- Source excerpt: Место освобождается.
- Code evidence: packages/application/src/booking-service.ts:242; packages/db/src/repositories/booking-repository.ts:205
- Test references (not fresh execution): packages/worker/src/reservation-expiry.test.ts:6
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Cancellation transition/effects are present. Referenced expiry test covers adjacent cancellation effects, not complete expert cancellation delivery or waitlist offer; providers remain off.

### EXP-005: missing

- Source tab: t.ck9t66la7yd9
- Requirement: Expert reschedule must offer actual slots and replace old reservation with a new bounded hold, with client notification.
- Source excerpt: Выбери новый слот → старая бронь отменяется, создаётся новый резерв на 72 часа.
- Code evidence: packages/application/src/booking-service.ts:151; packages/integrations/src/telegram/expert-command-processor.ts:209
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: BookingService exposes confirm/cancel/expire but no reschedule. Repository-wide reschedul/перенос search found no booking implementation; payment-recovery reschedule is unrelated. Source also conflicts on cancelling before versus after slot choice.

### EXP-006: code_only

- Source tab: t.2y5nctssumru
- Requirement: Expire unanswered reservations after 72 hours, release slot and notify expert/client; hourly scheduling requested; repeated tab7.
- Source excerpt: Триггер: Schedule раз в час
- Code evidence: packages/worker/src/reservation-expiry.ts:34; packages/db/src/repositories/booking-repository.ts:211; packages/db/src/repositories/booking-repository.ts:226
- Test references (not fresh execution): packages/worker/src/reservation-expiry.test.ts:6; packages/worker/src/reservation-expiry.test.ts:27
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Bounded expiry logic exists; exact hourly production scheduling and successful downstream notifications not established. Later hold policy bounds by event start, so 72h is a maximum, not unconditional.

### EXP-007: conflict

- Source tab: t.bm4yzyubq4pp
- Requirement: Schedule includes date/window, owned bookings and free slots, formats/statuses, in expert timezone; tab7 says today/tomorrow.
- Source excerpt: показывает все слоты на день/неделю со статусами
- Code evidence: packages/application/src/expert-telegram-query-service.ts:110; packages/integrations/src/telegram/telegram-adapter.ts:449
- Test references (not fresh execution): packages/application/src/expert-telegram-query-service.test.ts:63; packages/integrations/src/telegram/telegram-adapter.test.ts:322
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: 2026-08-13 approved query design narrows to next seven days of active appointments, no free slots/day selector. Source expectation is not delivered literally; preserve approved narrowing and reconcile customer copy.

### EXP-008: conflict

- Source tab: t.bm4yzyubq4pp
- Requirement: Lookup client by name and show request, package, used/remaining messages, coupons; tab7 also adds registration date.
- Source excerpt: Команда /client {имя}
- Code evidence: packages/application/src/expert-telegram-query-service.ts:40; packages/application/src/expert-telegram-query-service.ts:121; packages/integrations/src/telegram/telegram-adapter.ts:503
- Test references (not fresh execution): packages/integrations/src/telegram/telegram-adapter.test.ts:264; tests/integration/expert-telegram-queries.test.ts:247
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Later approved EXP-BOT-004/005 explicitly prohibit name/ID lookup, financial/package/coupon/history disclosure; opaque owned-reservation selection with consented preparation note replaces it. Do not restore broad PII exposure to match old prompt.

### EXP-009: conflict

- Source tab: t.ck9t66la7yd9
- Requirement: Monthly bookings/confirmed/cancelled/revenue statistics, including income; tab6 repeats income.
- Source excerpt: Бот покажет статистику за текущий месяц
- Code evidence: packages/application/src/expert-telegram-query-service.ts:48; packages/application/src/expert-telegram-query-service.ts:148; packages/integrations/src/telegram/telegram-adapter.ts:532
- Test references (not fresh execution): packages/application/src/expert-telegram-query-service.test.ts:128; tests/integration/expert-telegram-queries.test.ts:187
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Approved EXP-BOT-006 deliberately provides preceding 30-day completed/cancelled/no-show plus upcoming, no financial facts. Calendar-month revenue is neither the implemented nor later approved surface.

### EXP-010: code_only

- Source tab: t.2y5nctssumru
- Requirement: Ownership, active verified expert identity, private chat, consent minimization, replay-safe buttons; no changes from unconstrained text.
- Source excerpt: Только данные того эксперта, с которым ты общаешься.
- Code evidence: packages/db/src/repositories/expert-telegram-query-repository.ts:121; packages/application/src/expert-telegram-query-service.ts:162
- Test references (not fresh execution): tests/integration/expert-telegram-queries.test.ts:115; tests/integration/expert-telegram-queries.test.ts:247; tests/integration/expert-telegram-queries.test.ts:297
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Code/test coverage exists but was not executed here; live authenticated expert acceptance unavailable. Later signed opaque callbacks correctly replace unsafe bare callback examples.

### EXP-011: missing

- Source tab: t.erpy9175tl0t
- Requirement: Confirmed client receives meeting/address and optional audio task; expert confirmation must truthfully reflect delivery.
- Source excerpt: Ссылка на встречу/адрес: [ссылка]. Аудиозадание (если есть): [ссылка].
- Code evidence: packages/db/src/repositories/booking-repository.ts:204; packages/db/src/repositories/booking-repository.ts:595; packages/integrations/src/telegram/telegram-adapter.ts:474
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:69
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Booked meeting URL projection is partial logic, not a composed client notification/audio-task workflow. Expert URL disclosure was later restricted to 30 minutes before start; no evidence client received notification.

### EXP-012: missing

- Source tab: t.ck9t66la7yd9
- Requirement: Provider schedule changes and closed days automatically propagate to bookable inventory.
- Source excerpt: Обнови слоты в Planerka — бот подтянет изменения автоматически.
- Code evidence: packages/config/src/env.ts:52; packages/integrations/src/planerka/client.ts:1
- Test references (not fresh execution): packages/integrations/src/planerka/client.test.ts:1
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence. Coordinator additionally reports local commit 690797db64fd80aa1aeccea8003543de470d8c16 with 58 passing offline transport tests; not deployed. Inventory experts=0/services=0/slots=0.
- Remaining: Provider transport exists; workflow mapping, durable operation ownership, inventory synchronization and activation are separate unfinished work. Empty inventory is valid initial state, not proof sync is implemented.

### EXP-013: uncertain

- Source tab: t.ck9t66la7yd9
- Requirement: Support path for post-confirmation cancellation, no-show marking and a real administrator contact.
- Source excerpt: Напиши администратору — отметим как no-show.
- Code evidence: packages/application/src/expert-telegram-query-service.ts:48; packages/db/src/repositories/booking-repository.ts:218
- Test references (not fresh execution): tests/integration/expert-telegram-queries.test.ts:187
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No-show storage/query exists; inspected expert route does not establish an operator marking workflow or configured contact. Source itself conditions cancellation availability and leaves contact placeholder.

### EXP-014: code_only

- Source tab: t.bm4yzyubq4pp
- Requirement: Expert use consumes no client message package/coupons; retain action audit rather than raw dialogue logs.
- Source excerpt: ❌ Нет (только действия эксперта)
- Code evidence: packages/application/src/booking-service.ts:241; packages/db/src/repositories/expert-telegram-query-repository.ts:212
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:23; tests/integration/expert-telegram-queries.test.ts:247
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Tests cover free booking effects/content-free client-view audit; this is not proof of enabled monthly expert subscription or end-to-end operational logging.

### EXP-015: conflict

- Source tab: t.ck9t66la7yd9
- Requirement: Deliver usable expert prompt, commands/buttons, onboarding instructions, data schema and integration workflow (archive examples).
- Source excerpt: expert_scenario.json
- Code evidence: docs/prompts/test-expert-source-manifest.json:1; packages/integrations/src/telegram/expert-command-processor.ts:209
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Pseudo-Make JSON and bare callbacks are non-executable source examples. Later PostgreSQL authority and opaque identity-bound callbacks supersede them; legacy handoff package must not be presented as importable live configuration.

### REF-001: code_only

- Source tab: t.lrb6q79uob06
- Requirement: Generate/store/redeem expert referral codes in a distinct namespace/table, separate from client coupons.
- Source excerpt: партию промокодов другого типа и в другую таблицу
- Code evidence: packages/db/src/repositories/expert-referral-repository.ts:304; packages/db/src/schema/expert-residency.ts:285; packages/application/src/expert-referral-service.ts:50
- Test references (not fresh execution): tests/integration/expert-referral-redemption.test.ts:49; tests/integration/expert-referral-redemption.test.ts:112
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Batch issuance, digests and atomic ownership binding exist; current production issuance/redemption proof absent. Later code-at-registration/visible-after-payment/one-active-code workflow remains distinct from batch logic.

### REF-002: code_only

- Source tab: t.lrb6q79uob06
- Requirement: Inviter earns exactly 1000 RUB for eligible referred residency; later first-payment/maturity/reversal constraints retained.
- Source excerpt: За подписку реферала в проект получает 1000р на внутренний счет
- Code evidence: packages/db/src/repositories/expert-referral-reward-allocation.ts:27; packages/db/migrations/0033_expert_referral_maturity_a2.sql:29; packages/db/src/repositories/expert-residency-provider-inbox-repository.ts:297
- Test references (not fresh execution): tests/integration/expert-referral-maturity-matrix.test.ts:122; tests/integration/expert-referral-maturity-matrix.test.ts:146
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: V2 first settlement creates 30-day maturity; legacy immediate grants differ. Later DEC-FIN-015 also requires questionnaire+setup fee: inspected eligibility does not establish those prerequisites. Payments off; no live grant proved.

### REF-003: conflict

- Source tab: t.lrb6q79uob06
- Requirement: Spend credit only on own residency, capped at 30%, cash remainder 70%; retain competing 20% and legacy 50% rules.
- Source excerpt: в количестве 30% от тарифа размещения
- Code evidence: packages/domain/src/expert-referral.ts:63; packages/db/migrations/0032_commercial_core_v2_a1.sql:25; packages/db/src/repositories/expert-residency-repository.ts:539
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:13; packages/domain/src/expert-referral.test.ts:20
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Tab9 says 20% of full price; legacy helper default is 50%, V2 snapshot cap 30%. DEC-FIN-017 chooses 30% after discounts with historical snapshots grandfathered. Content/policy reconciliation needed, not global rewrite of old orders.

### REF-004: code_only

- Source tab: t.lrb6q79uob06
- Requirement: Reward lifetime one year, usable toward residency; later rule exactly 365 days from grant and FIFO expiry.
- Source excerpt: Накопленные баллы за приглашения не сгорают в течение года
- Code evidence: packages/domain/src/expert-referral.ts:142; packages/domain/src/expert-referral.ts:90; packages/db/src/repositories/expert-referral-reward-allocation.ts:48
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:33; packages/domain/src/expert-referral.test.ts:65
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Expiry/FIFO pure logic and SQL present; no live accumulated-credit consumption/expiry proof. Distinguish 30-day reward maturity from 365-day spendable lifetime.

### REF-005: code_only

- Source tab: t.lrb6q79uob06
- Requirement: Expose trustworthy referral summary/redemption and residency checkout without LLM financial authority.
- Source excerpt: В промпте/механике добавить учёт таких промокодов/хранение/списание
- Code evidence: packages/application/src/expert-referral-service.ts:41; packages/application/src/expert-residency-service.ts:133; packages/integrations/src/telegram/telegram-adapter.ts:665; apps/api/src/server.ts:257
- Test references (not fresh execution): packages/integrations/src/telegram/telegram-adapter.test.ts:131; packages/integrations/src/telegram/telegram-adapter.test.ts:145
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Read/render/checkout services present; expert ingress composition and enabled provider settlement remain unproved. Code is not active payment delivery.

### REF-006: uncertain

- Source tab: t.lrb6q79uob06
- Requirement: Keep client 500/500 referral program separate; source assertion 'already built' is not implementation evidence.
- Source excerpt: Клиентские промокоды 500/500купонов
- Code evidence: packages/db/src/schema/expert-residency.ts:285
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Assigned expert audit verifies separation only; no equivalent live client 500/500 journey established. Coordinate client audit; do not infer client functionality from expert ledger.

### TRIAL-001: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Recognize trial phrase, natural-language trial intent, referral code, unknown opening and direct purchase; ask referral source and route appropriately.
- Source excerpt: Если эксперт написал «тест эксперт»
- Code evidence: packages/application/src/test-expert-telegram-service.ts:106; packages/application/src/test-expert-telegram-service.ts:141
- Test references (not fresh execution): packages/application/src/test-expert-telegram-service.test.ts:66; packages/application/src/test-expert-telegram-service.test.ts:174
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Exact phrase /test_expert supported; no equivalent full multi-entry sales routing, referral-source collection or direct-purchase branch in deterministic state machine. Existing expert /redeem is not trial onboarding.

### TRIAL-002: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Unlimited trial discussion until decision versus later bounded trial ledger.
- Source excerpt: В тестовом промпте нет лимита на количество сообщений.
- Code evidence: packages/db/src/repositories/test-expert-trial-repository.ts:338; packages/db/src/repositories/test-expert-trial-repository.ts:361
- Test references (not fresh execution): tests/integration/test-expert-trial-postgres.test.ts:31; tests/integration/test-expert-trial-postgres.test.ts:74
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: 2026-08-30 amendment supersedes unlimited: 100 visible units/50 AI turns, deterministic zero-cost, unknown outcomes retained until reconciliation. Do not remove cap to match old text.

### TRIAL-003: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Remember answers and personalize presentation, ask questions individually, capture name/services/audience/experience/client targets/check/channels/problems.
- Source excerpt: Сохраняешь историю ответов эксперта
- Code evidence: packages/application/src/test-expert-telegram-service.ts:28; packages/application/src/test-expert-telegram-service.ts:183
- Test references (not fresh execution): packages/application/src/test-expert-telegram-service.test.ts:97
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Durable name/specialization/segment is implemented; complete business questionnaire and structured personalized journey are not. Raw unrestricted history conflicts with later consent/minimization rules.

### TRIAL-004: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Present service, ecosystem, benefits and client journey in warm professional non-pressuring language.
- Source excerpt: САМОПРЕЗЕНТАЦИЯ СЕРВИСА
- Code evidence: packages/application/src/test-expert-telegram-service.ts:5; docs/prompts/test-expert-source-manifest.json:1
- Test references (not fresh execution): packages/application/src/test-expert-telegram-service.test.ts:66
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Versioned source is inactive; runtime explicitly says technical questionnaire, sellingActivation inactive. Source text existing in docs is not activated sales workflow.

### TRIAL-005: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Client-role trial asks problem/duration/prior attempts/desired outcome/support need; interprets needs and offers coaching-like support.
- Source excerpt: Глубокая диагностика (пошагово)
- Code evidence: packages/application/src/test-expert-telegram-service.ts:5
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Later no-special-category persistence/no-written-signing launch decision and informational role prohibit treating this raw diagnostic script as approved unrestricted processing. No deterministic diagnostic journey implemented; Selarti/LLM off.

### TRIAL-006: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Show three explicitly fictional matching experts with name/direction/experience/price/location/reason; demo must not create real offers.
- Source excerpt: Вот тестовые эксперты из нашей базы
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20; apps/web/src/demo-catalog.ts:1
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence. Fresh inventory is zero experts/services/slots; valid empty initial state. Fictional demo cards cannot substantiate real offers.
- Remaining: Public demo catalogue is a separate display-only product, not the test-expert conversation. No trial matching/presentation state found.

### TRIAL-007: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Ask whether to send social links, send only named demo profiles on consent, skip on refusal, then continue slots; real profiles show links.
- Source excerpt: При показе вариантов экспертов ссылки не отображаются автоматически.
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No social-link consent/selection state or trial demo profile data path in inspected service/repository; source-only prompt is inactive.

### TRIAL-008: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Offer demo slots, simulate free booking and show service/location/price while explicitly distinguishing fictional expert and real booking.
- Source excerpt: Это тестовый визит к ненастоящему эксперту.
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20; apps/web/src/demo-catalog.ts:1
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Separate public web demo does not implement Telegram trial scheduling. Must not create production experts or fake successful provider bookings.

### TRIAL-009: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Demonstrate synthetic 3000 coupons, maximum spend 1000, remainder 2000 and adjusted cash due without touching real balances.
- Source excerpt: Начальный баланс: 3 000 купонов.
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No demo-coupon calculation/state in trial handler. Real credit/coupon ledgers and public web demo are not evidence of this conversational scenario.

### TRIAL-010: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Explain x2 purchased-package coupons and per-visit cap; clearly distinguish example from current approved commercial policy.
- Source excerpt: Клиент покупает доступ к сервису и получает купоны в 2 раза больше суммы оплаты.
- Code evidence: packages/application/src/test-expert-telegram-service.ts:5
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Later paid/free client cohorts and coupon decisions must drive content. Trial currently has placeholder FAQ; no approved runtime explanation or live client purchase proof. Client subsystem audit owns underlying package implementation.

### TRIAL-011: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Explain and demonstrate direct expert-name booking without competing recommendations; real flow should expose owned availability 24/7.
- Source excerpt: Хочу записаться к [твоё имя]
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20; packages/application/src/booking-service.ts:151
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Low-level booking is not conversational expert-name resolution or trial demonstration. Production reserve false and catalogue empty; no real user path established.

### TRIAL-012: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Answer only requested FAQ, explain service difference, no guaranteed client/group numbers, included services, fees and referral conditions.
- Source excerpt: FAQ — ТОЛЬКО ПРИ ЗАПРОСЕ
- Code evidence: packages/application/src/test-expert-telegram-service.ts:13; packages/application/src/test-expert-telegram-service.ts:225
- Test references (not fresh execution): packages/application/src/test-expert-telegram-service.test.ts:129
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: FAQ command responds with one placeholder technical message, not source FAQ. Residual AI port does not establish approved knowledge or deterministic commercial facts.

### TRIAL-013: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Source asks assurance of no advertising labelling/legal risk and stable client flow while separately prohibiting guarantees.
- Source excerpt: Это не читается как реклама и не требует маркировки
- Code evidence: docs/prompts/test-expert-source-manifest.json:1; packages/application/src/test-expert-telegram-service.ts:5
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Inactive promotional text contains categorical assurances conflicting with no-guarantee and later factual/non-advertising copy constraints. Requires approved content reconciliation; this audit makes no legal determination.

### TRIAL-014: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Capture feedback, objections, interest/readiness/meeting/manager/link-request labels and select next sales step.
- Source excerpt: Запомни, что именно понравилось эксперту
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20; packages/application/src/test-expert-telegram-service.ts:28
- Test references (not fresh execution): packages/application/src/test-expert-telegram-service.test.ts:97
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Durable technical states exist, but listed sales labels/feedback/objection state and route are absent from inspected session contract.

### TRIAL-015: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Book a real manager meeting after consent, create calendar event, send link/address and enter accompaniment mode.
- Source excerpt: свободные слоты для встречи
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20; packages/integrations/src/planerka/client.ts:1
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Generic Planerka transport does not supply manager calendar ownership, appointment workflow or trial session state. Search of manager/meeting/slot symbols found no composed trial handoff.

### TRIAL-016: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Send 24-hour and one-hour reminders for demo visit and manager meeting, with change handling.
- Source excerpt: напоминание за день и за час
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No trial/manager reminder scheduler, durable reminder state or delivery test located in inspected application/worker paths. Source promise must not imply sent messages.

### TRIAL-017: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Collect required 14 manager fields, show/edit summary and require confirmation before transmission.
- Source excerpt: Покажи эксперту полную сводку
- Code evidence: packages/application/src/test-expert-telegram-service.ts:28
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Only name/specialization/segment captured. No contact/city/social/service/client-target/channel/organization/price/start-date summary confirmation workflow.

### TRIAL-018: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: After consented summary approval, deliver to manager and durable preregistration, preserving same-dialogue continuation.
- Source excerpt: Отправь сводку в чат менеджерам (ТГ) и продублируй во внутреннюю таблицу предзаписи.
- Code evidence: packages/application/src/test-expert-telegram-service.ts:20
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Manager handoff/preregistration workflow missing. Later DEC-PLT-004 prohibits Sheets as PII store: any projection must be de-identified; PostgreSQL is authoritative. Keep handoff requirement but replace unsafe storage assumption.

### TRIAL-019: uncertain

- Source tab: t.1rwrphdgfnh9
- Requirement: Grammar/spelling, concise stepwise replies, no spam/interruption, clear next action; source says every reply ends with question/action.
- Source excerpt: Система проверяет орфографию и грамматику исходящих сообщений.
- Code evidence: packages/integrations/src/telegram/telegram-adapter.ts:449; packages/application/src/test-expert-telegram-service.ts:5
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Bounded deterministic copy exists; no full editorial/grammar acceptance of activated trial text. Offline static checks cannot certify arbitrary LLM semantic quality; no LLM call requested or performed.

### PRICE-001: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Base 12000/exclusive 20000 monthly pricing versus later active versioned expert policy.
- Source excerpt: base_price Базовая стоимость 12 000 ₽
- Code evidence: packages/db/migrations/0032_commercial_core_v2_a1.sql:23; packages/db/src/repositories/test-expert-pricing-policy.ts:8
- Test references (not fresh execution): packages/application/src/test-expert-telegram-service.test.ts:97
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: DEC-FIN-007 explicitly retains V2 START3900/BASE5900/PRO9990 and supersedes 12k/20k. Existing placeholder quotes BASE5900, not source personalization. Runtime tariff rows/checkout not established.

### PRICE-002: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Time-to-join weekly discounts require anchored first-entry time and bounded windows.
- Source excerpt: 1–7 дн = -4 000, 8–14 дн = -3 000, 15–21 дн = -2 000, 22+ = 0
- Code evidence: packages/db/migrations/0032_commercial_core_v2_a1.sql:23; packages/db/src/repositories/test-expert-pricing-policy.ts:8
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: DEC-FIN-007/008 archive legacy weekly prices. Later DEC-FIN-011 separately accepts Start/Energy Start discounts; current fixed V2 query does not implement that discount composition. Do not conflate superseded weekly discount with delivered current discount logic.

### PRICE-003: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Base-only minus1000 for low average check or named service, exclude exclusive; collect city, modality, group preference and main service.
- Source excerpt: Если средний чек < 3 000 ИЛИ услуга из списка
- Code evidence: packages/application/src/test-expert-telegram-service.ts:28; packages/db/src/repositories/test-expert-pricing-policy.ts:8
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Legacy personalized formula superseded by DEC-FIN-007. Trial captures neither average check nor city/modality; no evidence this old discount is active. Preserve OR service-list exception when reconciling source.

### PRICE-004: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Personal expert +5000 million-city (16-city list), +3000 online-only regardless of region, cumulative for either old tariff.
- Source excerpt: online_only Наценка за только онлайн
- Code evidence: packages/db/src/repositories/test-expert-pricing-policy.ts:8; packages/domain/src/partner-pricing.ts:78
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Expert V2 fixed-price policy supersedes old expert formula. Partner calculator supports analogous surcharges but cannot prove expert pricing. Trial passes only segment, losing city/modality even for partner quote.

### PRICE-005: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Exclusive positioning for services priced at least15000 and no low-check discount.
- Source excerpt: от 15 000 ₽ за услугу
- Code evidence: packages/db/migrations/0032_commercial_core_v2_a1.sql:23
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: DEC-FIN-009 makes15000 a content recommendation, not eligibility/API filter; exclusive is not a V2 SKU. Inactive text must not promise an available purchasable exclusive tariff.

### PRICE-006: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Expert may correct questionnaire and recalculate; manager verifies facts and corrects intentionally distorted price.
- Source excerpt: менеджер в любом случае перепроверит предоставленную информацию
- Code evidence: packages/application/src/test-expert-telegram-service.ts:183; packages/db/src/repositories/test-expert-pricing-policy.ts:8
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No verification/requote approval flow; current quote receives segment only. Organization repository even marks upserted profile verified without establishing an external manager review in this flow.

### PRICE-007: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Lock price for uninterrupted residency, recalculate after break; retain correct historical pricing snapshots.
- Source excerpt: Эта цена останется за тобой на всё время участия
- Code evidence: packages/db/src/repositories/expert-residency-repository.ts:539; packages/domain/src/expert-referral.ts:199
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:126
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Immutable order snapshots and period extension exist; they do not implement per-expert locked future renewal tariff or reset-on-break pricing.

### PRICE-008: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Charge3000 setup at first joining, include unlimited later card updates.
- Source excerpt: разовый платёж 3 000 ₽
- Code evidence: packages/db/src/schema/expert-residency.ts:345; packages/application/src/expert-residency-service.ts:133
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No setup_fee/setupFee workflow found across production TS; residency checkout is tariff-only. Later reward prerequisite requiring setup cannot be treated as met.

### PRICE-009: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Retain paused card for three months, waive setup on return within window; delete/recharge setup after longer break.
- Source excerpt: твоя карточка сохраняется в базе до 3 месяцев.
- Code evidence: packages/db/src/schema/expert-residency.ts:345
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Residency period/expiry is not profile pause/retention/reactivation lifecycle. No linked profile-deletion or returning-resident fee workflow established.

### PRICE-010: code_only

- Source tab: t.1rwrphdgfnh9
- Requirement: Join any day, prepaid rolling30-day residency; later exact 30x24h cadence.
- Source excerpt: следующий платёж — через 30 дней.
- Code evidence: packages/domain/src/expert-referral.ts:199; packages/db/migrations/0032_commercial_core_v2_a1.sql:25
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:126
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Period arithmetic and snapshot duration exist. DEC-FIN-021 chooses settlement-based30x24h; no live purchase or renewal proof.

### PRICE-011: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Send renewal payment link before expiry; later approved exact reminder three days prior.
- Source excerpt: ссылку на продление за 3–5 дней
- Code evidence: packages/worker/src/expert-residency-expiry.ts:1; packages/application/src/expert-residency-service.ts:133
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Expiry/reconciliation and checkout are separate existing components; no renewal reminder producer/scheduler located by production renew/remind search. DEC-FIN-021 narrows3–5 to3days.

### PRICE-012: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: After payment, collect/edit/approve expert profile, publish within1–3days without extending paid period; earlier same tab says2–3days.
- Source excerpt: Срок оформления и публикации заявки в базе проекта — 1–3 дня.
- Code evidence: packages/db/src/repositories/admin-approval-repository.ts:86; packages/application/src/test-expert-telegram-service.ts:28
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence. Fresh DB counts experts=0,expert_services=0,slots=0; no fabricated real provider should be inserted to close acceptance.
- Remaining: Verify/suspend/service-activation admin primitives are not complete application/editor/publication intake or SLA workflow. Empty initial live inventory is valid and does not itself prove missing admin creation; missing end-to-end onboarding inferred from inspected route/state surface.

### PRICE-013: conflict

- Source tab: t.1rwrphdgfnh9
- Requirement: Unlimited individual services included and one monthly group <=20; preserve later START0/BASE1/PRO3 groups.
- Source excerpt: Все индивидуальные услуги — неограниченное количество.
- Code evidence: packages/db/src/schema/expert-residency.ts:385; packages/domain/src/partner-pricing.ts:71
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: V2 schema records individual-enabled/group limits0/1/3, superseding single old base offer. No expert group capacity20 or durable monthly quota consumption established.

### PRICE-014: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Additional resident groups: sum seats*seat prices,10% service fee,30% service-fee deposit, remainder on actual registered project participants; report in chat.
- Source excerpt: Стоимость набора каждого дополнительного группового мероприятия — 10% от выручки с группы.
- Code evidence: packages/db/src/schema/expert-residency.ts:345; packages/domain/src/partner-pricing.ts:24
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Schema/group-limit and partner commission constants are not event pricing, attendance, deposit, final settlement or chat-report workflow. DEC-FIN-013 confirms deposit base is project service fee, not total ticket revenue.

### PRICE-015: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Nonresident event acquisition15% revenue plus4500 event card fee; paid event announcement without residency.
- Source excerpt: 15% от выручки + 4 500 рублей
- Code evidence: packages/domain/src/partner-pricing.ts:25; packages/db/src/schema/partner-commerce.ts:104
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:64
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Constants carried in shadow snapshot only; no event-card purchase/revenue settlement consumer proved. Applies also tab17; do not label missing pure arithmetic when missing workflow is the issue.

### PRICE-016: uncertain

- Source tab: t.1rwrphdgfnh9
- Requirement: No guaranteed client count/group fill; allow improved profile/services/hashtags with manager and distinguish candidate demand from proven demand.
- Source excerpt: не можем гарантировать конкретное количество
- Code evidence: docs/prompts/test-expert-source-manifest.json:1; packages/application/src/test-expert-telegram-service.ts:5
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No approved live FAQ/editor workflow demonstrated. Same source says stable flow and immediate clients; evidence does not support those claims.

### PRICE-017: missing

- Source tab: t.1rwrphdgfnh9
- Requirement: Provide referral invitation templates/codes/registration instructions at confirmed-participation boundary, not invented early rewards.
- Source excerpt: предоставлю тебе все необходимые материалы и инструкции
- Code evidence: packages/application/src/expert-referral-service.ts:50; packages/db/src/repositories/expert-referral-repository.ts:304
- Test references (not fresh execution): tests/integration/expert-referral-redemption.test.ts:49
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Referral issuance/redeem logic exists; invitation-material delivery and paid onboarding boundary do not. DEC-FIN-014 adds generation at registration/visibility after first payment; current batch system is not that lifecycle.

### ORG-001: code_only

- Source tab: t.x95rfj69c5m1
- Requirement: Ask applicant kind and route EXPERT/CENTER/ORGANIZER to distinct commercial policies, product names and privileges.
- Source excerpt: в каком качестве он очень войти в проект
- Code evidence: packages/application/src/test-expert-segmentation.ts:23; packages/application/src/test-expert-telegram-service.ts:200; packages/db/src/repositories/partner-commerce-repository.ts:52
- Test references (not fresh execution): packages/application/src/test-expert-telegram-service.test.ts:97
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Kind logic and persisted participant repository exist. Trial session segmentation is not proof of full commercial participant onboarding, code issuance or enabled privileges; referenced trial test exercises EXPERT with mock policy.

### ORG-002: code_only

- Source tab: t.x95rfj69c5m1
- Requirement: Center monthly15000 standard,12000 with6–9 qualified experts,8000 with10+, fixed staff/location.
- Source excerpt: 15000р/мес
- Code evidence: packages/domain/src/partner-pricing.ts:56; packages/domain/src/partner-pricing.ts:77; packages/db/src/repositories/partner-commerce-repository.ts:85
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:41; packages/domain/src/partner-pricing.test.ts:187
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Calculator accepts versioned policy values and tests instantiate requested prices, not authoritative published tariff. DEC-FIN-030 remains open in reviewed register; no approved production rows established. Fixed-staff/location qualification not implemented by price function.

### ORG-003: code_only

- Source tab: t.x95rfj69c5m1
- Requirement: Organizer monthly20000 standard,15000 with6–9,10000 with10+ qualified resident experts.
- Source excerpt: 100% стоимость - 20 000р/мес.
- Code evidence: packages/domain/src/partner-pricing.ts:77; packages/db/src/repositories/partner-commerce-repository.ts:85
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:41; packages/domain/src/partner-pricing.test.ts:201
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Formula/tests exist; approved production prices and paid organizer lifecycle do not follow from test fixtures. DEC-FIN-030 requires reconciliation with this source.

### ORG-004: missing

- Source tab: t.x95rfj69c5m1
- Requirement: Distinct partner referral codes/counting, no expert/client coupon grants, tariff bands at6/10 with no further privilege beyond10.
- Source excerpt: должны только учитывать количество экспертов зарегистрированных от центров/организаторов
- Code evidence: packages/db/src/repositories/partner-commerce-repository.ts:101; packages/db/src/schema/partner-commerce.ts:25
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:187; packages/domain/src/partner-pricing.test.ts:201
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Production quote hardcodes qualifiedExpertCount0. No participant→invited expert affiliation/code lifecycle in reviewed schema; DEC-FIN-031 open. Boundary calculator is present, source-of-count/adoption workflow missing.

### ORG-005: conflict

- Source tab: t.x95rfj69c5m1
- Requirement: Partner acquisition program must not award expert/client coupons, bonuses or gifts; tier-only benefit.
- Source excerpt: На них не распространяются купоны и бонусы, и скидки/подарки за них.
- Code evidence: packages/db/src/schema/partner-commerce.ts:25; packages/domain/src/partner-pricing.ts:28
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Tab17 tier-only rule conflicts with later DEC-FIN-017 language allowing30% bonus spend for center/organizer. No partner bonus ledger/checkout implemented; distinguish acquisition grants from possible existing-credit spending before resolving.

### ORG-006: missing

- Source tab: t.x95rfj69c5m1
- Requirement: Center includes10 events/month <=30 participants; excess events10%, and excess seats over30 charged10% while first30 remain included.
- Source excerpt: 10 мероприятий до 30 чел , в мес
- Code evidence: packages/domain/src/partner-pricing.ts:71; packages/db/src/schema/partner-commerce.ts:22
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:64
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Entitlement snapshot exists. Missing durable event/count consumption, participant/revenue data and split fee for seat31+. Tests assert snapshot values, not consumption or financial settlement.

### ORG-007: missing

- Source tab: t.x95rfj69c5m1
- Requirement: Organizer includes5 events<=50,3<=100,1<=500 per month, then10%; later strict band matching.
- Source excerpt: 5 мероприятий до 50 чел
- Code evidence: packages/domain/src/partner-pricing.ts:71; packages/db/src/schema/partner-commerce.ts:23
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:64
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Static bands exist; no durable quota allocation/consumption and overage settlement. DEC-FIN-012 selects strict bands; smaller events cannot silently consume larger unused quotas.

### ORG-008: code_only

- Source tab: t.x95rfj69c5m1
- Requirement: Both organizations +3000 online-only/+5000 million-city, no low-average-check discounts.
- Source excerpt: Надбавки за онлайн/милионник - аналогично как у экспертов.
- Code evidence: packages/domain/src/partner-pricing.ts:78; packages/db/src/repositories/test-expert-pricing-policy.ts:46
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:237
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Pure calculation handles surcharges and no low-check input, but trial passes only segment so flags defaultfalse. Profile-aware commercial quote exists separately; workflow must collect verified city/modality.

### ORG-009: missing

- Source tab: t.x95rfj69c5m1
- Requirement: Only paid residents may announce eligible events; nonresident15%+4500 and resident10% need actual commercial settlement.
- Source excerpt: оплатив участие
- Code evidence: packages/db/src/repositories/partner-commerce-repository.ts:92; packages/domain/src/partner-pricing.ts:24
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:64
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Repository returns shadow quotes only; no paid organization order/subscription/entitlement/announcement activation proven. Payments false.

### ORG-010: missing

- Source tab: t.x95rfj69c5m1
- Requirement: Centers/organizers distribute approved-format announcements; acquire both experts/clients and route respondents into warmup/booking.
- Source excerpt: дают анонсы об ии-Тоне по своим базам/подписчикам
- Code evidence: packages/application/src/test-expert-telegram-service.ts:5; packages/db/src/schema/partner-commerce.ts:25
- Test references (not fresh execution):
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: No approved distribution package, partner-attributed acquisition funnel or live follow-up demonstrated. Tier ledger must not be substituted with expert monetary referral program.

### REF-007: missing

- Source tab: t.lrb6q79uob06
- Requirement: Later DEC-FIN-015 amends reward qualification to first month's payment after questionnaire AND setup fee, with first30day reversal policy.
- Source excerpt: За подписку реферала в проект получает 1000р на внутренний счет
- Code evidence: packages/db/src/repositories/expert-residency-provider-inbox-repository.ts:272
- Test references (not fresh execution): tests/integration/expert-referral-maturity-matrix.test.ts:122
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Eligibility checks active/verified expert, referral and abuse hold, but no questionnaire/setup-paid prerequisites. Existing maturity/reversal logic does not implement complete amended qualification.

### REF-008: missing

- Source tab: t.lrb6q79uob06
- Requirement: Later DEC-FIN-016 preserves30day reward maturity and independently prohibits promotional participant spending for3months.
- Source excerpt: Потратить их может на оплату своего резеденства
- Code evidence: packages/db/src/repositories/expert-residency-repository.ts:539; packages/db/migrations/0033_expert_referral_maturity_a2.sql:30
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:20
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Maturity and cap logic exist; separate promotional participant blackout not established in quote/checkout schema or code. A mature grant does not automatically satisfy promotion eligibility.

### REF-009: missing

- Source tab: t.lrb6q79uob06
- Requirement: Later code lifecycle requires creation at registration, visibility after first payment, one active code, and decision on reuse.
- Source excerpt: Для экспертов надо сгенерировать партию промокодов другого типа
- Code evidence: packages/db/src/repositories/expert-referral-repository.ts:304; packages/db/src/schema/expert-residency.ts:301
- Test references (not fresh execution): tests/integration/expert-referral-redemption.test.ts:49
- Live evidence: Coordinator read-only preflight 2026-10-12T13:35:39.817Z, .cache/requirements-2026-10-12/live-evidence.json: API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true; payments/Selarti/Planerka/LLM/client Telegram ingress/hybrid/response ingress/reserve false. Functional live acceptance UNVERIFIED; health is not feature evidence.
- Remaining: Admin batches and unique code redemption exist, but automatic registration/payment visibility lifecycle does not. DEC-FIN-029 remains open for reusable versus single-use semantics; do not replace this decision with a generic done label.

### Source conflicts

- t.erpy9175tl0t, t.2y5nctssumru, t.bm4yzyubq4pp, t.ck9t66la7yd9: Sheets/Make as authoritative reservations/PII store versus standing AGENTS and later DEC-PLT-004: PostgreSQL owns state, Sheets only de-identified projection/off. Keep user-visible workflow but not obsolete trust boundary.
- t.erpy9175tl0t, t.2y5nctssumru, t.ck9t66la7yd9: Reschedule cancel order conflicts: tabs2/7 describe choosing new slot before cancelling; tab3 and tab7 pseudo-JSON cancel first. No implemented reschedule resolves losing original booking when selection fails.
- t.erpy9175tl0t, t.bm4yzyubq4pp, t.ck9t66la7yd9: Schedule today/tomorrow/day-week/free slots versus approved 2026-08-13 EXP-BOT-003 seven-day active appointments only. Bounded implemented scope is not literal full source delivery.
- t.erpy9175tl0t, t.2y5nctssumru, t.bm4yzyubq4pp, t.ck9t66la7yd9: Name lookup/package/coupon/client-history view replaced by approved EXP-BOT-004/005 opaque owned-reservation callbacks and minimal consented preparation data. Tab7 registration-date addition also not part of approved minimal view.
- t.2y5nctssumru, t.bm4yzyubq4pp, t.ck9t66la7yd9: Calendar-month revenue statistics replaced by approved EXP-BOT-006 rolling30-day nonfinancial aggregates. Do not treat /stats command existence as income reporting.
- t.erpy9175tl0t, t.ck9t66la7yd9: Immediate full links/context after booking versus later DEC-PLT-004 expert disclosure only within30min before meeting and current consent. This expert restriction does not itself establish the requested client notification.
- t.lrb6q79uob06, t.1rwrphdgfnh9: 30% residency credit in tab8 versus20% full tariff in tab9, historical50% implementation. DEC-FIN-017 selects30% post-discount for new V2 orders with legacy snapshots preserved.
- t.lrb6q79uob06, t.1rwrphdgfnh9: Generic reward on subscription versus V2 first eligible payment+30day maturity and DEC-FIN-015 questionnaire+setup fee, DEC-FIN-016 separate3month promotion spending ban. Maturity logic exists, complete qualification/promotion workflow not established.
- t.1rwrphdgfnh9: Unlimited trial source superseded by 2026-08-30 amendment:100 visible units,50AI turns, deterministic zero, unknown outcomes reconciled; source sales copy remains inactive.
- t.1rwrphdgfnh9: 12k/20k, weekly8k/9k/10k/12k and low-check/surcharge formula superseded by DEC-FIN-007 V2 3900/5900/9990; DEC-FIN-011 separately retains Start/Energy Start/floor rules not implemented by fixed tariff lookup. Preserve each amended constraint.
- t.1rwrphdgfnh9: Exclusive >=15000 threshold becomes content-only recommendation under DEC-FIN-009; not a database eligibility gate or currently purchasable exclusive SKU.
- t.1rwrphdgfnh9: Source1–3day publication versus2–3day earlier FAQ; source3–5day renewal reminder narrowed by DEC-FIN-021 to3days and30x24h settlement periods. Publication/reminder workflow remains unproved.
- t.1rwrphdgfnh9, t.x95rfj69c5m1: Legacy expert single included group<=20 versus V2 START0/BASE1/PRO3; partner quotas independently10x30 and5x50+3x100+1x500. Constants must not be flattened into one shared entitlement or treated as executed quota accounting.
- t.1rwrphdgfnh9, t.x95rfj69c5m1: Deep diagnosis/history/personalized sales and manager Sheets export conflict with later no-special-category launch scope and PostgreSQL-only PII authority. Preserve legitimate onboarding with approved purpose-specific consent; do not reactivate raw legacy prompt.
- t.1rwrphdgfnh9: No guaranteed clients/group fill conflicts within same source with stable-flow/immediate-client and categorical no-advertising-risk claims. Inactive source is not approved external/legal or operational evidence.
- t.x95rfj69c5m1: Source specifies partner absolute prices but DEC-FIN-030 still open and only fixture prices found; DEC-FIN-031 unresolved affiliation leaves real quotes at count0. Qualification text alternates registered experts versus paid residents; source-of-count decision must preserve paid/qualified semantics.
- t.x95rfj69c5m1, t.lrb6q79uob06: Partner tier-only/no-coupon/no-bonus policy conflicts with DEC-FIN-017 generic center/organizer30% credit language; distinguish no acquisition awards from allowed spending and explicitly resolve rather than reuse expert referral ledger.
- t.lrb6q79uob06: Original batch code requirement implemented, but later DEC-FIN-014 creation-at-registration/visibility-after-payment and one-active-code requirement not delivered by admin batches. DEC-FIN-029 reusable-vs-single-use remains open; schema currently one redeem per code.

## Website/layout/character/legal/privacy/public pages

### WEB-001: live_verified

- Source tab: t.ap7ec9ua9oii
- Requirement: Long landing addresses clients and experts; sections about/client/expert/tariffs/FAQ/contact/footer. Duplicates tabs12/15.
- Source excerpt: Ориентировать на две аудитории
- Code evidence: apps/web/src/landing-view.ts:38; apps/web/src/landing-view.ts:51; apps/web/src/landing-view.ts:56; apps/web/src/landing-view.ts:62; apps/web/src/landing-view.ts:70; apps/web/src/landing-view.ts:75; apps/web/src/landing-view.ts:77; apps/web/src/landing-view.ts:79
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:60
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-002: live_verified

- Source tab: t.ap7ec9ua9oii
- Requirement: Messenger visual language with avatar, question/answer bubbles and problem/solution/CTA modules; duplicates12/15.
- Source excerpt: диалоговые окошки как в мессенджере
- Code evidence: apps/web/src/landing-view.ts:52; apps/web/src/landing-view.ts:63
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:113
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-003: live_verified

- Source tab: t.9qebhz97ctps
- Requirement: Exact hero greeting, development-navigation tagline and portrait; duplicates10/15.
- Source excerpt: Привет, я ии-Тоня 👋
- Code evidence: apps/web/src/content.ts:7; apps/web/src/landing-view.ts:44; apps/web/src/landing-view.ts:47
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:113
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-004: missing

- Source tab: t.9qebhz97ctps
- Requirement: Client CTA starts free messenger trial with «тест клиент», duplicated10/15.
- Source excerpt: Попробовать бесплатно
- Code evidence: apps/web/src/landing-view.ts:45; apps/web/src/content.ts:44
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:155
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: CTA now opens account; trial/dialogue workflow not available. Fresh CLIENT_TELEGRAM_INGRESS_ENABLED=false, CLIENT_HYBRID_ROUTING_ENABLED=false.

### WEB-005: code_only

- Source tab: t.ap7ec9ua9oii
- Requirement: Separate expert entry and personal-tariff CTA, duplicated12/15; link is only entry, not completed onboarding.
- Source excerpt: промокод “тест эксперт”
- Code evidence: apps/web/src/landing-view.ts:67; apps/web/src/messenger-link.ts:10; packages/application/src/test-expert-telegram-service.ts:5
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:98
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Telegram deep links exist; test-expert sellingActivation inactive. End-to-end qualification, publication and paid entry not established.

### WEB-006: missing

- Source tab: t.9qebhz97ctps
- Requirement: Always-available personalized dialogue, matching request/budget/location, expert selection and alternative after dissatisfaction; duplicated15.
- Source excerpt: Я работаю 24/7 и всегда на связи
- Code evidence: apps/api/src/server.ts:413; apps/web/src/content.ts:16; apps/web/src/content.ts:191
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Conversation service disabled and LLM/SELARTI/client ingress flags false; active services/readiness do not prove dialogue availability.

### WEB-007: live_verified

- Source tab: t.9qebhz97ctps
- Requirement: Display all seven disciplines, duplicated15.
- Source excerpt: Я разбираюсь в направлениях
- Code evidence: apps/web/src/content.ts:26; apps/web/src/landing-view.ts:57
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:124
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-008: live_verified

- Source tab: t.9qebhz97ctps
- Requirement: Twenty accessible expandable FAQ answers, duplicated10/15.
- Source excerpt: не более 20
- Code evidence: apps/web/src/landing-view.ts:16; apps/web/src/content.ts:113
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:27
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-009: conflict

- Source tab: t.9qebhz97ctps
- Requirement: FAQ referral says both parties receive500 at registration; amended by offer13/22 to referrer only after first payment.
- Source excerpt: За каждого нового клиента
- Code evidence: apps/web/src/content.ts:139
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:127
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Source timing conflict; current public copy correctly discloses inactive V2 coupons but requirement is not delivered.

### WEB-010: conflict

- Source tab: t.9qebhz97ctps
- Requirement: Expert benefit claims exemption from advertising labels; duplicated15.
- Source excerpt: Без маркировки рекламы
- Code evidence: apps/web/src/content.ts:66; apps/web/src/landing-view.ts:66
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:133
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Current boundary requires compliance rather than categorical exemption. Preserve deliberate amended copy; no legal compliance conclusion is made by this audit.

### WEB-011: conflict

- Source tab: t.ss4qakhqg9fe
- Requirement: Expert immediate-client and 2–3-day arrival promises must agree with later no-guarantee offer22.
- Source excerpt: Ты получаешь клиентов сразу
- Code evidence: apps/web/src/content.ts:164; apps/web/src/content.ts:175; apps/web/src/landing-view.ts:66
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:80
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Live expert FAQ still promises immediate clients while boundary says no guarantees. Inventory experts/services/slots all0; do not fabricate providers.

### WEB-012: missing

- Source tab: t.9qebhz97ctps
- Requirement: Working callback form accepts telephone/Telegram/WhatsApp and creates manager follow-up; duplicated10/15.
- Source excerpt: перезвоним или напишем в течение 24 часов
- Code evidence: apps/web/src/landing-view.ts:77; apps/web/src/content.ts:197
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:142
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Form explicitly disabled and does not send data; mailto/tel are alternatives, not callback workflow. No SLA handling evidence.

### WEB-013: missing

- Source tab: t.ap7ec9ua9oii
- Requirement: Functional Telegram/VK/Instagram/WhatsApp footer links, duplicated12/15.
- Source excerpt: Иконки соцсетей
- Code evidence: apps/web/src/landing-view.ts:79; apps/web/src/content.ts:195
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:136
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Rendered labels say link coming soon, no actual social targets/icons. Approved social destinations needed.

### WEB-014: live_verified

- Source tab: t.ss4qakhqg9fe
- Requirement: Footer legal identity,2026 copyright, navigation and links to offer/privacy.
- Source excerpt: ИП Кравцова Т.М. ОГРНИП 326680000031840
- Code evidence: apps/web/src/landing-view.ts:79; apps/web/src/content.ts:200
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:43
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-015: live_verified

- Source tab: t.9qebhz97ctps
- Requirement: Scroll reveal via IntersectionObserver and reduced-motion fallback.
- Source excerpt: Плавное появление блоков
- Code evidence: apps/web/src/main.ts:63
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No fresh browser execution; static implementation matches published commit.

### WEB-016: missing

- Source tab: t.9qebhz97ctps
- Requirement: Hero typing animation.
- Source excerpt: Анимация печати в первом экране
- Code evidence: apps/web/src/main.ts:63; apps/web/src/landing-view.ts:44
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Only reveal animation found in main.ts/styles; no typing implementation.

### WEB-017: code_only

- Source tab: t.9qebhz97ctps
- Requirement: Button hover feedback and rounded controls.
- Source excerpt: Ховеры на кнопках
- Code evidence: apps/web/src/styles.css:18
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Styles exist; this audit did not execute browser interaction.

### WEB-018: conflict

- Source tab: t.9qebhz97ctps
- Requirement: Responsive vertical mobile columns, max-width1200px, font minima16px desktop/14px mobile.
- Source excerpt: до 768px
- Code evidence: apps/web/src/styles.css:1281; apps/web/src/styles.css:1385; apps/web/src/styles.css:1397
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:48
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Responsive code uses900/640 breakpoints; some labels0.68rem below specified minimum. Prior mobile no-overflow evidence is not exact all-width/font acceptance.

### WEB-019: live_verified

- Source tab: t.9qebhz97ctps
- Requirement: One main H1, section H2, title/description/keywords.
- Source excerpt: H1 — только на первом экране
- Code evidence: apps/web/src/landing-view.ts:44; apps/web/index.html:6; apps/web/index.html:25
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:13
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Meta description omits source CTA; core tags/heading structure present.

### WEB-020: live_verified

- Source tab: t.9qebhz97ctps
- Requirement: Single CSS/module bundle and optimized WebP images.
- Source excerpt: Картинки — оптимизированные
- Code evidence: apps/web/src/landing-view.ts:47; apps/web/index.html:35
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:28
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-021: conflict

- Source tab: t.9qebhz97ctps
- Requirement: Suggested body/display font pair and Google Fonts delivery.
- Source excerpt: Шрифты — подключены через Google Fonts
- Code evidence: apps/web/src/styles.css:23; apps/web/src/styles.css:89
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:150
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: CSS uses Inter fallback/Georgia; no Google Fonts and test excludes network fonts. Later23/24 amend typography to Montserrat/Inter; font files/licensing unproven.

### WEB-022: code_only

- Source tab: t.fk4ujag8rsrk
- Requirement: Warm wise30–40 female character, meaningful neutral background; duplicates10/12 and refined24.
- Source excerpt: женский , возраст 30-40 лет
- Code evidence: apps/web/src/landing-view.ts:47; docs/design/ii-tonya-logo-character-brief.md:23
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:40
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Current hero visually inspected: detailed warm brunette portrait on neutral warm path background fits early direction. Exact owner age/expression approval not supplied; later brand character remains separate.

### WEB-023: conflict

- Source tab: t.fk4ujag8rsrk
- Requirement: Palette alternatives and selection;12 adds eco/lavender/blue;23/24 add four brand palettes.
- Source excerpt: Нейтральный, теплый, холодный. Выберем.
- Code evidence: apps/web/src/styles.css:1; docs/design/ii-tonya-logo-character-brief.md:65
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: DEC-EXP-005 accepted current paper/terracotta/forest landing on2026-09-17; brief/inventory still call decision OPEN. Four brand alternatives remain undelivered.

### WEB-024: live_verified

- Source tab: t.r035r9k76zot
- Requirement: Publish full offer with13 sections, operator requisites and21-Aug-2026 effective date; revised by22.
- Source excerpt: https://ii-tonya.ru/oferta
- Code evidence: apps/web/src/legal/oferta.txt:1; apps/web/src/legal/oferta.txt:28; apps/web/src/legal-view.ts:38
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:5; apps/web/src/legal-content.test.ts:44
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Confirms older offer publication only, not replacement22 completeness.

### WEB-025: conflict

- Source tab: t.29qw4u2w9d
- Requirement: Replace public offer with latest9-section B2C/B2B/rental/promotion/refund revision, applying subsequent accepted decisions rather than blind overwrite.
- Source excerpt: ПУБЛИЧНАЯ ОФЕРТА
- Code evidence: apps/web/src/legal/oferta.txt:1; apps/web/src/legal/oferta.txt:37; apps/web/src/legal/oferta.txt:345
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:9
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Published source remains patched older13-section offer; tests enforce that older structure. New participant/promotion/refund clauses not fully propagated; publication date placeholder needs versioning.

### WEB-026: live_verified

- Source tab: t.r035r9k76zot
- Requirement: Public informational-service boundary; no medical/psychological/legal advice and expert-service contract separate.
- Source excerpt: не психологом, врачом или коучем
- Code evidence: apps/web/src/legal/oferta.txt:91; apps/web/src/legal/oferta.txt:94; apps/web/src/landing-view.ts:53
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:63
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-027: conflict

- Source tab: t.r035r9k76zot
- Requirement: Actual supported messenger channels and legal notifications;22 narrows to Telegram/VK/Max.
- Source excerpt: Telegram, VK, WhatsApp, Viber, Макс
- Code evidence: apps/web/src/legal/oferta.txt:79; apps/web/src/messenger-link.ts:10
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Public offer still lists5 channels while replacement lists3. Inspected deployed entry is Telegram; no evidence of operational VK/Max/WhatsApp/Viber journeys. Client Telegram ingress disabled.

### WEB-028: uncertain

- Source tab: t.r035r9k76zot
- Requirement: Contract acceptance via registration/dialogue/payment or expert application;22 adds checkbox/free usage.
- Source excerpt: Акцептом Оферты признаётся
- Code evidence: apps/web/src/legal/oferta.txt:103; apps/web/src/legal/policy.txt:274
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Public contract text exists; version-bound offer acceptance proof across all entry/payment paths not established. Privacy consent evidence is not offer acceptance.

### WEB-029: code_only

- Source tab: t.29qw4u2w9d
- Requirement: 18+ eligibility, self-declaration under accepted repository decision.
- Source excerpt: достигшим 18 лет
- Code evidence: apps/web/src/legal/oferta.txt:128; apps/web/src/legal/policy.txt:152
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Public text present; authenticated adult gate acceptance not established by fresh session-enabled flag.

### WEB-030: conflict

- Source tab: t.r035r9k76zot
- Requirement: Intro80–100 non-expiring, paid500/1000/1500/2000 for60days; duplicates12/15.
- Source excerpt: 80 до 100 сообщений
- Code evidence: apps/web/src/legal/oferta.txt:146; apps/web/src/content.ts:35
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:69
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: DEC-FIN-002 resolves intro100/paid60days;22 demands30days. Preserve historical cohorts. Public future terms deployed; purchase unavailable with PAYMENTS_ENABLED=false.

### WEB-031: conflict

- Source tab: t.29qw4u2w9d
- Requirement: Amended paid package30-day validity while intro remains unlimited.
- Source excerpt: Срок действия Абонемента составляет **30 календарных дней**
- Code evidence: apps/web/src/legal/oferta.txt:153
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:71
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Superseded by accepted DEC-FIN-00260-day decision; not silently implemented as30days. Runtime sale still off.

### WEB-032: conflict

- Source tab: t.r035r9k76zot
- Requirement: Debit every inbound/outbound/system/button/audio message; repeated22.
- Source excerpt: включая сервисные уведомления, напоминания, кнопки и аудиосообщения
- Code evidence: packages/domain/src/billing.ts:19; apps/web/src/legal/oferta.txt:140
- Test references (not fresh execution): packages/domain/src/billing.test.ts:14
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Domain/test intentionally charge ordinary inbound/outbound only and exempt system/safety/error; public all-message wording contradicts executable charging. Resolve with finance coordinator.

### WEB-033: code_only

- Source tab: t.r035r9k76zot
- Requirement: Spend soonest-expiring package first, expire unpaid balance without negative balances.
- Source excerpt: наиболее близким сроком окончания
- Code evidence: packages/domain/src/billing.ts:38
- Test references (not fresh execution): packages/domain/src/billing.test.ts:22; packages/domain/src/billing.test.ts:31
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Pure ordering logic exists (intro last); no live paid billing workflow acceptance.

### WEB-034: uncertain

- Source tab: t.r035r9k76zot
- Requirement: Notify once three days before paid-package expiry.
- Source excerpt: за 3 дня до истечения срока
- Code evidence: apps/web/src/legal/oferta.txt:153
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Promise present; focused reminder/worker searches did not establish package-expiry scheduler and delivery. Slot reminder decision is not package-expiry evidence.

### WEB-035: missing

- Source tab: t.r035r9k76zot
- Requirement: Client coupon grant x2 cash payment,1coupon=1RUB internal/nontransferable/no cash-out; duplicates12/15.
- Source excerpt: в размере х2 от суммы оплаты
- Code evidence: apps/web/src/legal/oferta.txt:165; apps/web/src/content.ts:42
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:78
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Client coupon mechanism explicitly off. Expert referral credit is separate and must not count as implementation.

### WEB-036: conflict

- Source tab: t.r035r9k76zot
- Requirement: Original coupon90-day validity and nonreturn on cancellation.
- Source excerpt: 90 календарных дней
- Code evidence: apps/web/src/legal/oferta.txt:49
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:77
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Amended22 and DEC-FIN-005 use45days for new coupons; cohort/cancellation semantics require explicit versioned implementation, not text substitution.

### WEB-037: conflict

- Source tab: t.29qw4u2w9d
- Requirement: Fixed1000/2000/3000/4000 coupon grants for respective paid packages, zero intro grant.
- Source excerpt: 1 000 купонов
- Code evidence: apps/web/src/legal/oferta.txt:165
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:78
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: DEC-FIN-003 selects x2 formula and owner prices4999/5999/7999/10990, superseding fixed grants. No active issuance.

### WEB-038: missing

- Source tab: t.29qw4u2w9d
- Requirement: Coupons45days/FIFO and expert-defined20–50% service cap.
- Source excerpt: по принципу FIFO
- Code evidence: apps/web/src/legal/oferta.txt:49; packages/domain/src/expert-referral.ts:90
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Expert-credit allocator is NOT client coupons. Client coupon grant/redemption ledgers and booking integration not found in inspected domain/application/schema paths; live mechanism off.

### WEB-039: missing

- Source tab: t.r035r9k76zot
- Requirement: Client referral code unlimited lifetime; invitee500 on registration/referrer500 after first payment; reverse on refund.22 repeats delayed referrer reward.
- Source excerpt: формат: promo_XXXX
- Code evidence: apps/web/src/content.ts:139
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:81
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Current FAQ says referral coupons disabled. Separate client attribution/reward/refund workflow not established.

### WEB-040: missing

- Source tab: t.r035r9k76zot
- Requirement: Paid-client coupon balance, closed events, new experts, current slots and priority booking.
- Source excerpt: закрытых мероприятиях
- Code evidence: apps/web/src/content.ts:132; apps/web/src/content.ts:136
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Package balance readout alone is not this privilege bundle. No real experts/services/slots; booking creation/payment disabled.

### WEB-041: code_only

- Source tab: t.r035r9k76zot
- Requirement: Find real expert/event availability with minimum24h lead, chosen date/time/format/location.
- Source excerpt: не менее 24 часов
- Code evidence: packages/application/src/booking-service.ts:101; apps/api/src/server.ts:416
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:7
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Booking logic exists; provider workflow unwired/disabled. Local Planerka690797db58offline tests are not deployed. CLIENT_BOOKING_ENABLED=true permits reads, reserve flagfalse.

### WEB-042: conflict

- Source tab: t.r035r9k76zot
- Requirement: Reservation72h with expert confirm/cancel/reschedule and client confirmation address/link.
- Source excerpt: резервируется за Клиентом на 72 часа
- Code evidence: packages/domain/src/reservation.ts:23; packages/application/src/booking-service.ts:113
- Test references (not fresh execution): packages/domain/src/reservation.test.ts:5; packages/application/src/booking-service.test.ts:23
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Code caps at earlier72h or slot-minus-buffer; source allows24h slots yet promises full72h. Confirm/cancel logic exists; reschedule/real provider delivery not established.

### WEB-043: code_only

- Source tab: t.r035r9k76zot
- Requirement: Expire unanswered reservation, notify client with alternate/waitlist option.
- Source excerpt: резерв автоматически снимается
- Code evidence: packages/domain/src/reservation.ts:9; packages/worker/src/reservation-expiry.ts:1
- Test references (not fresh execution): packages/domain/src/reservation.test.ts:65
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Expiry logic exists; no live reserve or provider confirmation workflow. Notification/alternative composition not established.

### WEB-044: missing

- Source tab: t.r035r9k76zot
- Requirement: Waitlist when full; automatically reserve first freed slot72h and notify.
- Source excerpt: лист ожидания
- Code evidence: packages/application/src/booking-service.ts:101
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No waitlist handling found in inspected booking/worker searches; reservation primitives do not implement admission/promotion.

### WEB-045: code_only

- Source tab: t.r035r9k76zot
- Requirement: Cancel via chat; coupon nonreturn rule.
- Source excerpt: Клиент может отменить запись
- Code evidence: packages/domain/src/reservation.ts:15; packages/application/src/booking-service.ts:50
- Test references (not fresh execution): packages/domain/src/reservation.test.ts:65
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Cancellation state machine exists; chat disabled, client coupon accounting absent. Do not conflate local cancellation with provider cancellation.

### WEB-046: uncertain

- Source tab: t.r035r9k76zot
- Requirement: 2-day/1-day/1-hour booking reminders with address/link; earlier12/15 mention only1day/1hour.
- Source excerpt: За 2 дня до встречи
- Code evidence: apps/web/src/content.ts:132
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No operational reminder scheduler/delivery evidence. Link visibility also constrained by later privacy rules; preserve timing amendment.

### WEB-047: code_only

- Source tab: t.r035r9k76zot
- Requirement: Optional feedback, positive-public/negative-admin-only moderation.
- Source excerpt: Предоставление обратной связи является добровольным
- Code evidence: packages/application/src/feedback-service.ts:20; packages/db/src/repositories/feedback-repository.ts:66
- Test references (not fresh execution): tests/integration/feedback-transaction.test.ts:34
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Transactional negative-feedback logic exists. Positive-publication consent, post-visit invitation and live moderation delivery not established.

### WEB-048: conflict

- Source tab: t.r035r9k76zot
- Requirement: Weekly optional mood/body/insight/gratitude check-ins and history; duplicates12/15.
- Source excerpt: еженедельные мини-опросы
- Code evidence: apps/web/src/legal/policy.txt:102; apps/web/src/legal/policy.txt:248; apps/web/src/content.ts:188
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: DEC-PLT-004/EXP-006 prohibit persistent state history and retain only ephemeral in-session check-ins. Public FAQ says unavailable; source must not justify sensitive storage.

### WEB-049: conflict

- Source tab: t.r035r9k76zot
- Requirement: Blanket unused-message/coupon nonrefund on exit versus later22 actual-cost refund rule.
- Source excerpt: не возвращаются и не компенсируются
- Code evidence: apps/web/src/legal/oferta.txt:279
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Published blanket text remains; later22 partial refund/actual incurred costs not propagated. Payment settlement/reversal substrate is not customer refund-policy acceptance.

### WEB-050: code_only

- Source tab: t.r035r9k76zot
- Requirement: Expert trial/application, competence review, onboarding3000, repeat only after>3months;22 extends all residents.
- Source excerpt: разовый платёж 3 000
- Code evidence: packages/application/src/test-expert-telegram-service.ts:5; apps/web/src/legal/oferta.txt:297
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Technical trial/quotation exists, commercial activation inactive. No demonstrated end-to-end administrative qualification→publication→billing for all resident types. Empty inventory alone is not proof of missing onboarding.

### WEB-051: uncertain

- Source tab: t.r035r9k76zot
- Requirement: Publish expert within1–3 business days, paid period not extended; verify qualifications, maintain current services/prices/slots.
- Source excerpt: 1–3 рабочих дня
- Code evidence: apps/web/src/legal/oferta.txt:478
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No operational SLA/queue or authentic expert acceptance evidence; current real inventory0. Source12/15 alternatively promises2–3days.

### WEB-052: conflict

- Source tab: t.r035r9k76zot
- Requirement: Base12000/exclusive20000, unlimited individual services and1group≤20; personalised -1000 low-check/+5000 city/+3000 online.
- Source excerpt: от 12 000
- Code evidence: apps/web/src/content.ts:77; packages/db/src/repositories/test-expert-pricing-policy.ts:17
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Public old tariffs conflict with accepted DEC-FIN-007 V2 START3900/BASE5900/PRO9990 (docs/superpowers/implementation-artifacts/fin-expert-pricing-policy.md:12). Calculator reads authoritative V2; public claims not executable prices.

### WEB-053: conflict

- Source tab: t.r035r9k76zot
- Requirement: Original weekly entry ladder8000/9000/10000/12000, continuous-price lock, repricing after>3months.
- Source excerpt: 1–7 дней
- Code evidence: apps/web/src/legal/oferta.txt:342; packages/db/src/repositories/test-expert-pricing-policy.ts:17
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Later22 replaces ladder with percentage campaign; DEC-FIN-007 keeps V2. No reviewed composition of time-based discount with V2 runtime demonstrated.

### WEB-054: conflict

- Source tab: t.r035r9k76zot
- Requirement: One month maximum prepayment versus22 three-month Start.
- Source excerpt: не может составлять более чем 30
- Code evidence: apps/web/src/legal/oferta.txt:345
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Published offer still forbids>30days; later22 explicitly allows3months. Resolve accepted policy/order before sale.

### WEB-055: code_only

- Source tab: t.r035r9k76zot
- Requirement: One included group≤20; extra groups10% resident or15%+4500 nonresident,30% advance/70% final, report and five-business-day invoice.
- Source excerpt: 10% от выручки
- Code evidence: packages/domain/src/partner-pricing.ts:23; apps/web/src/content.ts:103
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:64
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Rate constants/public prose exist; attendance/revenue/entitlement consumption/settlement and invoice/report delivery not established. Distinguish missing workflow from existing arithmetic metadata.

### WEB-056: conflict

- Source tab: t.r035r9k76zot
- Requirement: No guaranteed attendance/income, specialist owns service quality, current info and72h booking decisions.
- Source excerpt: Срок и полнота набора
- Code evidence: apps/web/src/landing-view.ts:66; apps/web/src/content.ts:164; apps/web/src/legal/oferta.txt:94
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:80
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Boundary published but expert FAQ still promises immediate clients. Operational expert response delivery unavailable.

### WEB-057: uncertain

- Source tab: t.r035r9k76zot
- Requirement: Expert referral permanent unlimited reusable code issued at first onboarding;22 issues immediately at registration.
- Source excerpt: 5.6.2.
- Code evidence: apps/web/src/legal/oferta.txt:407
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Public promise exists; code generation timing/reuse/one-active-code requires finance audit, not inferred from expert ledger. New resident kinds not proved.

### WEB-058: code_only

- Source tab: t.r035r9k76zot
- Requirement: Once1000expert reward after new expert questionnaire+onboarding+first month payment, credit≤3business days; no trial/previous registration/other referrer/refund≤30days.
- Source excerpt: 1 000 (Одна тысяча) бонусов
- Code evidence: packages/domain/src/expert-referral.ts:147; packages/db/src/repositories/expert-residency-repository.ts:332
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:71
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Expert financial substrate exists; exact eligibility/maturity allocation delegated finance. No live payment/provider flags, therefore no live reward proof.

### WEB-059: code_only

- Source tab: t.r035r9k76zot
- Requirement: Resident approved credit≤30%, own consent, no cash-out/transfer; one-year expiry and reversal debt.
- Source excerpt: не более 30%
- Code evidence: packages/domain/src/expert-referral.ts:63; packages/domain/src/expert-referral.ts:142; packages/db/src/repositories/expert-residency-repository.ts:332
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:20; packages/domain/src/expert-referral.test.ts:65
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Parameterized cap+expiry/reversal logic exists; default helper50% is overridden by tariff cap, not automatically a defect. Live consented redemption absent.

### WEB-060: uncertain

- Source tab: t.r035r9k76zot
- Requirement: Expert bonus expiry notices14/7days and refund debt notice payable within5business days.
- Source excerpt: за 14 и 7 дней
- Code evidence: apps/web/src/legal/oferta.txt:439
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Expiry/reversal pure logic does not establish timed notification and debt-collection workflow; no fresh live evidence.

### WEB-061: code_only

- Source tab: t.r035r9k76zot
- Requirement: Resident bonus-account readout on demand.
- Source excerpt: информацию о состоянии своего бонусного счёта
- Code evidence: packages/application/src/expert-telegram-query-service.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Read service exists; no authenticated production expert financial-view acceptance supplied.

### WEB-062: uncertain

- Source tab: t.r035r9k76zot
- Requirement: Expert termination/price-change notices10business days, suspension for false info/complaints; force-majeure notice5business days, dispute response10business days.
- Source excerpt: за 10 рабочих дней
- Code evidence: apps/web/src/legal/oferta.txt:641; apps/web/src/legal/oferta.txt:67
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Contract prose exists, operational notice/complaint timers and delivered receipts not demonstrated. No legal enforceability assessment.

### WEB-063: live_verified

- Source tab: t.r035r9k76zot
- Requirement: IP/service-use restrictions and expert-media permission, force majeure/provider outage, severability/Russian jurisdiction clauses and operator bank requisites.
- Source excerpt: Все права на Сервис
- Code evidence: apps/web/src/legal/oferta.txt:581; apps/web/src/legal-content.ts:19
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:9; apps/web/src/legal-content.test.ts:44
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Publication only; no inference that all artwork licenses or contractual rights are established.

### WEB-064: code_only

- Source tab: t.29qw4u2w9d
- Requirement: Four resident types with qualification prerequisite and common onboarding.
- Source excerpt: Эксперт, Тренинговый центр/Студия, Организатор мероприятий или Владелец пространства
- Code evidence: packages/domain/src/partner-pricing.ts:1; packages/application/src/test-expert-telegram-service.ts:11
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: EXPERT/CENTER/ORGANIZER types exist; rental not in PartnerParticipantKind. Need authentic administrative verification, not treating organization row marked verified as proof.

### WEB-065: conflict

- Source tab: t.29qw4u2w9d
- Requirement: Center15000→12000→8000 at<5/5–9/≥10, ten≤30 events; organizer20000→15000→10000 with5×50/3×100/1×500.
- Source excerpt: 5–9 экспертов: 12 000
- Code evidence: packages/domain/src/partner-pricing.ts:71; packages/domain/src/partner-pricing.ts:76; packages/db/src/repositories/partner-commerce-repository.ts:101
- Test references (not fresh execution): packages/domain/src/partner-pricing.test.ts:41
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Pure tier/entitlement calculation exists but starts6 not5 (accepted DEC-FIN-012); createShadowQuote hardcodes qualified count0. Policy test fixture prices are not approved live tariffs; no entitlement consumption.

### WEB-066: missing

- Source tab: t.29qw4u2w9d
- Requirement: Rental500/1000/3000/5000/8000/>10000 slots at5000/8000/10000/12000/15000/custom;30-day expiry.
- Source excerpt: Пакетов слотов бронирования на 30 дней
- Code evidence: packages/domain/src/partner-pricing.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No rental commerce implementation found in domain/application/schema/file searches; >8000≤10000 pricing and slot counting semantics also unspecified.

### WEB-067: uncertain

- Source tab: t.29qw4u2w9d
- Requirement: Pause/archive≤3months without fee;>3months delete and renewed3000 onboarding across resident types.
- Source excerpt: При перерыве до 3 месяцев карточка архивируется
- Code evidence: apps/web/src/legal/oferta.txt:478; apps/web/src/content.ts:159
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Copy exists; automated archival/reactivation/deletion billing not established. Exactly3months must be explicit, and retention exceptions preserved.

### WEB-068: missing

- Source tab: t.29qw4u2w9d
- Requirement: Energy Start40/30/20/0 at days1–3/4–6/7–9/>9, rental20/10 at first two windows.
- Source excerpt: Скидка 40%
- Code evidence: packages/db/src/repositories/test-expert-pricing-policy.ts:17
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No executable campaign/window calculator found in searched domain/application/schema. V2 tariff lookup does not implement these discounts.

### WEB-069: conflict

- Source tab: t.29qw4u2w9d
- Requirement: Start3months: additional15% stage1/10% stage2, unavailable later.
- Source excerpt: дополнительная скидка 15%
- Code evidence: apps/web/src/legal/oferta.txt:345
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Not composed in runtime; conflicts current public30-day max and finance policy order. Preserve as amended unmet requirement.

### WEB-070: conflict

- Source tab: t.29qw4u2w9d
- Requirement: Final monthly floor5000; reaching floor suppresses extra Start discount.
- Source excerpt: не может быть ниже **5 000 рублей**
- Code evidence: packages/db/src/repositories/test-expert-pricing-policy.ts:17
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Current V2 START3900 contradicts universal floor; finance policy doc:36 also states floor before Start, potentially allowing below-floor final price. No implementation of final floor located.

### WEB-071: missing

- Source tab: t.29qw4u2w9d
- Requirement: Promo and bonus nonstacking: defer bonus use3months for promo entrant; immediate for full-price; rental cap10%, others30%.
- Source excerpt: только **после окончания акционного периода**
- Code evidence: packages/domain/src/expert-referral.ts:63
- Test references (not fresh execution): packages/domain/src/expert-referral.test.ts:20
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Cap primitive exists but promo eligibility/3month hold/rental policy not established. Parameterized quote alone is not this workflow.

### WEB-072: code_only

- Source tab: t.29qw4u2w9d
- Requirement: Service must not collect customer payments for expert services; only platform subscriptions/residency.
- Source excerpt: Клиент оплачивает услуги Эксперта напрямую Эксперту
- Code evidence: apps/web/src/legal/oferta.txt:94; packages/application/src/expert-residency-service.ts:1
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Platform residency payment path is distinct; all payments presently off. Old offer permits payment through service, so public boundary needs alignment.

### WEB-073: conflict

- Source tab: t.29qw4u2w9d
- Requirement: Prepublication refund less actual incurred costs,3000 onboarding only if competence check completed.
- Source excerpt: фактически понесенные расходы
- Code evidence: apps/web/src/legal/oferta.txt:279
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Current blanket nonrefund text persists; no customer-facing verified cost calculation/receipt/appeal workflow established.

### WEB-074: live_verified

- Source tab: t.x5yqcmuqgki5
- Requirement: Public17-section privacy policy, scope visitors/clients/experts/contact applicants and operator identity/requisites.
- Source excerpt: https://ii-tonya.ru/privacy
- Code evidence: apps/web/src/legal/policy.txt:13; apps/web/src/legal/policy.txt:25; apps/web/src/legal/policy.txt:65; apps/web/src/legal-view.ts:38
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:18; apps/web/src/legal-view.test.ts:5
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining:

### WEB-075: conflict

- Source tab: t.x5yqcmuqgki5
- Requirement: Source use/start/payment/form implicit consent and13 acceptance-based indefinite consent.
- Source excerpt: выражает своё согласие
- Code evidence: apps/web/src/legal/policy.txt:37; apps/web/src/legal/policy.txt:274; apps/web/src/legal/oferta.txt:656
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:28
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Explicitly superseded by accepted DEC-PLT-004 and separate-purpose consent; do not regress to implicit blanket consent or revive source wording.

### WEB-076: conflict

- Source tab: t.x5yqcmuqgki5
- Requirement: Source client full name/age/sex/DOB/family/interests/skills/location/history;13 mirrors this.
- Source excerpt: история запросов и состояний
- Code evidence: apps/web/src/legal/policy.txt:144; apps/web/src/legal/policy.txt:152; apps/web/src/legal/policy.txt:248; apps/web/src/legal/oferta.txt:128
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Later accepted minimization forbids age/DOB/family/state persistence and third-party/sensitive data. Source inventory is not authorization to add forbidden columns.

### WEB-077: code_only

- Source tab: t.x5yqcmuqgki5
- Requirement: Expert identity/contact/qualification/services/social/payment/referral data for stated purposes.
- Source excerpt: квалификация и образование (дипломы, сертификаты)
- Code evidence: apps/web/src/legal/policy.txt:158; packages/db/src/repositories/partner-commerce-repository.ts:79
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Public amendment stores qualification verification details, not copies. No real expert rows or audited administrative verification completion; direct verified-state upsert alone not competence evidence.

### WEB-078: conflict

- Source tab: t.x5yqcmuqgki5
- Requirement: Website analytics and cookies; source says cookies cannot identify and use implies consent.
- Source excerpt: статистический анализ посещаемости
- Code evidence: apps/web/src/legal/policy.txt:175; apps/web/src/legal/policy.txt:280
- Test references (not fresh execution): apps/web/src/landing-view.test.ts:142
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Current privacy requires separate analytics consent and necessary-cookie boundary; no tracking in inspected landing. Non-identifying-all-cookies/implicit-consent text must not be reinstated.

### WEB-079: code_only

- Source tab: t.x5yqcmuqgki5
- Requirement: Purpose limitation/accuracy/minimization and client/expert lifecycle retention; visitor form≤1year and browser-cookie lifetime.
- Source excerpt: не дольше, чем этого требуют цели
- Code evidence: apps/web/src/legal/policy.txt:184; apps/web/src/legal/policy.txt:244; apps/web/src/legal/policy.txt:261; packages/worker/src/data-retention.ts:45
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Generic retention worker exists, but complete policy-class scheduler/processor/backup compliance not demonstrated. Form currently off; no need to invent contact data.

### WEB-080: code_only

- Source tab: t.x5yqcmuqgki5
- Requirement: Destroy/anonymize after retention and termination.
- Source excerpt: уничтожаются или обезличиваются
- Code evidence: packages/worker/src/data-retention.ts:45; packages/worker/src/privacy-erasure.ts:26; apps/api/src/server.ts:442
- Test references (not fresh execution): packages/worker/src/privacy-erasure.test.ts:338
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Physical erasure lacks runtime composition/real processor and backup evidence; fresh CLIENT_ERASURE_REQUESTS_ENABLED=false. Request/status primitives are not completed erasure.

### WEB-081: code_only

- Source tab: t.x5yqcmuqgki5
- Requirement: Separate expert handoff consent, minimum necessary named recipient data, purpose-specific sharing and revocation.
- Source excerpt: дают отдельное согласие на передачу
- Code evidence: apps/web/src/legal/policy.txt:278; apps/web/src/legal/policy.txt:303; packages/application/src/booking-service.ts:80
- Test references (not fresh execution): packages/application/src/booking-service.test.ts:52
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Consent/read-boundary code exists; recipient/reservation-scoped authenticated live handoff acceptance not established. Booking reserve/Planerka off.

### WEB-082: uncertain

- Source tab: t.x5yqcmuqgki5
- Requirement: RF-local personal-data persistence, processor agreements, no unproven cross-border transfer; third-party payment/state disclosure limited.
- Source excerpt: не осуществляет трансграничную передачу
- Code evidence: apps/web/src/legal/policy.txt:322; apps/web/src/legal/policy.txt:325
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Fresh external flagsfalse supports fail-closed boundary but does not prove hosting/backup region, contracts or all data locations. Stale go-live documents cannot certify current legal/processor compliance.

### WEB-083: code_only

- Source tab: t.x5yqcmuqgki5
- Requirement: Access/export and consent review/withdrawal through service.
- Source excerpt: на доступ к своим персональным данным
- Code evidence: packages/application/src/privacy-service.ts:164; apps/api/src/server.ts:426
- Test references (not fresh execution): apps/api/src/routes/client-privacy.test.ts:225; apps/api/src/routes/client-privacy.test.ts:243
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Fresh CLIENT_PRIVACY_ENABLED and CLIENT_SESSION_ENABLED true; authenticated production export/withdrawal acceptance not supplied. Static page/flag is insufficient.

### WEB-084: code_only

- Source tab: t.x5yqcmuqgki5
- Requirement: Rectification, blocking, deletion, appeal and withdrawal via dialogue/email/post with identity-bound request.
- Source excerpt: на уточнение, блокирование или уничтожение
- Code evidence: apps/web/src/legal/policy.txt:334; apps/web/src/legal/policy.txt:347; apps/api/src/server.ts:444
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Email/post contacts published; self-service correction/blocking not established; chat unavailable and deletion requests disabled. Manual processing evidence absent.

### WEB-085: uncertain

- Source tab: t.x5yqcmuqgki5
- Requirement: Privacy-rights request response≤30days and signed written-request fields.
- Source excerpt: в течение 30 дней
- Code evidence: apps/web/src/legal/policy.txt:344
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Policy copy alone does not establish intake queue, deadline monitoring, responsible operator or responses.

### WEB-086: uncertain

- Source tab: t.x5yqcmuqgki5
- Requirement: Organizational security: accountable person, local acts, conformity-assessed protection, physical security/control.
- Source excerpt: назначение ответственных
- Code evidence: apps/web/src/legal/policy.txt:325; docs/runbooks/go-live-evidence.md:14
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No current operational certificates/appointment/physical-security evidence supplied; historical legal approval is not proof. This is an implementation/evidence audit, not legal advice.

### WEB-087: conflict

- Source tab: t.x5yqcmuqgki5
- Requirement: Policy/offer revision publication, consumer grandfathering, notifications and governing-law/severability/complaints.
- Source excerpt: без предварительного уведомления
- Code evidence: apps/web/src/legal/oferta.txt:67; apps/web/src/legal/policy.txt:37
- Test references (not fresh execution): apps/web/src/legal-content.test.ts:37
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Accepted repo wording limits retroactive deterioration and requires separate consent; original unrestricted update clause cannot override existing paid contracts. Effective date still21-Aug despite substantive amendments; versioned acceptance linkage unverified.

### WEB-088: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: Logo combining open-armed female figure and network circles/nodes; detailed living face, minimal rounded flat-gradient style; duplicated24.
- Source excerpt: Женская фигура (Тоня) с раскрытыми руками
- Code evidence: apps/web/src/landing-view.ts:37; docs/design/ii-tonya-logo-character-brief.md:17
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Actual header is text brand; no delivered logo.svg. Inspected source23 JPEG depicts open arms/network/purple-gold but featureless face contradicts written detailed-face constraint.

### WEB-089: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: Logo vector AI/EPS/SVG plus transparentPNG/JPG; recognizable16–2000px, Telegram100px sign-only and favicon32px.
- Source excerpt: AI, EPS, SVG
- Code evidence: docs/design/ii-tonya-logo-character-brief.md:44
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Only brief and hero images found, no final export family/favicon/scale acceptance. Embedded JPEG is reference, not requested vector deliverables.

### WEB-090: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: Logo main/sign-only/light/dark/monochrome variants, duplicated24.
- Source excerpt: Версия на светлом фоне
- Code evidence: docs/design/ii-tonya-logo-character-brief.md:46
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No final version set found under assets/brand or web/public.

### WEB-091: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: Four palette concepts: purple/gold, lavender/coral-or-mint, graphite/silver/white, sand/terracotta/green; HEX/RGB/CMYK and combinations.
- Source excerpt: 4 альтернативные цветовые концепции
- Code evidence: apps/web/src/styles.css:1; docs/design/ii-tonya-logo-character-brief.md:65
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Single live landing palette retained by accepted DEC-EXP-005. Brand palettes not rendered/approved; source24 narrows energetic accent to coral, preserve refinement.

### WEB-092: missing

- Source tab: t.fg5gsb581yxc
- Requirement: All four palettes preserve recognizable shape in monochrome, no acid colors.
- Source excerpt: Проверить каждый вариант на чёрно-белую версию
- Code evidence: docs/design/ii-tonya-sketch-review.md:30
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Unchecked review scaffold, no palette/monochrome visual acceptance.

### WEB-093: conflict

- Source tab: t.x4pau2gh3c9u
- Requirement: Brand name/headings Montserrat Bold/SemiBold, body/slogan Inter Regular/Medium; commercial license and small-size kerning.
- Source excerpt: Montserrat (Bold, SemiBold)
- Code evidence: apps/web/src/styles.css:23; apps/web/src/styles.css:89; docs/design/ii-tonya-logo-character-brief.md:38
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Deployed headings/brand Georgia; Inter fallback without bundled font/license evidence. Earlier12 suggested serif display fonts, later design amends.

### WEB-094: code_only

- Source tab: t.fg5gsb581yxc
- Requirement: Cyrillic lowercaseии-, uppercaseТ, no introduced spacing; slogan «Навигатор твоего роста».
- Source excerpt: «ии-Тоня»
- Code evidence: apps/web/src/landing-view.ts:37; apps/web/src/content.ts:4
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Name implemented; later exact slogan absent from current hero/logo; existing hero says personal navigator. Preserve both placements instead of silently replacing all text.

### WEB-095: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: Brandbook PDF with interactive TOC, clearspace, minmm/px, permitted/forbidden distort/stretch/shadow/outline/rotation, color/font codes.
- Source excerpt: Охранное поле
- Code evidence: docs/design/ii-tonya-logo-character-brief.md:48
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No delivered brandbook PDF or finished usage guide found; brief is not acceptance.

### WEB-096: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: Mockups for Telegram100px, website/header/favicon, expert card, presentation, social square/vertical and legal documents.
- Source excerpt: Носители (Mockups)
- Code evidence: docs/design/ii-tonya-sketch-review.md:25
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Only unfilled review checklist; no finished mockups located.

### WEB-097: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: Optional coherent icons psychology/coaching/body/yoga/esoteric/events/rental.
- Source excerpt: Иконки категорий (опционально
- Code evidence: apps/web/src/content.ts:26
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Emoji categories exist, bespoke brand icon set not located. Optional deliverable, not a production blocker by itself.

### WEB-098: missing

- Source tab: t.fg5gsb581yxc
- Requirement: Optional1080-square/1080×1920story/event/quote social templates.
- Source excerpt: Шаблоны для соцсетей (опционально)
- Code evidence: docs/design/ii-tonya-logo-character-brief.md:44
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No template deliverables found. Optional, not mandatory release gate.

### WEB-099: missing

- Source tab: t.x4pau2gh3c9u
- Requirement: 3–5 sketches in3–5business days, owner selection,2–3day revision and5–7day final brandbook.
- Source excerpt: Эскизы (3–5 вариантов)
- Code evidence: docs/design/ii-tonya-sketch-review.md:10
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Selection record remains blank; source embedded reference is not3–5 alternatives or owner approval. Deadlines lack committed start/acceptance evidence.

### WEB-100: code_only

- Source tab: t.fg5gsb581yxc
- Requirement: Character30–40 warm/wise/empathetic, recognizable face, flowing dark-purple/gold hair, tunic and golden glow consistent with logo.
- Source excerpt: длинные развевающиеся волосы
- Code evidence: apps/web/src/landing-view.ts:47; docs/design/ii-tonya-logo-character-brief.md:25
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Current hero visually inspected: warm brunette detailed face/terracotta apparel/neutral path fits early brief; no final later logo-linked stylized character acceptance. Both source23 and source24 JPEGs show the same purple/gold figure on white with a featureless face, conflicting with the written detailed-face requirement.

### WEB-101: missing

- Source tab: t.fg5gsb581yxc
- Requirement: Eight rendered poses: greeting/acceptance/navigation/reflection/joy/explanation/ecosystem/calm; distinct gestures/emotions/use contexts.
- Source excerpt: минимум 8 штук
- Code evidence: assets/brand/character/pose-inventory.json:1; docs/design/ii-tonya-logo-character-brief.md:51
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: All eight inventory entries rendered:false. Pose metadata is not delivered artwork.

### WEB-102: missing

- Source tab: t.fg5gsb581yxc
- Requirement: All eight poses in four palettes, unified line/readable100px, AI/EPS/SVG/transparentPNG;7–10business days after logo approval.
- Source excerpt: 8 поз × 4 цвета
- Code evidence: assets/brand/character/pose-inventory.json:35; docs/design/ii-tonya-sketch-review.md:12
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: No32 rendered variants/export set; owner choice and finalized assets outstanding, not just runtime activation.

### WEB-103: code_only

- Source tab: t.fg5gsb581yxc
- Requirement: Optional props phone/stars/network/calendar/heart/sprout/QR while avoiding robot/chip/cliche/overdetail/acid imagery.
- Source excerpt: телефон/мессенджер, звёзды/искры
- Code evidence: assets/brand/character/pose-inventory.json:15
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Constraints inventoried; cannot verify uniform compliance across absent pose art.

### WEB-104: missing

- Source tab: t.fg5gsb581yxc
- Requirement: Final raster size family and transparent exports, linked/free fonts, interactive PDF; duplicated23.
- Source excerpt: 16px, 32px, 64px, 128px, 256px, 512px, 1024px, 2048px
- Code evidence: docs/design/ii-tonya-logo-character-brief.md:44
- Test references (not fresh execution):
- Live evidence: Fresh coordinator preflight .cache/requirements-2026-10-12/live-evidence.json:1 (2026-10-12T13:35:39.817Z): API/web 43a93e2131cde6bb09a6825fc5b83dfbf91fc600, services active/readiness true. Audited static web files match this commit. No authenticated acceptance established.
- Remaining: Hero512/1024 raster derivatives do not satisfy logo/pose eight-size export family.

### WEB-105: uncertain

- Source tab: t.9qebhz97ctps
- Requirement: Real expert/service catalogue supports promised discovery; source15 duplicates; demo must not masquerade as provider inventory.
- Source excerpt: подбираю лучшие варианты из моей базы
- Code evidence: apps/web/src/catalog-view.ts:49; apps/web/src/demo-catalog.ts:1; apps/api/src/server.ts:418
- Test references (not fresh execution):
- Live evidence: .cache/requirements-2026-10-12/live-evidence.json:1 freshly records experts0/services0/slots0 at2026-10-12T13:35:39.817Z. Published43a93e2; fictional examples separate.
- Remaining: Valid empty initial state is supported; commercial matching cannot serve real offers until authentic experts are verified/onboarded with real services/availability. Inventory alone does not prove missing admin code; administrative operational journey remains unverified. Never fabricate real providers.

### Source conflicts

- t.9qebhz97ctps, t.r035r9k76zot, t.ss4qakhqg9fe, t.29qw4u2w9d: Paid packages60vs30days and intro80–100. Accepted DEC-FIN-002 resolves60days/100intro; runtime purchase remains off.
- t.9qebhz97ctps, t.r035r9k76zot, t.ss4qakhqg9fe, t.29qw4u2w9d: Coupons90vs45days; x2 payment vs fixed1000/2000/3000/4000. DEC-FIN-003/005 choose x2/new45days, V2 coupons remain off.
- t.9qebhz97ctps, t.r035r9k76zot, t.ss4qakhqg9fe, t.29qw4u2w9d: FAQ grants referrer500 at registration vs offers after invitee first payment; refunds revoke reward.
- t.r035r9k76zot, t.29qw4u2w9d: One-month maximum residency prepayment conflicts three-month Start. Current published offer still30-day cap.
- t.r035r9k76zot, t.29qw4u2w9d: Old weekly8000/9000/10000/12000 entry ladder vs Energy40/30/20% and extra Start15/10%; accepted V2 base tariffs and final5000 floor not reconciled operationally.
- t.9qebhz97ctps, t.r035r9k76zot, t.ss4qakhqg9fe, t.29qw4u2w9d: Public12000/20000 and newer ranges conflict accepted executable START3900/BASE5900/PRO9990; financial policy documentation contains incompatible floor ordering.
- t.29qw4u2w9d: Center/organizer source discounts begin5; accepted DEC-FIN-012/code begin6. Shadow quote hardcodes0. Preserve amendment and decision; fixture tariffs not live approval.
- t.9qebhz97ctps, t.ss4qakhqg9fe, t.29qw4u2w9d: Immediate-client promise/no-advertising-marking claim vs later no guaranteed income and current compliance boundary; expert FAQ remains overclaiming.
- t.r035r9k76zot, t.x5yqcmuqgki5: Implicit consent, expansive profiles and stored mood/health history superseded by separate-purpose consent and minimal RF data model. These omissions are intentional safeguards, not permission to restore source collection.
- t.r035r9k76zot, t.29qw4u2w9d: All-message charging source/public offer conflicts domain exemption for system/safety/error. Resolve pricing semantics and public disclosure.
- t.r035r9k76zot, t.29qw4u2w9d: Blanket nonrefund vs actual-incurred-cost prepublication refunds; old blanket text still published.
- t.r035r9k76zot, t.29qw4u2w9d: Old Telegram/VK/WhatsApp/Viber/Max vs newer Telegram/VK/Max; only inspected Telegram entry exists, client ingress disabled.
- t.r035r9k76zot: 24h slot lead plus unconditional72h reserve is internally inconsistent; code clamps to slot-minus-buffer. Link-at-confirmation promise also needs later privacy visibility constraints.
- t.ap7ec9ua9oii, t.fk4ujag8rsrk, t.9qebhz97ctps, t.x4pau2gh3c9u, t.fg5gsb581yxc: Three early landing palettes vs four brand palettes. DEC-EXP-005 accepts existing landing palette, leaves brand owner-pick; design docs incorrectly still label decision OPEN.
- t.9qebhz97ctps, t.x4pau2gh3c9u, t.fg5gsb581yxc: Earlier optional serif headers/Google Fonts conflict later Montserrat+Inter; deployed Georgia+fallback fonts lack later typography delivery.
- t.x4pau2gh3c9u, t.fg5gsb581yxc: Both tab23 and tab24 reference images show the same purple/gold network woman on white with a featureless face, contrary to the explicit detailed-face requirement. Coordinator confirmed the JPEGs are byte-identical (SHA25640c8d11f49c7396b2a5e3a71ae5caaf36f8ad18f5664d3458ac794316e2dca4d).
- t.x4pau2gh3c9u, t.fg5gsb581yxc: Tab23 energy accent permits coral OR mint;24 specifies coral. Later eightposes×fourcolors and monochrome checks supplement, not replace, earlier file sizes/mockups.
- t.9qebhz97ctps, t.r035r9k76zot, t.x5yqcmuqgki5, t.ss4qakhqg9fe, t.29qw4u2w9d: Published informational promises do not establish live workflows: fresh flags disable payments/AI/Planerka/client Telegram ingress/reserve/erasure. Booking/session/privacy enabled flags alone do not verify authenticated acceptance.
