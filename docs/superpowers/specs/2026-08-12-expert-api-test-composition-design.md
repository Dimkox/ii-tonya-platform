# Expert API test composition design delta

## Status

Approved for automatic test-environment implementation on 2026-08-12. This delta does
not authorize staging or production activation.

## Problem

Task 10 added an expert referral HTTP route builder, but the normal API application does
not compose it. Direct composition is currently impossible without inventing production
authentication and payment-provider behavior: the route requires an expert principal,
redemption needs a verified channel identity, and checkout needs a provider deadline.

## Decision

Add a fail-closed composition seam to the normal API application:

- `buildApp` accepts one optional expert API capability containing a principal resolver,
  referral service, and residency service.
- The expert routes are registered only when that complete capability is present and the
  corresponding referral or residency feature flag is enabled.
- `server.ts` does not synthesize credentials, user sessions, payment deadlines, or live
  provider behavior. With the current disabled integrations it supplies no capability.
- If an expert feature flag is enabled without the required runtime capability, startup
  fails with a bounded configuration error instead of exposing a partial interface.
- Tests may inject deterministic fake ports and placeholder identities. Test values have
  no production meaning and never enter `.env`, runtime defaults, or deployment files.

The existing standalone route builder remains the HTTP boundary. It will be converted to
a Fastify plugin so the same routes can be tested standalone and registered in the normal
application without creating a second listener.

## Deferred contracts

- A real expert bearer/session contract and its credential lifecycle.
- Mapping a verified Telegram identity into the expert HTTP principal.
- Payment-provider deadline acquisition and payment-session creation.
- Runtime dispatch of expert LLM proposals.
- Resolution of `start_residency_checkout.orderId` versus the HTTP
  `tariffVersionId` command. Until that contract is approved, prompt proposals remain
  validation-only and cannot execute financial commands.

## Safety and acceptance criteria

- Default application behavior and all feature flags remain disabled.
- No expert route exists when the optional capability is absent.
- Injecting the complete test capability with both test feature flags enabled exposes
  all four expert endpoints through the normal application; each flag controls only its
  own two routes.
- Enabling either expert feature flag without the capability rejects startup.
- No client coupon table, client intent, payment integration, or deployment environment
  is changed.
- One focused API test file provides RED/GREEN evidence; repeated and full local suites
  are outside this increment.
