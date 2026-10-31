# Early Bird missing-callback recovery

Authorized P0 follow-up to launch/payment runtime. A verified provider binding
must not remain unpaid solely because a payment webhook was lost or absent.

The gateway-mode API reuses its callback verifier instances and restricted
settlement stores. After successful HTTP listen, one polling controller reads at
most ten unsettled composite/deferred verified bindings per cycle. Canonical DB
bindings classify products; metadata never selects the handler. Cross-product
and legacy binding ambiguity is refused. Active-user and erasure gates apply;
receipt/contact/body records and current pricing grants are not discovery inputs.
A bounded fresh provider GET and exact snapshot proof precede every successful
commit. PostgreSQL keeps settlement and replay authority. No create-payment,
refund, message or new checkout operation is exposed by this controller.

A rotating cursor avoids poison-record starvation. Cycles cannot overlap, have
a 30-second admission budget, 5-second discovery SQL timeout and the existing
10-second gateway GET timeout. Discovery uses a separate max-one pool with a
4-second acquisition timeout and session read-only mode; HTTP pool saturation
cannot indefinitely block its checkout. Shutdown stops new commits and future intervals,
then drains existing work before either primary or restricted pools close. HTTP
and pool cleanup are attempted even if drain reports a failure; pool closure
waits for checked-out transactions instead of terminating them.
The controller runs only from the explicit protected gateway bootstrap.

Verification lives in `apps/api/src/early-bird-bound-reconciliation.test.ts` and
`packages/db/src/repositories/early-bird-bound-reconciliation.integration.test.ts`.
Release verification remains the coordinator's exact-SHA gates and production
activation evidence. This fallback does not discover unknown externally issued
refunds or replace merchant webhook configuration. No production mutation or
external provider payment occurs in these tests.
