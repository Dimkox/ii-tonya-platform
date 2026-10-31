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

    def dispatch_public(
        self, subject, attempt_id, prepare_tls, body, claim, *, merchant_auth, provider_reader=None, **options
    ):
        from pg_authority import validate_public_claim

        if self._authority is None:
            return "cancelled"
        prefetched_parent = None
        if claim[5] == "main_refund":
            # Read-only candidate discovery can block. It must finish before the
            # final live-authority claim, not while the ACK/write mutex is held.
            # The body supplies no authority: its candidate is compared with the
            # PG-returned parent and finance snapshot inside admit below.
            from pg_authority import strict_json

            try:
                if provider_reader is None or not isinstance(body, bytes) or not 1 <= len(body) <= 49152:
                    return "unknown"
                candidate = strict_json(body)
                if not isinstance(candidate, dict):
                    return "unknown"
                prefetched_parent = provider_reader.inspect_payment(candidate["payment_id"])
            except (ValueError, TypeError, KeyError, OSError):
                return "unknown"
        request = bytearray()
        claimed = []

        def admit():
            try:
                row = validate_public_claim(self._authority.claim_public(*claim), claim)
                serialized = public_request(row, body, merchant_auth)
                if row["kind"] == "main_refund":
                    verify_refund_parent(row, prefetched_parent)
                request.extend(serialized)
                claimed.append(row)
                return True
            except (ValueError, TypeError, KeyError):
                return False

        result = self._transport.dispatch(
            subject, prepare_tls, request, attempt_id=attempt_id, before_first_write=admit, **options
        )
        if not isinstance(result, dict) or result.get("outcome") != "response":
            return result
        try:
            if provider_reader is None or not claimed:
                return "unknown"
            row = claimed[0]
            object_id = result["payment_id"]
            if row["kind"] == "main_refund":
                observed = provider_reader.inspect_refund(object_id)
                verify_refund_parent(row, provider_reader.inspect_payment(row["parentPaymentId"]))
            else:
                if row["parentPaymentId"] is not None and object_id != row["parentPaymentId"]:
                    return "unknown"
                observed = provider_reader.inspect_payment(object_id)
            verify_public_object(row, observed)
            # GET verifies response bindings; this result still cannot settle anything.
            safe = {
                "outcome": "response",
                "http_status": result["http_status"],
                "payment_id": object_id,
                "payment_status": observed["status"],
            }
            confirmation = observed.get("confirmation")
            if confirmation is not None and row["kind"] != "main_refund":
                safe["confirmation_url"] = confirmation["confirmation_url"]
            return safe
        except (ValueError, TypeError, KeyError, OSError):
            return "unknown"

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
        reader = ProviderReader(merchant_auth, confirmation_hosts=hosts)
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
            public_dispatch=lambda subject, attempt, body, claim: self.dispatch_public(
                subject,
                attempt,
                prepare_yookassa_tls,
                body,
                claim,
                merchant_auth=merchant_auth,
                provider_reader=reader,
                confirmation_hosts=hosts,
            ),
            allowed_pids=allowed_pids,
            auth_key=auth_key,
            nonce_registry=nonce_registry,
            callback_timeout=5,
            confirmation_hosts=hosts,
            allow_user_revocation=False,
            merchant_auth=merchant_auth,
            provider_reader=reader,
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


