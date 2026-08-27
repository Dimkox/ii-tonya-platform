# Payment Moderation Landing Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provider-neutral landing and legal copy package that can be completed with approved merchant facts and transferred to a public HTTPS site for YooKassa or T-Bank moderation.

**Architecture:** Keep all new material in `docs/landing-copy/`; do not introduce a web application or change payment code. A README registers every substitution token and blocks publication until the values, legal review, live HTTPS deployment, and backend activation gates are complete.

**Tech Stack:** Markdown, repository formatting checks, ripgrep-based consistency inspection

**Spec:** `docs/superpowers/specs/2026-08-21-payment-moderation-landing-copy-design.md`

## Global Constraints

- Do not change checkout, payment, refund, webhook, database, environment, or provider-adapter code.
- Do not claim that acquiring, a payment method, or a provider is enabled or approved.
- Do not invent merchant facts, prices, policy periods, licences, or certifications.
- Use only the exact registered double-brace substitution tokens from the design.
- Treat `{{LEGAL_*}}` as the contractual seller/payment recipient, and separately
  identify the commercial model, performer, receipt issuer, and data controller.
- Choose platform-as-seller/MoR or expert/third-party seller with a reviewed
  provider/platform acquiring flow; do not hide this choice in editorial prose.
- Preserve the information-service positioning and the medical, psychological, legal, emergency, diagnosis, and outcome disclaimers.
- State that copy readiness does not override `PAYMENTS_ENABLED=false` or the provider activation `NO-GO` state.

---

### Task 1: Create the moderated landing copy package

**Files:**

- Create: `docs/landing-copy/README.md`
- Create: `docs/landing-copy/landing.md`
- Create: `docs/landing-copy/services-and-prices.md`
- Create: `docs/landing-copy/payment-and-fulfilment.md`
- Create: `docs/landing-copy/cancellations-and-refunds.md`
- Create: `docs/landing-copy/public-offer.md`
- Create: `docs/landing-copy/privacy-policy.md`
- Create: `docs/landing-copy/personal-data-consent.md`
- Create: `docs/landing-copy/contacts-and-details.md`
- Create: `docs/landing-copy/moderation-checklist.md`

**Interfaces:**

- Consumes: the design's official-source baseline, current product boundary, token registry, copy rules, and publication gate.
- Produces: one internally linked Markdown copy package whose tokens are registered in `README.md` and whose public claims stay inside the current product boundary.

- [ ] **Step 1: Create the package index and exact token registry**

Write `README.md` with these sections: `Статус комплекта`, `Как использовать`,
`Обязательные поля`, `Проверка перед публикацией`, `Официальные источники`, and
`Связь с техническим запуском`. Register every token listed in the design,
explain the required evidence for each value, and state in the first screen that
the template is not publishable while any `{{...}}` token remains. Register the
commercial model, performer/receipt issuer, and separate data-controller fields.

- [ ] **Step 2: Write the customer-facing main and commercial copy**

Write `landing.md` with a factual hero, the information-and-booking-service
description, service flow, boundaries/disclaimers, and links to all commercial
and legal pages. Write `services-and-prices.md` with one repeatable service-card
template containing service name, description, customer result, format,
duration, fulfilment start and method, and final ruble price. Explicitly say
that the displayed payable price must match checkout and the offer.

- [ ] **Step 3: Write payment, fulfilment, cancellation, and refund copy**

Write `payment-and-fulfilment.md` with the moment of contract formation, the
checkout sequence, receipt delivery, fulfilment/access, failure handling, and
support route, while stating that payment controls are displayed only after
actual activation. Keep live booking claims behind a separately tested Planerka
flow. Write `cancellations-and-refunds.md` with separate rules for customer
cancellation, seller cancellation, rescheduling, no-show, service already
started, refund request contents, decision period, transfer period, exact
approved refund method, and support escalation. Express all unsettled facts
with the registered policy tokens.

- [ ] **Step 4: Write the offer and privacy documents**

Write `public-offer.md` with seller identity, commercial model, actual performer,
receipt issuer, terms, exact acceptance action, service scope,
price and payment, fulfilment, rights and duties, cancellation/refund,
liability boundaries, personal data, dispute contacts, term, and details.
Write `privacy-policy.md` with separate controller identity, data categories,
purposes, legal grounds, operations, recipients/processors, storage and retention,
security, data-subject rights, withdrawal, contacts, and effective date. Use
plain language and preserve the information-service limitation.

- [ ] **Step 5: Write consent, merchant details, and evidence checklist**

Write `personal-data-consent.md` as a separate affirmative consent with an
unchecked-by-default checkbox label and links to the policy and offer. Write
`contacts-and-details.md` with the seller, registration, addresses, support
channels, hours, and document links. Write `moderation-checklist.md` as a
provider-neutral preflight followed by YooKassa and T-Bank evidence sections,
legal/fiscalization review, technical payment activation, and a final release
decision. Link each provider section to the official source in the design.

- [ ] **Step 6: Verify token and content consistency**

Run:

```bash
rg -n '\{\{[A-Z0-9_]+\}\}' docs/landing-copy
rg -n 'гарант|одобрен|подключен|лучший|скидк|успей|диагноз|лечени' docs/landing-copy
rg -n 'yookassa.ru/docs|tbank.ru/business/help' docs/landing-copy
git diff --check -- docs/landing-copy docs/superpowers/specs/2026-08-21-payment-moderation-landing-copy-design.md docs/superpowers/plans/2026-08-21-payment-moderation-landing-copy.md
corepack pnpm exec prettier --check docs/landing-copy docs/superpowers/specs/2026-08-21-payment-moderation-landing-copy-design.md docs/superpowers/plans/2026-08-21-payment-moderation-landing-copy.md
```

Expected: every double-brace token appears in the README registry; promotional
or medical matches occur only in prohibitions/disclaimers; both providers have
official source links including the YooKassa platform source; commercial model,
performer, receipt issuer, controller, and booking gate are explicit; diff check
and formatting pass. Inspect every occurrence
rather than treating an empty or non-empty search result as success by itself.

- [ ] **Step 7: Review the package against the approved design**

Confirm all ten files exist, navigation links resolve, terms agree across the
commercial and legal pages, the template is visibly blocked from publication,
and no payment boundary files changed. Record any remaining merchant inputs as
registered tokens, never as fabricated examples.

- [ ] **Step 8: Hand the isolated copy package back for integration**

Report the files created, validation output, and any unresolved registered
tokens. Do not commit while the concurrent migration agent is editing the same
worktree; the parent agent will integrate the reviewed documentation after
coordinating the shared branch.
