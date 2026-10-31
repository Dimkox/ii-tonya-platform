# Gateway cancellation boundary

The owner approved this boundary on 2026-10-29: once the authenticated gateway
acknowledges revocation of a contact, it must never start another send for that
contact. A send already executing concurrently may finish before the revocation
acknowledgement. The application must not report receipt deletion complete before
that acknowledgement and its own durable deletion succeed. If the gateway cannot
acknowledge, deletion may still be performed but its completion must not be reported
as meeting the gateway cancellation boundary.

`test_bound_gateway.py` tests this ordering against a synthetic local TLS endpoint:
the revocation acknowledgement waits for an in-flight write, and the next send is
cancelled. This single-process result does not cover database authority changes,
other gateway instances, network bypass, storage rollback, credentials, or startup.
The transport remains experimental and must not be activated from this evidence.