def public_request(row, body, merchant_auth):
    """Validate financial semantics, then serialize only the fixed provider path."""
    import base64
    import hashlib
    import re
    from urllib.parse import urlsplit
    from pg_authority import strict_json

    if (
        not isinstance(body, bytes)
        or not 1 <= len(body) <= 49152
        or "sha256:" + hashlib.sha256(body).hexdigest() != row["requestDigest"]
    ):
        raise ValueError("invalid public request")
    value = strict_json(body)
    kind = row["kind"]
    minor = int(row["amountMinor"])
    amount = {"value": str(minor // 100) + "." + str(minor % 100).zfill(2), "currency": "RUB"}
    if kind == "onboarding_cancel":
        if value != {} or not isinstance(value, dict):
            raise ValueError("invalid public cancel")
        path = "/v3/payments/" + row["parentPaymentId"] + "/cancel"
    elif kind == "onboarding_capture":
        if value != {"amount": amount}:
            raise ValueError("invalid public capture")
        path = "/v3/payments/" + row["parentPaymentId"] + "/capture"
    else:
        required = {"amount", "metadata", "receipt"}
        refund = kind == "main_refund"
        required |= {"payment_id"} if refund else {"capture", "confirmation"}
        if kind == "onboarding_create":
            required.add("payment_method_data")
        if not isinstance(value, dict) or set(value) not in (required, required | {"description"}):
            raise ValueError("invalid public fields")
        if value["amount"] != amount:
            raise ValueError("invalid public amount")
        expected_metadata = {
            "purpose": "public_main_refund"
            if refund
            else "onboarding"
            if kind == "onboarding_create"
            else "main_residency",
            "operation_id": row["legacyOperationId"],
            "order_id": row["legacySourceId"],
            "user_id": row["userId"],
        }
        if value["metadata"] != expected_metadata:
            raise ValueError("invalid public identity")
        if "description" in value and (
            not isinstance(value["description"], str) or not 1 <= len(value["description"]) <= 128
        ):
            raise ValueError("invalid public description")
        if refund:
            if value["payment_id"] != row["parentPaymentId"]:
                raise ValueError("invalid refund parent")
        else:
            if type(value["capture"]) is not bool or value["capture"] != (kind == "main_create"):
                raise ValueError("invalid public capture")
            if kind == "onboarding_create" and value["payment_method_data"] != {"type": "bank_card"}:
                raise ValueError("invalid public method")
            confirmation = value["confirmation"]
            if (
                not isinstance(confirmation, dict)
                or set(confirmation) != {"type", "return_url"}
                or confirmation["type"] != "redirect"
            ):
                raise ValueError("invalid public confirmation")
            url = confirmation["return_url"]
            if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in url):
                raise ValueError("invalid public confirmation")
            parsed = urlsplit(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
                raise ValueError("invalid public confirmation")
        receipt = value["receipt"]
        if not isinstance(receipt, dict) or set(receipt) != {"customer", "items"}:
            raise ValueError("invalid public receipt")
        customer = receipt["customer"]
        if not isinstance(customer, dict) or set(customer) not in ({"email"}, {"phone"}):
            raise ValueError("invalid public customer")
        contact = next(iter(customer.values()))
        pattern = r"[^\s@]{1,64}@[^\s@]{1,253}" if "email" in customer else r"\+[1-9][0-9]{7,14}"
        if not isinstance(contact, str) or len(contact) > 320 or not re.fullmatch(pattern, contact):
            raise ValueError("invalid public customer")
        items = receipt["items"]
        if not isinstance(items, list) or len(items) != 1:
            raise ValueError("invalid public receipt items")
        item = items[0]
        if (
            not isinstance(item, dict)
            or set(item) != {"description", "quantity", "amount", "vat_code", "payment_subject", "payment_mode"}
            or not isinstance(item["description"], str)
            or not 1 <= len(item["description"]) <= 128
            or item["quantity"] != "1.00"
            or item["amount"] != amount
            or type(item["vat_code"]) is not int
            or not 1 <= item["vat_code"] <= 12
            or item["payment_subject"] != "service"
            or item["payment_mode"] != "full_payment"
        ):
            raise ValueError("invalid public receipt item")
        path = "/v3/refunds" if refund else "/v3/payments"
    if (
        not isinstance(merchant_auth, tuple)
        or len(merchant_auth) != 2
        or any(not isinstance(x, str) or not x or any(c in x for c in "\r\n:") for x in merchant_auth)
    ):
        raise ValueError("invalid merchant credentials")
    auth = base64.b64encode((merchant_auth[0] + ":" + merchant_auth[1]).encode()).decode()
    return (
        "POST "
        + path
        + " HTTP/1.1\r\nHost: api.yookassa.ru\r\nAuthorization: Basic "
        + auth
        + "\r\nIdempotence-Key: "
        + row["idempotencyKey"]
        + "\r\nContent-Type: application/json\r\nContent-Length: "
        + str(len(body))
        + "\r\nConnection: close\r\n\r\n"
    ).encode("ascii") + body


def verify_refund_parent(row, parent):
    """Refunds carry no payment mode/paid/captured facts of their own."""
    from provider_reader import ProviderReader

    if (
        parent["id"] != row["parentPaymentId"]
        or parent["status"] != "succeeded"
        or parent["paid"] is not True
        or parent["test"] is not (row["mode"] == "test")
        or parent["metadata"].get("purpose") != "main_residency"
        or parent["metadata"].get("order_id") != row["legacySourceId"]
        or parent["metadata"].get("user_id") != row["userId"]
        or int(parent["amount"]["value"].replace(".", "")) < int(row["amountMinor"])
        or ProviderReader._timestamp(parent["captured_at"]) < ProviderReader._timestamp(parent["created_at"])
    ):
        raise ValueError("invalid refund parent")


def verify_public_object(row, observed):
    from provider_reader import ProviderReader

    if (
        int(observed["amount"]["value"].replace(".", "")) != int(row["amountMinor"])
        or observed["amount"]["currency"] != "RUB"
    ):
        raise ValueError("invalid public response")
    kind = row["kind"]
    metadata = observed.get("metadata")
    purpose = (
        "public_main_refund" if kind == "main_refund" else "main_residency" if kind == "main_create" else "onboarding"
    )
    # Capture/cancel refer to the original create's operation metadata, not the mutation UUID.
    if (
        not isinstance(metadata, dict)
        or metadata.get("purpose") != purpose
        or metadata.get("order_id") != row["legacySourceId"]
        or metadata.get("user_id") != row["userId"]
    ):
        raise ValueError("invalid public response")
    if (
        kind not in ("onboarding_capture", "onboarding_cancel")
        and metadata.get("operation_id") != row["legacyOperationId"]
    ):
        raise ValueError("invalid public response")
    if kind == "main_refund":
        if observed["payment_id"] != row["parentPaymentId"]:
            raise ValueError("invalid public refund")
        return
    if observed["test"] is not (row["mode"] == "test") or observed["paid"] is not (
        observed["status"] in ("succeeded", "waiting_for_capture")
    ):
        raise ValueError("invalid public response")
    if (
        kind.startswith("onboarding_")
        and observed["status"] in ("waiting_for_capture", "succeeded")
        and observed.get("payment_method", {}).get("type") != "bank_card"
    ):
        raise ValueError("invalid public method")
    if kind == "main_create" and observed["status"] == "waiting_for_capture":
        raise ValueError("invalid public main status")
    if observed["status"] == "succeeded":
        if ProviderReader._timestamp(observed["captured_at"]) < ProviderReader._timestamp(observed["created_at"]):
            raise ValueError("invalid public capture time")
    elif "captured_at" in observed:
        raise ValueError("invalid public capture time")
