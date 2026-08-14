# ER-TG-002 Expert Telegram Referral Mutations

Status: referral mutation slice implemented. Checkout dispatch is completed separately by
ER-TG-003 as a provider-neutral, capability-injected, default-off path.

- **ER-TG-002-R1:** `EXPERT_TELEGRAM_REFERRAL_ENABLED` defaults to `false` and is
  independent from read-only Telegram queries.
- **ER-TG-002-R2:** an authenticated private `/redeem EXR_<opaque>` passes the opaque
  code only to `ExpertReferralService.redeemCode`, with the Telegram update idempotency
  key. The code is never rendered or logged.
- **ER-TG-002-R3:** mutation completion and Telegram delivery use separate idempotency
  identities; uncertain delivery never authorizes another financial mutation.
- **ER-TG-002-R4:** `xr1` is a separate, single-use, expiring callback namespace bound
  to freshly resolved Telegram user, expert, tariff, and action facts in migration 0025.
- **ER-TG-002-R5:** `xr1` does not enter `ct2` or `cv1` processing. ER-TG-003 owns the
  separately gated checkout dispatch; this ER-TG-002 slice does not activate it.
- **ER-TG-002-R6:** this slice imports or activates no YooKassa/provider capability.

| Requirement | Implementation                                                          | Verification                         | Remaining gate                        |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| R1-R3       | config, command processor, fixed Telegram success view                  | config/processor tests               | independent review                    |
| R4          | `0025_expert_telegram_residency_callbacks.sql`, repository, `xr1` token | token and PostgreSQL repository gate | ER-TG-003 migration compatibility review |
| R5-R6       | webhook namespace isolation; no provider import                         | webhook regression and scope review  | keep independent checkout flag disabled |
