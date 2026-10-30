"""Bound local transport experiment. Not a production checkout integration.

All IPC cancellation and first writes use one DurableState mutex. The caller
must prevent every database writer/network bypass; this class does not do that.
The startup mode used by tests is synthetic and is never a deployment switch.
"""

from durable_state import DurableState
from gateway import LocalHttpGateway


class BoundGateway:
    def __init__(self, directory, *, synthetic_fresh_start=False, authority=None, require_existing=False):
        self._authority = authority
        self._state = DurableState(
            directory, synthetic_fresh_start=synthetic_fresh_start, require_existing=require_existing
        )
        self._transport = LocalHttpGateway(durable_state=self._state)
        self._transport.arm_after_external_fencing()

    def resume_from_authority(self):
        return self._state.resume_from_authority(self._authority)

    def barrier(self):
        return self._state.barrier(self._authority)

    def revoke_contact(self, subject, contact_id=None):
        if self._authority is not None:
            if contact_id is None:
                raise ValueError("contact id required")
            self._state.delete(subject, before_persist=lambda: self._authority.revoke(contact_id))
        else:
            self._state.delete(subject)

    def revoke_user(self, subject):
        # Legacy user-domain tokens do not cancel contact-domain attempts.
        self._state.delete(subject)

    def stop_all(self):
        self._state.stop_all()

    def dispatch(self, subject, attempt_id, prepare_tls, request, *, authority_claim=None, **options):
        if self._authority is not None and authority_claim is None:
            return "cancelled"
        admit = None if self._authority is None else lambda: self._authority.claim(*authority_claim)
        return self._transport.dispatch(
            subject, prepare_tls, request, attempt_id=attempt_id, before_first_write=admit, **options
        )

    def create_ipc_server(
        self,
        address,
        *,
        auth_key,
        nonce_registry,
        allowed_pids,
        confirmation_hosts,
        merchant_auth,
        subject_key=None,
        allowed_uid=None,
    ):
        from ipc import GatewayServer
        from provider_reader import ProviderReader

        if self._authority is not None and (not isinstance(subject_key, bytes) or len(subject_key) < 32):
            raise ValueError("contact subject key required with database authority")
        if not confirmation_hosts:
            raise ValueError("confirmation host allowlist required")
        hosts = frozenset(confirmation_hosts)
        return GatewayServer(
            address,
            erase=self.revoke_contact,
            stop_all=self.stop_all,
            dispatch=lambda subject, attempt, request, *claim: self.dispatch(
                subject,
                attempt,
                prepare_yookassa_tls,
                request,
                confirmation_hosts=hosts,
                authority_claim=claim[0] if claim else None,
            ),
            allowed_pids=allowed_pids,
            auth_key=auth_key,
            nonce_registry=nonce_registry,
            callback_timeout=5,
            confirmation_hosts=hosts,
            allow_user_revocation=False,
            merchant_auth=merchant_auth,
            provider_reader=ProviderReader(merchant_auth, confirmation_hosts=hosts),
            contact_key=subject_key if self._authority is not None else None,
            allowed_uid=allowed_uid,
            barrier=self.barrier,
        )

    def close(self):
        self._state.close()


def prepare_yookassa_tls(*, timeout=3):
    """Fixed provider destination; no host, URL or DNS override from IPC."""
    import socket
    import ssl

    host = "api.yookassa.ru"
    raw = socket.create_connection((host, 443), timeout=timeout)
    try:
        return ssl.create_default_context().wrap_socket(raw, server_hostname=host)
    except BaseException:
        raw.close()
        raise
