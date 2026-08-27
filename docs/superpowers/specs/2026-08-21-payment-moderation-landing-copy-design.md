# Payment Moderation Landing Copy Design

## Goal

Create a publication-ready copy package for the «ии-Тоня» landing and legal
pages that exposes the information requested during YooKassa and T-Bank
internet-acquiring moderation, without inventing merchant, commercial, or
legal facts.

## Official moderation baseline

- YooKassa requires a launched, accessible site with real services, current
  prices, fulfilment information, a public offer or user agreement, contacts,
  and merchant details:
  <https://yookassa.ru/docs/support/payments/onboarding/arrangement>
- YooKassa requires HTTPS/SSL for website integrations:
  <https://yookassa.ru/docs/support/security>
- If experts or third parties are the contractual sellers, YooKassa's platform
  flow requires the platform and its sellers to be connected under the
  split-payments model:
  <https://yookassa.ru/developers/solutions-for-platforms/split-payments/basics>
- T-Bank requires a clear description of the goods or services, ruble prices,
  seller contacts and details, return instructions and conditions, personal
  data consent, and the customer-facing contract terms:
  <https://www.tbank.ru/business/help/business-payments/internet-acquiring/how-work/working-conditions/>
- Fiscalization readiness must be confirmed separately before live payments:
  <https://www.tbank.ru/business/help/business-payments/internet-acquiring/kassa/how-connect/>

These are publication requirements, not a guarantee that either provider will
approve the merchant. A provider may request additional documents or reject a
business based on its own risk assessment.

## Current product boundary

This repository has no public web application. Live payments are deliberately
disabled, the provider activation record is `NO-GO`, and prices, package
contents, refunds, chargebacks, no-show rules, receipt handling, legal basis,
and merchant details have not been approved.

The first deliverable is therefore a provider-neutral copy package under
`docs/landing-copy/`. It can be transferred to the real website later. It must
not add checkout routes, payment adapters, payment tables, provider logos, or
claims that payments are already available.

## Content architecture

| File                           | Responsibility                                                              |
| ------------------------------ | --------------------------------------------------------------------------- |
| `README.md`                    | Publication gate, substitution workflow, and source index                   |
| `landing.md`                   | Main-page copy: service identity, scope, process, and navigation            |
| `services-and-prices.md`       | Concrete service cards, ruble prices, duration, format, and fulfilment      |
| `payment-and-fulfilment.md`    | Contract formation, payment flow, receipt, access, and support language     |
| `cancellations-and-refunds.md` | Cancellation, rescheduling, no-show, refund eligibility, method, and timing |
| `public-offer.md`              | Provider-neutral public-offer template for services                         |
| `privacy-policy.md`            | Personal-data processing policy template                                    |
| `personal-data-consent.md`     | Separate affirmative consent text and checkbox label                        |
| `contacts-and-details.md`      | Seller identity, registration details, address, support contacts, and hours |
| `moderation-checklist.md`      | Evidence checklist for publishing and applying to each provider             |

## Required substitution fields

Unknown facts remain explicit double-brace tokens and are registered in
`docs/landing-copy/README.md`. At minimum the package uses:

- merchant: `{{LEGAL_NAME}}`, `{{LEGAL_FORM}}`, `{{INN}}`, `{{OGRN_OR_OGRNIP}}`,
  `{{LEGAL_ADDRESS}}`, `{{POSTAL_ADDRESS}}`, `{{COMMERCIAL_MODEL}}`;
- performer and receipt: `{{PERFORMER_NAME}}`, `{{PERFORMER_ROLE}}`,
  `{{PERFORMER_SERVICE_SCOPE}}`, `{{RECEIPT_ISSUER}}`;
- support: `{{SUPPORT_EMAIL}}`, `{{SUPPORT_PHONE}}`, `{{SUPPORT_HOURS}}`;
- publication: `{{SITE_URL}}`, `{{DOCUMENT_EFFECTIVE_DATE}}`;
- service: `{{SERVICE_NAME}}`, `{{SERVICE_DESCRIPTION}}`,
  `{{SERVICE_RESULT}}`, `{{SERVICE_FORMAT}}`, `{{SERVICE_DURATION}}`,
  `{{SERVICE_PRICE_RUB}}`, `{{FULFILMENT_START}}`,
  `{{FULFILMENT_METHOD}}`;
