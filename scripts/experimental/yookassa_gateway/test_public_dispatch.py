"""New public opcode tests; no old discovery or external provider access."""

import base64
import copy
import hashlib
import hmac
import json
import os
import socket
import ssl
import tempfile
import threading
import unittest
from unittest.mock import patch

from bound_gateway import BoundGateway
from ipc import GatewayServer
from nonce_registry import NonceRegistry
from subject_tokens import contact_token
from provider_reader import ProviderReader
from test_provider_reader import Connection
import test_gateway

USER = "11111111-1111-4111-8111-111111111111"
REQUEST = "22222222-2222-4222-8222-222222222222"
CONTACT = "33333333-3333-4333-8333-333333333333"
IDEMPOTENCY = "44444444-4444-4444-8444-444444444444"
OPERATION = "55555555-5555-4555-8555-555555555555"
ORDER = "66666666-6666-4666-8666-666666666666"
KEY = b"s" * 32


def fixture(kind="onboarding_create"):
    free = kind in ("onboarding_capture", "onboarding_cancel")
    amount = {"value": "3000.00", "currency": "RUB"}
    metadata = {
        "purpose": "public_main_refund"
        if kind == "main_refund"
        else "main_residency"
        if kind == "main_create"
        else "onboarding",
        "operation_id": OPERATION,
        "order_id": ORDER,
        "user_id": USER,
    }
    body = {"amount": amount}
    if kind == "onboarding_cancel":
        body = {}
    if not free:
        body.update(
            metadata=metadata,
            receipt={
                "customer": {"email": "synthetic@example.com"},
                "items": [
                    {
                        "description": "Service",
                        "quantity": "1.00",
                        "amount": amount,
                        "vat_code": 1,
                        "payment_subject": "service",
                        "payment_mode": "full_payment",
                    }
                ],
            },
        )
        if kind == "main_refund":
            body["payment_id"] = "a1"
        else:
            body.update(
                capture=kind == "main_create",
                confirmation={"type": "redirect", "return_url": "https://example.com/return"},
            )
            if kind == "onboarding_create":
                body["payment_method_data"] = {"type": "bank_card"}
    raw = json.dumps(body, separators=(",", ":")).encode()
    snapshot = dict(
        version=1,
        requestId=REQUEST,
        userId=USER,
        product="refund" if kind == "main_refund" else "main" if kind == "main_create" else "onboarding",
        kind=kind,
        legacySourceId=ORDER,
        legacyOperationId=OPERATION,
        mode="test",
        amountMinor="300000",
        currency="RUB",
        idempotencyKey=IDEMPOTENCY,
        contactId=None if free else CONTACT,
        parentPaymentId="a1" if free or kind == "main_refund" else None,
        requestDigest="sha256:" + hashlib.sha256(raw).hexdigest(),
        bodyVersion=1,
        bodyExpiresAt=None if free else "2026-11-01T00:00:00Z",
        paymentDeadline="2026-11-01T00:00:00Z",
        providerDeadline="2026-11-01T00:00:00Z",
        createdAt="2026-10-30T00:00:00Z",
        state="uncertain",
        providerObjectId="a1" if free else None,
        envelope=None if free else {"ciphertext": "sealed", "keyReference": "local:key"},
    )
    claim = (USER, REQUEST, None if free else CONTACT, IDEMPOTENCY, snapshot["requestDigest"], kind)
    return snapshot, raw, claim


class PublicDispatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_gateway.HttpGatewayTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        test_gateway.HttpGatewayTests.tearDownClass()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = os.path.join(self.temp.name, "state")
        os.mkdir(self.directory, 0o700)
        self.authority = type("Authority", (), {})()
        self.runtime = BoundGateway(self.directory, synthetic_fresh_start=True, authority=self.authority)
        self.claims = []
        self.snapshot, self.body, self.claim = fixture()
        self.authority.claim_public = lambda *args: self.claims.append(args) or self.snapshot
        self.attempt = hashlib.sha256(bytes.fromhex(IDEMPOTENCY.replace("-", ""))).digest()

    def tearDown(self):
        self.runtime.close()
        self.temp.cleanup()

    def dispatch(self, body=None, claim=None, subject=None):
        self.assertTrue(callable(getattr(self.runtime, "dispatch_public", None)), "public dispatch missing")
        observed = []
        # Real LocalHttpGateway first-write/journal path; socket peer is a local TLS fixture.
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(test_gateway.HttpGatewayTests.cert, test_gateway.HttpGatewayTests.key)

        def serve():
            raw, _ = listener.accept()
            with ctx.wrap_socket(raw, server_side=True) as conn:
                conn.settimeout(2)
                data = b""
                while b"\r\n\r\n" not in data:
                    chunk = conn.recv(65536)
                    if not chunk:
                        break
                    data += chunk
                if data:
                    head, received = data.split(b"\r\n\r\n", 1)
                    length = int(
                        next(
                            line.split(b":", 1)[1]
                            for line in head.split(b"\r\n")
                            if line.lower().startswith(b"content-length:")
                        )
                    )
                    while len(received) < length:
                        received += conn.recv(65536)
                    observed.append((head, received))
                    conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 30\r\n\r\n{"id":"a1","status":"pending"}')
            listener.close()

        thread = threading.Thread(target=serve)
        thread.start()

        def prepare():
            context = ssl.create_default_context(cafile=test_gateway.HttpGatewayTests.cert)
            return context.wrap_socket(socket.create_connection(listener.getsockname()), server_hostname="localhost")

        def response_factory():
            row = self.snapshot
            parent = row["kind"] == "main_refund"
            value = dict(
                id="a1",
                status="succeeded" if parent else "pending",
                paid=parent,
                test=True,
                refundable=False,
                amount={"value": "3000.00", "currency": "RUB"},
                created_at="2026-10-30T00:00:00Z",
                metadata={
                    "purpose": "main_residency" if parent or row["kind"] == "main_create" else "onboarding",
                    "operation_id": OPERATION,
                    "order_id": ORDER,
                    "user_id": USER,
                },
            )
            if parent:
                value["captured_at"] = "2026-10-30T00:01:00Z"
            return Connection(json.dumps(value).encode())

        reader = ProviderReader(("1", "synthetic"), factory=response_factory)
        try:
            result = self.runtime.dispatch_public(
                subject or b"o" * 32,
                self.attempt,
                prepare,
                self.body if body is None else body,
                self.claim if claim is None else claim,
                merchant_auth=("1", "synthetic"),
                provider_reader=reader,
            )
        finally:
            thread.join(3)
        return result, observed

    def test_all_five_paths_are_derived_from_authoritative_claim(self):
        for kind, path in [
            ("onboarding_create", "/v3/payments"),
            ("main_create", "/v3/payments"),
            ("main_refund", "/v3/refunds"),
            ("onboarding_capture", "/v3/payments/a1/capture"),
            ("onboarding_cancel", "/v3/payments/a1/cancel"),
        ]:
            with self.subTest(kind=kind):
                self.runtime.close()
                self.temp.cleanup()
                self.setUp()
                self.snapshot, self.body, self.claim = fixture(kind)
                _, written = self.dispatch()
                self.assertEqual(len(written), 1)
                self.assertTrue(written[0][0].startswith(("POST " + path + " HTTP/1.1\r\n").encode()))
                self.assertIn(b"Host: api.yookassa.ru\r\n", written[0][0])
                self.assertEqual(written[0][1], self.body)
                self.assertEqual(self.claims, [self.claim])

    def test_matching_digest_cannot_authorize_wrong_financial_semantics(self):
        mutations = [
            lambda b: b["amount"].update(value="1.00"),
            lambda b: b.update(capture=True),
            lambda b: b["metadata"].update(user_id=REQUEST),
            lambda b: b["receipt"]["items"][0].update(quantity="2.00"),
            lambda b: b["receipt"]["items"][0].update(payment_subject="commodity"),
            lambda b: b.update(payment_id="a2"),
            lambda b: b.pop("receipt"),
        ]
        for mutation in mutations:
            body = copy.deepcopy(json.loads(self.body))
            mutation(body)
            raw = json.dumps(body).encode()
            self.snapshot["requestDigest"] = "sha256:" + hashlib.sha256(raw).hexdigest()
            claim = (*self.claim[:4], self.snapshot["requestDigest"], self.claim[5])
            self.attempt = os.urandom(32)
            _, written = self.dispatch(raw, claim)
            self.assertEqual(written, [])

    def test_duplicate_json_nonfinite_and_forged_claim_send_nothing(self):
        for raw in [b'{"amount":{},"amount":{}}', b'{"x":NaN}', b"{}"]:
            self.attempt = os.urandom(32)
            _, written = self.dispatch(raw)
            self.assertEqual(written, [])
        self.snapshot["kind"] = "onboarding_capture"
        _, written = self.dispatch()
        self.assertEqual(written, [])

    def test_contact_revocation_blocks_create_but_not_authorized_cancel_and_no_replay(self):
        subject = contact_token(KEY, CONTACT)
        self.runtime._state.delete(subject)
        _, written = self.dispatch(subject=subject)
        self.assertEqual(written, [])
        self.snapshot, self.body, self.claim = fixture("onboarding_cancel")
        _, written = self.dispatch(subject=b"o" * 32)
        self.assertEqual(len(written), 1)
        _, repeated = self.dispatch(subject=b"o" * 32)
        self.assertEqual(repeated, [])
        self.assertEqual(len(self.claims), 1)

    def test_authenticated_opcode_rejects_forged_path_and_consumes_nonce(self):
        registry = NonceRegistry.initialize(os.path.join(self.temp.name, "nonce.sqlite"), b"a" * 32)
        sent = []
        server = GatewayServer(
            "\0public-test",
            erase=lambda _: None,
            dispatch=lambda *_: None,
            public_dispatch=lambda *args: sent.append(args) or "unknown",
            allowed_pids={os.getpid()},
            auth_key=b"a" * 32,
            nonce_registry=registry,
            merchant_auth=("1", "synthetic"),
            contact_key=KEY,
        )
        command = {
            "op": "public_dispatch",
            "user_id": USER,
            "request_id": REQUEST,
            "idempotency_key": IDEMPOTENCY,
            "contact_id": CONTACT,
            "kind": "onboarding_create",
            "subject": contact_token(KEY, CONTACT).hex(),
            "attempt": self.attempt.hex(),
            "request": base64.b64encode(self.body).decode(),
        }
        nonce, challenge = "1" * 64, "2" * 64

        def packet(value):
            body = json.dumps(value)
            mac = hmac.new(
                b"a" * 32, ("request\n" + nonce + "\n" + challenge + "\n" + body).encode(), hashlib.sha256
            ).hexdigest()
            return json.dumps(dict(nonce=nonce, challenge=challenge, body=body, mac=mac)).encode() + b"\n"

        try:
            forged = {**command, "path": "/evil"}
            self.assertEqual(server._handle(packet(forged), nonce, challenge)["outcome"], "invalid")
            self.assertIsNone(server._handle(packet(command), nonce, challenge))
            self.assertEqual(sent, [])
            nonce = "3" * 64
            self.assertEqual(server._handle(packet(command), nonce, challenge)["outcome"], "unknown")
            self.assertEqual(len(sent), 1)
            nonce = "4" * 64
            self.assertEqual(
                server._handle(packet({**command, "contact_id": None}), nonce, challenge)["outcome"], "invalid"
            )
            nonce = "5" * 64
            cancel = {
                **command,
                "kind": "onboarding_cancel",
                "contact_id": None,
                "subject": None,
                "request": "e30=",
                "operation_token": hmac.new(
                    KEY,
                    b"ii-tonya-gateway-public-operation-v1\0" + bytes.fromhex(REQUEST.replace("-", "")),
                    hashlib.sha256,
                ).hexdigest(),
            }
            self.assertEqual(server._handle(packet(cancel), nonce, challenge)["outcome"], "unknown")
            self.assertEqual(len(sent), 2)
            nonce = "6" * 64
            self.assertEqual(
                server._handle(packet({**cancel, "operation_token": command["subject"]}), nonce, challenge)["outcome"],
                "invalid",
            )
        finally:
            registry.close()

    def test_pg_claim_returns_strict_snapshot_not_boolean_and_fails_closed(self):
        from pg_authority import PgAuthority

        authority = PgAuthority(
            psql_path="/usr/bin/psql", service="synthetic", service_file="/tmp/service", pass_file="/tmp/pass"
        )
        self.assertTrue(callable(getattr(authority, "claim_public", None)), "typed PG claim missing")
        with patch("pg_authority.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = (json.dumps(self.snapshot) + "\n").encode()
            self.assertEqual(authority.claim_public(*self.claim), self.snapshot)
            run.return_value.stdout = b"t\n"
            self.assertIsNone(authority.claim_public(*self.claim))
            run.return_value.stdout = b'{"kind":"onboarding_create"}\n'
            self.assertIsNone(authority.claim_public(*self.claim))
