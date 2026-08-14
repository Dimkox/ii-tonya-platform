# ER-AI-001 Expert AI Ingress

Status: implemented default-off fixture boundary; live source absent; human approval blocked.

The expert AI ingress is separate from the client `ConversationService`. It accepts
only the four strict `ExpertIntentProposal` variants, treats source output as
untrusted, and invokes existing expert application services with the original
server-derived `ExpertPrincipal`. Those services repeat ownership authorization and
remain authoritative for balances, prices, credit, checkout and provider behavior.

`start_residency_checkout` carries `tariffVersionId`, matching the existing
`ExpertResidencyService.checkout` contract. The previous unused `orderId` proposal
shape was inconsistent with the executable service and is removed atomically.

`EXPERT_AI_INGRESS_ENABLED=false` is the deployment default. The default server
does not compose a proposal source. No model SDK, model endpoint, provider secret,
database adapter, Telegram route or payment adapter is added by this increment.

Offline evidence evaluates a committed synthetic corpus and records only bounded
accepted-kind and rejection-reason counts. A distribution diff proves validator
contract stability only; it does not prove model quality.

## Release approvals

- Human spot-check owner: **BLOCKED — not assigned**
- Human spot-check date: **BLOCKED — not performed**
- Human spot-check result: **BLOCKED**
- Live model/provider activation: **NOT IMPLEMENTED / NOT AUTHORIZED**
- Staging and production: **NOT AUTHORIZED**