- policy: `{{CANCELLATION_DEADLINE}}`, `{{REFUND_ELIGIBILITY}}`,
  `{{REFUND_REVIEW_PERIOD}}`, `{{REFUND_TRANSFER_PERIOD}}`,
  `{{REFUND_METHOD}}`, `{{NO_SHOW_RULE}}`, `{{RECEIPT_METHOD}}`,
  `{{OFFER_ACCEPTANCE_ACTION}}`, `{{TAX_FISCAL_WORDING}}`,
  `{{APPLICABLE_LAW}}`, `{{DISPUTE_TERMS}}`;
- data controller and privacy: `{{DATA_CONTROLLER_NAME}}`,
  `{{DATA_CONTROLLER_FORM}}`, `{{DATA_CONTROLLER_INN}}`,
  `{{DATA_CONTROLLER_OGRN_OR_OGRNIP}}`, `{{DATA_CONTROLLER_ADDRESS}}`,
  `{{DATA_CONTROLLER_SELLER_RELATION}}`,
  `{{PERSONAL_DATA_PURPOSES}}`, `{{PERSONAL_DATA_LEGAL_BASES}}`,
  `{{PERSONAL_DATA_PROCESSORS}}`, `{{PERSONAL_DATA_STORAGE_TRANSFER}}`,
  `{{PERSONAL_DATA_REQUEST_PERIOD}}`, `{{PERSONAL_DATA_WITHDRAWAL_EFFECTS}}`,
  `{{PERSONAL_DATA_RETENTION}}`.

Tokens are not moderation-compliant content. The package must visibly say that
every token has to be replaced with an approved fact before publication.

## Copy rules

- Describe «ии-Тоня» as an information and booking service, not as a doctor,
  psychologist, lawyer, emergency service, or guarantor of outcomes.
- State exactly what the customer receives, in what format, for how long, when
  access or fulfilment begins, and the total price in rubles.
- Keep seller, support, cancellation, refund, privacy, and offer information
  mutually consistent across all pages.
- Define the contractual seller/payment recipient, actual performer, receipt
  issuer, and data controller separately. Choose either platform-as-seller/MoR
  or expert/third-party seller with a provider/platform acquiring flow.
- Do not claim provider approval, guaranteed results, guaranteed refunds,
  diagnostic or therapeutic effects, discounts, scarcity, or payment methods
  that are not actually enabled.
- Do not use payment-system logos until the selected provider supplies and
  authorizes the relevant assets.
- Distinguish a reference price from a payable price. Only an approved payable
  price can appear on the published commercial page.
- Explain that payment availability is shown only when checkout has actually
  been activated; the repository remains `PAYMENTS_ENABLED=false` meanwhile.
- Do not claim live Planerka slots or booking availability until that flow is
  activated and tested.
- Use explicit consent near every personal-data collection form; a link to the
  policy alone is not represented as consent.

## Publication gate

The package may be handed to design and legal review immediately, but it may be
marked ready for provider moderation only after all of the following are true:

1. Every registered token is replaced with an approved value.
2. The live HTTPS pages are publicly reachable without authentication.
3. Services, prices, seller details, support contacts, and policy terms match
   the acquiring application and provider contract.
4. Legal review approves the offer, privacy, consent, cancellation, refund,
   fiscalization, and receipt language for the seller's jurisdiction and tax
   status.
5. Test products, test prices, dead links, and “under construction” content are
   absent.
6. Payment methods and logos shown on the site match the activated provider
   configuration.
7. The separate backend payment activation gates have passed; landing copy does
   not override the repository's `NO-GO` state.
8. The commercial model, receipt issuer, performer, and data controller are
   documented and consistent with provider contracts.
9. Any internal blocks marked for deletion have been removed from the
   customer-facing publication.

## Acceptance criteria

- All ten files in the content architecture exist and use one consistent set
  of registered substitution fields.
- Main, commercial, fulfilment, refund, offer, privacy, consent, and merchant
  identity content are present and cross-linked.
- No invented merchant details, prices, deadlines, licences, certifications,
  provider approvals, or payment availability claims are present.
- Customer-facing text contains no unresolved editorial/legal instructions after
  token substitution; exact acceptance, tax, refund, dispute, and privacy terms
  are represented by approved values.
- No live Planerka booking claim appears before activation and testing.
- `README.md` and `moderation-checklist.md` identify the official sources and
  distinguish copy readiness from technical and legal readiness.
- Repository payment boundaries remain unchanged.
