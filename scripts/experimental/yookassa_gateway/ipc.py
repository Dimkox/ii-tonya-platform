"""Experimental local IPC, not a production payment gateway.

An erasure callback must persist its own tombstone before returning. Dispatch
is disabled until all revocation writers and egress paths are fenced. PID
allowlisting is not a security boundary against PID reuse or same-UID tracing.
"""

import json
import base64
import hashlib
import hmac
import os
import re
import socket
import struct
import threading
import time
import uuid


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


class GatewayServer:
    def __init__(
        self,
        address,
        *,
        erase,
        dispatch,
        allowed_pids,
        auth_key,
        nonce_registry,
        callback_timeout=1,
        stop_all=None,
        provider_host="api.yookassa.ru",
        confirmation_hosts=frozenset(),
        allow_user_revocation=True,
        merchant_auth=None,
        provider_reader=None,
        contact_key=None,
        allowed_uid=None,
        barrier=None,
    ):
        if not isinstance(address, str) or not address.startswith("\0") or len(address) < 2:
            raise ValueError("Linux abstract socket address required")
        if allowed_pids is not None and (
            not allowed_pids or any(type(pid) is not int or pid <= 0 for pid in allowed_pids)
        ):
            raise ValueError("invalid peer PID allowlist")
        if not isinstance(auth_key, bytes) or len(auth_key) < 32:
            raise ValueError("separate authentication key required")
        if not nonce_registry.bound_to(auth_key):
            raise ValueError("nonce registry key mismatch")
        self._auth_key = auth_key
        self._nonce_registry = nonce_registry
        if callback_timeout <= 0:
            raise ValueError("positive callback timeout required")
        if merchant_auth is not None and (
            not isinstance(merchant_auth, tuple)
            or len(merchant_auth) != 2
            or any(
                not isinstance(item, str) or not item or "\r" in item or "\n" in item or ":" in item
                for item in merchant_auth
            )
        ):
            raise ValueError("invalid merchant credentials")
        self._merchant_auth = merchant_auth
        self.provider_reader = provider_reader
        self.barrier = barrier
        if contact_key is not None and (
            not isinstance(contact_key, bytes) or len(contact_key) < 32 or hmac.compare_digest(contact_key, auth_key)
        ):
            raise ValueError("invalid contact key")
        self._contact_key = contact_key
        self.provider_host = provider_host
        self.confirmation_hosts = frozenset(confirmation_hosts)
        self.allow_user_revocation = allow_user_revocation
        if allowed_uid is not None and (type(allowed_uid) is not int or allowed_uid < 0):
            raise ValueError("invalid allowed UID")
        self.allowed_uid = os.getuid() if allowed_uid is None else allowed_uid
        self.address = address
        self.erase = erase
        self.stop_all = stop_all
        self._dispatch = dispatch
        self.allowed_pids = None if allowed_pids is None else frozenset(allowed_pids)
        self.callback_timeout = callback_timeout
        self.ready = threading.Event()
        self._stop = threading.Event()
        self._connections = threading.BoundedSemaphore(8)
        self._callbacks = threading.BoundedSemaphore(8)
        self._condition = threading.Condition()
        self._active_connections = set()
        self._active_callbacks = 0
        self._stopped = threading.Event()

    def serve(self):
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            listener.bind(self.address)
            listener.listen(8)
            listener.settimeout(0.1)
            self.ready.set()
            while not self._stop.is_set():
                try:
                    conn, _ = listener.accept()
                except socket.timeout:
                    continue
                if not self._connections.acquire(blocking=False):
                    conn.close()
                    continue
                with self._condition:
                    if self._stop.is_set():
                        conn.close()
                        self._connections.release()
                        continue
                    self._active_connections.add(conn)
                threading.Thread(target=self._serve_connection, args=(conn,), daemon=True).start()
        finally:
            listener.close()
            self._stopped.set()
            with self._condition:
                self._condition.notify_all()

    def _serve_connection(self, conn):
        try:
            with conn:
                conn.settimeout(1)
                try:
                    credentials = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                    pid, uid, _ = struct.unpack("3i", credentials)
                    if uid != self.allowed_uid or (self.allowed_pids is not None and pid not in self.allowed_pids):
                        return
                    deadline = time.monotonic() + 1

                    def read_line(limit):
                        data = bytearray()
                        while b"\n" not in data and len(data) <= limit:
                            remaining = deadline - time.monotonic()
                            if remaining <= 0:
                                raise ValueError("deadline")
                            conn.settimeout(remaining)
                            chunk = conn.recv(limit + 1 - len(data))
                            if not chunk:
                                raise ValueError("closed")
                            data.extend(chunk)
                        if len(data) > limit or not data.endswith(b"\n") or data.count(b"\n") != 1:
                            raise ValueError("invalid frame")
                        return bytes(data)

                    hello = json.loads(read_line(512), object_pairs_hook=_unique_object)
                    if not isinstance(hello, dict) or set(hello) != {"hello"}:
                        return
                    nonce = hello["hello"]
                    if not isinstance(nonce, str) or not re.fullmatch(r"[0-9a-f]{64}", nonce):
                        return
                    challenge = os.urandom(32).hex()
                    mac = hmac.new(
                        self._auth_key, ("hello\n" + nonce + "\n" + challenge).encode(), hashlib.sha256
                    ).hexdigest()
                    conn.sendall(
                        json.dumps({"nonce": nonce, "challenge": challenge, "mac": mac}, separators=(",", ":")).encode()
                        + b"\n"
                    )
                    result = self._handle(read_line(90000), nonce, challenge)
                    if result is not None:
                        conn.sendall(json.dumps(result, separators=(",", ":")).encode() + b"\n")
                except (OSError, ValueError):
                    return
        finally:
            with self._condition:
                self._active_connections.discard(conn)
                self._condition.notify_all()
            self._connections.release()

    def _handle(self, data, expected_nonce, challenge):
        try:
            if len(data) > 90000 or not data.endswith(b"\n") or data.count(b"\n") != 1:
                return None
            envelope = json.loads(data, object_pairs_hook=_unique_object)
            if not isinstance(envelope, dict) or set(envelope) != {"nonce", "challenge", "body", "mac"}:
                return None
            nonce, provided_challenge, body, signature = (
                envelope["nonce"],
                envelope["challenge"],
                envelope["body"],
                envelope["mac"],
            )
            if (
                nonce != expected_nonce
                or provided_challenge != challenge
                or not isinstance(body, str)
                or not isinstance(signature, str)
                or not re.fullmatch(r"[0-9a-f]{64}", signature)
            ):
                return None
            expected = hmac.new(
                self._auth_key, ("request\n" + nonce + "\n" + challenge + "\n" + body).encode(), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(signature, expected):
                return None
            try:
                if not self._nonce_registry.consume(nonce):
                    return None
            except Exception:
                # Refuse before callback if replay state cannot be persisted.
                return None
            outcome = self._handle_operation(body.encode() + b"\n")["outcome"]
            mac = hmac.new(
                self._auth_key, ("response\n" + nonce + "\n" + challenge + "\n" + outcome).encode(), hashlib.sha256
            ).hexdigest()
            return {"outcome": outcome, "nonce": nonce, "challenge": challenge, "mac": mac}
        except (ValueError, TypeError, UnicodeError):
            return None

    def _handle_operation(self, data):
        try:
            if len(data) > 90000 or not data.endswith(b"\n") or data.count(b"\n") != 1:
                raise ValueError()
            command = json.loads(data, object_pairs_hook=_unique_object)
            if not isinstance(command, dict):
                raise ValueError()
            operation = command.get("op")
            if operation == "revoke_user" and not self.allow_user_revocation:
                raise ValueError()
            if operation in ("stop_all", "barrier") and set(command) == {"op"}:
                subject = None
            elif operation in ("inspect_payment", "inspect_refund") and set(command) == {
                "op",
                "payment_id" if operation == "inspect_payment" else "refund_id",
            }:
                subject = None
            elif operation == "list_payments" and set(command) in (
                {"op", "created_from", "created_to", "limit"},
                {"op", "created_from", "created_to", "limit", "cursor"},
            ):
                subject = None
            elif operation == "dispatch" and set(command) == (
                {"op", "subject", "attempt", "request"}
                | (
                    {"user_id", "intent_id", "contact_id", "idempotency_key"}
                    if self._contact_key is not None
                    else set()
                )
            ):
                subject = command["subject"]
                attempt = command["attempt"]
                if not isinstance(attempt, str) or not re.fullmatch(r"[0-9a-f]{64}", attempt):
                    raise ValueError()
                if not isinstance(command["request"], str) or len(command["request"]) > 87384:
                    raise ValueError()
                request = base64.b64decode(command["request"], validate=True)
                if not self._valid_request(request):
                    raise ValueError()
                if self._contact_key is not None:
                    from subject_tokens import contact_token

                    identifiers = [command[key] for key in ("user_id", "intent_id", "contact_id", "idempotency_key")]
                    if any(not isinstance(value, str) or str(uuid.UUID(value)) != value for value in identifiers):
                        raise ValueError()
                    if not hmac.compare_digest(subject, contact_token(self._contact_key, identifiers[2]).hex()):
                        raise ValueError()
                    if not hmac.compare_digest(attempt, hashlib.sha256(uuid.UUID(identifiers[3]).bytes).hexdigest()):
                        raise ValueError()
                    header, body = request.split(b"\r\n\r\n", 1)
                    idempotency = [
                        line.split(b":", 1)[1].strip()
                        for line in header.split(b"\r\n")[1:]
                        if line.lower().startswith(b"idempotence-key:")
                    ]
                    if idempotency != [identifiers[3].encode("ascii")]:
                        raise ValueError()
                    authority_claim = (*identifiers, "sha256:" + hashlib.sha256(body).hexdigest())
            elif operation in ("erase", "revoke_user", "revoke_contact") and set(command) == (
                {"op", "subject", "contact_id"}
                if operation == "revoke_contact" and self._contact_key is not None
                else {"op", "subject"}
            ):
                subject = command["subject"]
                if operation == "revoke_contact" and self._contact_key is not None:
                    from subject_tokens import contact_token

                    contact_id = command["contact_id"]
                    if not hmac.compare_digest(subject, contact_token(self._contact_key, contact_id).hex()):
                        raise ValueError()
            else:
                raise ValueError()
            if subject is not None and (not isinstance(subject, str) or not re.fullmatch(r"[0-9a-f]{64}", subject)):
                raise ValueError()
            if (
                operation
                not in (
                    "erase",
                    "revoke_user",
                    "revoke_contact",
                    "stop_all",
                    "dispatch",
                    "inspect_payment",
                    "inspect_refund",
                    "list_payments",
                    "barrier",
                )
                or (operation in ("erase", "revoke_user", "revoke_contact", "dispatch") and subject is None)
                or (
                    operation in ("stop_all", "inspect_payment", "inspect_refund", "list_payments", "barrier")
                    and subject is not None
                )
            ):
                raise ValueError()
        except (ValueError, UnicodeError, TypeError):
            return {"outcome": "invalid"}
        if not self._callbacks.acquire(blocking=False):
            return {"outcome": "unavailable"}
        with self._condition:
            if self._stop.is_set():
                self._callbacks.release()
                return {"outcome": "unavailable"}
            self._active_callbacks += 1
        done = threading.Event()
        result = []

        def run():
            try:
                if operation == "barrier":
                    result.append(self.barrier is not None and self.barrier() is True)
                    return
                if operation in ("inspect_payment", "inspect_refund", "list_payments"):
                    if self.provider_reader is None:
                        raise RuntimeError("provider reader unavailable")
                    if operation == "inspect_payment":
                        response = self.provider_reader.inspect_payment(command["payment_id"])
                    elif operation == "inspect_refund":
                        response = self.provider_reader.inspect_refund(command["refund_id"])
                    else:
                        response = self.provider_reader.list_payments(
                            command["created_from"], command["created_to"], command["limit"], command.get("cursor")
                        )
                    result.append(response)
                    return
                if operation == "dispatch":
                    if self._merchant_auth is None:
                        result.append("unknown")
                        return
                    head, body = request.split(b"\r\n\r\n", 1)
                    raw = (self._merchant_auth[0] + ":" + self._merchant_auth[1]).encode("utf-8")
                    authorized = head + b"\r\nAuthorization: Basic " + base64.b64encode(raw) + b"\r\n\r\n" + body
                    if self._contact_key is None:
                        response = self._dispatch(bytes.fromhex(subject), bytes.fromhex(attempt), authorized)
                    else:
                        response = self._dispatch(
                            bytes.fromhex(subject), bytes.fromhex(attempt), authorized, authority_claim
                        )
                    result.append(response)
                    return
                if operation == "stop_all":
                    if self.stop_all is None:
                        raise RuntimeError("global stop unavailable")
                    self.stop_all()
                else:
                    if operation == "revoke_contact" and self._contact_key is not None:
                        self.erase(bytes.fromhex(subject), contact_id)
                    else:
                        self.erase(bytes.fromhex(subject))
                result.append(True)
            except Exception:
                result.append(False)
            finally:
                self._callbacks.release()
                with self._condition:
                    self._active_callbacks -= 1
                    self._condition.notify_all()
                done.set()

        threading.Thread(target=run, daemon=True).start()
        if not done.wait(self.callback_timeout) or not result[0]:
            # The timed-out callback may still complete: this is an unknown outcome.
            return {"outcome": "unknown" if operation == "dispatch" else "unavailable"}
        if operation in ("inspect_payment", "inspect_refund", "list_payments"):
            encoded = (
                base64.urlsafe_b64encode(json.dumps(result[0], sort_keys=True, separators=(",", ":")).encode())
                .decode()
                .rstrip("=")
            )
            return {"outcome": "response:" + encoded}
        if operation == "dispatch":
            response = result[0]
            if not isinstance(response, dict) or response.get("outcome") != "response":
                return {"outcome": response if response in ("cancelled", "unknown") else "unknown"}
            required = {"outcome", "http_status", "payment_id", "payment_status"}
            if set(response) not in (required, required | {"confirmation_url"}):
                return {"outcome": "unknown"}
            from urllib.parse import urlsplit

            payment_id, payment_status, url = (
                response["payment_id"],
                response["payment_status"],
                response.get("confirmation_url"),
            )
            try:
                if not isinstance(payment_id, str) or not re.fullmatch(r"[0-9a-fA-F-]{1,64}", payment_id):
                    return {"outcome": "unknown"}
                if payment_status not in ("pending", "waiting_for_capture", "succeeded", "canceled"):
                    return {"outcome": "unknown"}
                if url is not None:
                    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in url):
                        return {"outcome": "unknown"}
                    parsed = urlsplit(url)
                    if (
                        parsed.scheme != "https"
                        or parsed.hostname not in self.confirmation_hosts
                        or parsed.username
                        or parsed.password
                        or parsed.port not in (None, 443)
                        or parsed.fragment
                    ):
                        return {"outcome": "unknown"}
            except ValueError:
                return {"outcome": "unknown"}
            safe = {key: response[key] for key in ("payment_id", "payment_status")}
            if url is not None:
                safe["confirmation_url"] = url
            encoded = (
                base64.urlsafe_b64encode(json.dumps(safe, sort_keys=True, separators=(",", ":")).encode())
                .decode()
                .rstrip("=")
            )
            return {"outcome": "response:" + encoded}
        return {"outcome": "ready" if operation == "barrier" else "stopped" if operation == "stop_all" else "erased"}

    def _valid_request(self, request):
        if len(request) > 65536:
            return False
        head, sep, body = request.partition(b"\r\n\r\n")
        if not sep or len(head) > 16384:
            return False
        lines = head.split(b"\r\n")
        if lines[0] != b"POST /v3/payments HTTP/1.1":
            return False
        headers = {}
        for line in lines[1:]:
            name, colon, value = line.partition(b":")
            if not colon or not re.fullmatch(rb"[!#$%&\' *+.^_`|~0-9A-Za-z-]+".replace(b" ", b""), name):
                return False
            name = name.lower()
            if name in headers or any(c < 32 or c > 126 for c in value):
                return False
            headers[name] = value.strip()
        if not (
            headers.get(b"host") == self.provider_host.encode("ascii")
            and b"transfer-encoding" not in headers
            and headers.get(b"content-length", b"").isdigit()
            and int(headers[b"content-length"]) == len(body)
            and headers.get(b"content-type", b"").lower() == b"application/json"
            and re.fullmatch(rb"[A-Za-z0-9._:-]{1,64}", headers.get(b"idempotence-key", b""))
        ):
            return False
        if b"authorization" in headers:
            return False
        try:
            parsed = json.loads(body, object_pairs_hook=_unique_object)
            if not isinstance(parsed, dict):
                return False
        except (ValueError, UnicodeError):
            return False
        return True

    def close(self, timeout=2):
        """Return false if any callback is unresolved; caller must keep state alive."""
        deadline = time.monotonic() + timeout
        self._stop.set()
        with self._condition:
            for conn in tuple(self._active_connections):
                try:
                    conn.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            while not self._stopped.is_set() or self._active_connections or self._active_callbacks:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
            return True
