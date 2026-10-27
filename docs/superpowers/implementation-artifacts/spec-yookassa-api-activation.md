---
title: Ordinary YooKassa checkout activation
type: feature
created: 2026-10-12
status: draft
review_loop_iteration: 0
context: []
---

## Intent

Connect authenticated expert checkout to the real payment adapter in the normal
API process, so the published product can accept an order and reconcile its
payment. This is part of the full commercial-production goal, not a replacement
for browser checkout, client journeys, deployment or human review.

## Boundaries & Constraints

Always preserve immutable saved quotes, cash amounts, canonical inbox delivery,
current receipt authority and durable idempotency. Merchant keys come from the
approved process-environment reference; receipt encryption uses separate keys.
Do not use unbound-recovery configuration as ordinary receipt configuration.
Never invent verified contact evidence, receipt policy, consent or merchant
approval. Never enable a stub merely to satisfy app.ts capability agreement.
Keep unrelated integrations fail-closed. No real charge in development tests.

## Code Map

- `apps/api/src/server.ts`: ordinary expert campaign composition has no provider;
  readiness currently accepts only disabled integrations.
- `apps/api/src/expert-campaign-composition.ts`: accepts ResidencyCheckoutProvider.
- `apps/api/src/app.ts`: retains exact activation/capability agreement.
- `apps/api/src/routes/yookassa-webhook.ts`: existing trusted-peer dependency,
  notification inbox, verified delivery and resolution ordering.
- `packages/integrations/src/yookassa/client.ts`: already validates POST payment
  amount/currency and mode. Do not duplicate a nonexistent missing check.
- `packages/integrations/src/yookassa/payment-adapter.ts`: checks order metadata
  and confirmation, but current unbound replay and disclosure admission need work.
- `packages/integrations/src/yookassa/receipt-contact-source.ts`: source/decryptor
  interfaces; decryption currently lacks authenticated subject/contact context.
- `packages/db/src/repositories/yookassa-receipt-contact-repository.ts`: current
  order-bound authority, verified26/26. Quote-bound pre-order admission is missing.
- `packages/config/src/env.ts`: ordinary receipt capability must be independent
  of optional encrypted unbound recovery.
- `deploy/nginx/ii-tonya`: overwrites X-Real-IP; API must trust only local nginx.

## Tasks & Acceptance

- [ ] New `apps/api/src/yookassa-peer.ts`: require trusted immediate loopback
  socket peer and exactly one valid overwritten X-Real-IP; ignore X-Forwarded-For.
- [ ] New `apps/api/src/yookassa-composition.ts` and targeted server wiring:
  construct real client, repositories, adapter, verifier and webhook capability;
  deliver canonical events before success resolution and acknowledgement.
- [ ] Config and receipt crypto: explicit ordinary capability, allowlisted key
  references, authenticated subject/contact binding, no plaintext persistence.
- [ ] Receipt admission: quote-bound eligibility before new reservations;
  order-bound disclosure admission coordinated with withdrawal and erasure.
  Define lock ordering before implementing this transaction boundary.
- [ ] Adapter: preserve unknown unbound outcomes without blind POST replay;
  implement only explicitly authorized exact-body recovery semantics.
- [ ] Readiness: per-enabled-capability checks, no network call at startup and
  no claim that construction proves successful merchant activation.
- [ ] Focused tests: ordinary lifecycle with synthetic credentials, recording
  HTTP transport and isolated PostgreSQL. Do not rerun exhausted existing files.

Given missing/unverified/revoked receipt authority, when checkout starts, then
no new reservation or provider disclosure occurs. Given a saved order, when a
payment is submitted, then the provider receives exactly its cash amount and
one durable command identity. Given an uncertain unbound outcome, when retried,
then no unapproved fresh POST occurs. Given forged forwarding headers, when a
webhook arrives, then no provider GET or inbox mutation occurs. Given verified
payment facts, when delivery succeeds, then canonical state commits before ACK.

## Readiness of this specification

Draft only. Source investigation completed by Curie and coordinator. The receipt
capture/verification process, actual purpose/policy wording/version, retention,
key custody and admission lock contract are not resolved here. Do not dispatch
this entire draft as ready-for-development or replace those gaps with stubs.
Technical proxy/composition work can proceed under an explicit narrower contract
without declaring checkout or the full commercial objective complete.

## Verification

Allocate new focused executions only after exact files and ownership are fixed.
Maximum three runs per focused PostgreSQL file; no full/multi-path rerun.
Require affected builds, typechecks, lint, whitespace checks, independent review,
then exact release evidence and actual published journey verification.

## Spec Change Log

Initial draft records live source investigation; no product code or activation.
