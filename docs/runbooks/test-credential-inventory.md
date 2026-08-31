# Test credential inventory

Updated: 2026-08-31. Test delivery deadline: 2026-09-07. This document records capability presence only. Secret values,
passwords, tokens, and recovery material must remain outside Git, logs, screenshots in
release evidence, and review reports.

Every external capability is default-off until its test evidence passes. The test-only
release boundary permits local fixtures, contract tests, and isolated staging evidence;
it does not authorize production activation or provider-connected claims.

## Supplied, pending contract validation

| Integration | Supplied capability | Current interpretation |
| --- | --- | --- |
| Expert promo Telegram bot | Bot API credential and public bot address | Suitable only for the external expert-acquisition bot; it is not the client-facing unified bot credential. |
| Planerka | Account access and a `cal_` credential | Treat as a candidate calendar credential until authenticated API documentation confirms its scope and base URL. |
| Telegram account | Account contact details | Not sufficient for Bot API integration. The platform requires a bot token and independently generated webhook/callback secrets. |
| MAX Business | Business phone number | Identifier only; API credential, callback verification material, and approved API contract are not supplied. |
| YooKassa | Shop ID `1437535` and a merchant credential | Store the credential only in the test host environment. Activation remains disabled until the remaining test-shop configuration below is present and exercised. |
| Selarti | Existing service association was identified | No API credential set or authenticated webhook contract has been supplied to the platform. |

## Still required for the test contour

### Unified client Telegram bot

- `TELEGRAM_BOT_TOKEN` for the single client-facing bot;
- independently generated `TELEGRAM_WEBHOOK_SECRET`;
- independently generated `TELEGRAM_CALLBACK_HMAC_KEY`;
- `TELEGRAM_ADMIN_CHAT_ID` and `TELEGRAM_SAFETY_CHAT_ID`;
- confirmed public HTTPS webhook URL.

### Expert promo Telegram bot

- a separate runtime variable and bot scope for the supplied promo-bot token;
- independently generated webhook secret and callback HMAC key;
- approved hand-off/deep-link contract into the main expert flow;
- mapping from promo referrals to the authoritative referral ledger.

Do not place the promo credential in `TELEGRAM_BOT_TOKEN`: that variable belongs to the
single client-facing dialogue.

### Planerka

- authenticated API base URL and official request/response documentation;
- confirmation that the supplied `cal_` credential is accepted as
  `PLANERKA_API_TOKEN`, including its scope and expiry;
- `PLANERKA_WEBHOOK_SECRET` or the provider's documented callback verification method;
- test calendar/resource identifiers and timezone;
- create/read/change/cancel and duplicate-webhook fixtures.

### YooKassa

- confirmation that test-shop `YOOKASSA_SHOP_ID=1437535` matches the supplied credential;
- `YOOKASSA_RETURN_URL` on the test HTTPS origin;
- approved `YOOKASSA_RECEIPT_VAT_CODE`;
- approved `YOOKASSA_RECEIPT_PAYMENT_SUBJECT`;
- approved `YOOKASSA_RECEIPT_PAYMENT_MODE`;
- YooKassa webhook configured for the test endpoint;
- test evidence for create/read/refund, duplicate webhook, timeout/unknown outcome,
  and reconciliation.

Exact-body autonomous recovery remains optional and disabled. Its consent purpose,
policy version, key reference, retention period, and recovery window are required only
before that separate capability is enabled.

### Selarti

- `SELARTI_API_KEY`;
- `SELARTI_COMPANY_ID`;
- `SELARTI_TASK_ID`;
- `SELARTI_AI_ID`;
- authenticated outbound and response-webhook contracts;
- `SELARTI_WEBHOOK_SECRET` and `SELARTI_RESPONSE_SHARED_SECRET`;
- official usage/billing fixture for the budget controls.

### MAX Business

- approved bot/business API access token;
- API base URL and channel/account identifier;
- callback verification secret or documented signature keys;
- supported message and button contract;
- test webhook and delivery fixtures.

## Locally generated, not requested from the provider

The test operator can generate Telegram callback/webhook secrets, referral HMAC keys,
and internal encryption keys. Generate them directly on the test host, reference them by
environment or secret-manager name, and never copy their values into this repository.
