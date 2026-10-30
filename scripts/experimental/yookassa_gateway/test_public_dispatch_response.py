"""Previously untested returned responses and delayed refund-parent authority boundary.

No old test is executed. Local TLS and HTTP fixtures never contact a provider.
"""

import copy
import hashlib
import json
import os
import tempfile
import threading
import time
import unittest

from bound_gateway import BoundGateway
from provider_reader import ProviderReader
from test_provider_reader import Connection
from test_public_dispatch import fixture, USER, OPERATION, ORDER, IDEMPOTENCY
import test_gateway


class PublicDispatchResponseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_gateway.HttpGatewayTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        test_gateway.HttpGatewayTests.tearDownClass()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = os.path.join(self.temp.name, "state")
        os.mkdir(self.state, 0o700)
        self.events = []
        self.claims = []
        self.authority = type("Authority", (), {})()
        self.authority.claim_public = self.claim_public
        self.runtime = BoundGateway(self.state, synthetic_fresh_start=True, authority=self.authority)
        self.snapshot, self.body, self.claim = fixture()
        self.authority_expires = float("inf")
        self.parent_entered, self.parent_release = threading.Event(), threading.Event()
        self.parent_release.set()
        self.parent = self.payment(purpose="main_residency", status="succeeded")
        self.observation = self.payment()
        self.attempt = hashlib.sha256(bytes.fromhex(IDEMPOTENCY.replace("-", ""))).digest()

    def tearDown(self):
        self.runtime.close()
        self.temp.cleanup()

    def claim_public(self, *args):
        self.events.append("claim")
        self.claims.append(args)
        return copy.deepcopy(self.snapshot) if time.monotonic() < self.authority_expires else None

    @staticmethod
    def payment(*, purpose="onboarding", status="pending", method=None):
        value = dict(
            id="a1",
            status=status,
            paid=status in ("waiting_for_capture", "succeeded"),
            test=True,
            amount={"value": "3000.00", "currency": "RUB"},
            created_at="2026-10-30T00:00:00Z",
            refundable=False,
            metadata={"purpose": purpose, "operation_id": OPERATION, "order_id": ORDER, "user_id": USER},
        )
        if status == "succeeded":
            value["captured_at"] = "2026-10-30T00:01:00Z"
        if method is not None:
            value["payment_method"] = {"type": method, "card": {"last4": "private"}}
        return value

    def select(self, kind):
        self.snapshot, self.body, self.claim = fixture(kind)
        if kind == "main_refund":
            self.observation = dict(
                id="b1",
                payment_id="a1",
                status="succeeded",
                amount={"value": "3000.00", "currency": "RUB"},
                created_at="2026-10-30T00:02:00Z",
                metadata={
                    "purpose": "public_main_refund",
                    "operation_id": OPERATION,
                    "order_id": ORDER,
                    "user_id": USER,
                },
            )
        elif kind == "main_create":
            self.observation = self.payment(purpose="main_residency", status="succeeded")
        else:
            self.observation = self.payment(status="succeeded", method="bank_card")

    def reader(self):
        owner = self

        class ReadConnection(Connection):
            def request(self, method, path, headers):
                super().request(method, path, headers)
                parent_read = owner.snapshot["kind"] == "main_refund" and path.startswith("/v3/payments/")
                owner.events.append("parent_get" if parent_read else "object_get")
                if parent_read:
                    owner.parent_entered.set()
                    if not owner.parent_release.wait(2):
                        raise ValueError("synthetic delayed parent timed out")
                self.payload = json.dumps(owner.parent if parent_read else owner.observation).encode()

        return ProviderReader(
            ("1", "synthetic"), factory=lambda: ReadConnection(b""), confirmation_hosts={"pay.yookassa.ru"}
        )

    def post(self, *, disconnect=False):
        object_id = "b1" if self.snapshot["kind"] == "main_refund" else "a1"
        payload = json.dumps({"id": object_id, "status": "pending"}, separators=(",", ":")).encode()
        response = b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(payload)).encode() + b"\r\n\r\n" + payload
        prepare, written, thread = test_gateway.HttpGatewayTests().server(response=response, disconnect=disconnect)
        owner = self

        def prepare_post():
            owner.events.append("prepare_post")
            connection = prepare()

            class TracedConnection:
                def __getattr__(self, name):
                    return getattr(connection, name)

                def send(self, data):
                    owner.events.append("post_write")
                    return connection.send(data)

            return TracedConnection()

        try:
            result = self.runtime.dispatch_public(
                b"f" * 32,
                self.attempt,
                prepare_post,
                self.body,
                self.claim,
                merchant_auth=("1", "synthetic"),
                provider_reader=self.reader(),
                confirmation_hosts={"pay.yookassa.ru"},
            )
        finally:
            thread.join(3)
        self.assertFalse(thread.is_alive())
        return result, written

    def test_returned_pending_redirect_accepts_absent_method(self):
        self.observation["confirmation"] = {"type": "redirect", "confirmation_url": "https://pay.yookassa.ru/synthetic"}
        result, written = self.post()
        self.assertEqual(
            result,
            {
                "outcome": "response",
                "http_status": 200,
                "payment_id": "a1",
                "payment_status": "pending",
                "confirmation_url": "https://pay.yookassa.ru/synthetic",
            },
        )
        self.assertEqual(written, [self.body])
        self.assertLess(self.events.index("claim"), self.events.index("post_write"))

    def test_returned_held_and_captured_bank_card_observations_are_accepted(self):
        for status in ("waiting_for_capture", "succeeded"):
            with self.subTest(status=status):
                self.attempt = os.urandom(32)
                self.observation = self.payment(status=status, method="bank_card")
                result, written = self.post()
                self.assertEqual(
                    result, {"outcome": "response", "http_status": 200, "payment_id": "a1", "payment_status": status}
                )
                self.assertEqual(written, [self.body])

    def test_separate_refund_and_parent_observations_return_a_refund_response(self):
        self.select("main_refund")
        result, written = self.post()
        self.assertEqual(
            result, {"outcome": "response", "http_status": 200, "payment_id": "b1", "payment_status": "succeeded"}
        )
        self.assertEqual(written, [self.body])
        # Final claim immediately precedes POST, with no provider read in between.
        self.assertEqual(self.events[self.events.index("claim") + 1], "post_write")
        self.assertEqual(self.events.count("parent_get"), 2)
        self.assertEqual(self.events.count("object_get"), 1)

    def test_missing_wrong_method_mode_amount_metadata_and_capture_facts_remain_unknown(self):
        cases = []
        for status in ("waiting_for_capture", "succeeded"):
            for method in (None, "sbp"):
                cases.append(self.payment(status=status, method=method))
        for key, value in (
            ("test", False),
            ("amount", {"value": "1.00", "currency": "RUB"}),
            ("metadata", {"purpose": "onboarding", "operation_id": OPERATION, "order_id": USER, "user_id": USER}),
            ("captured_at", "2026-10-29T23:59:59Z"),
        ):
            cases.append({**self.payment(status="succeeded", method="bank_card"), key: value})
        missing_capture = self.payment(status="succeeded", method="bank_card")
        missing_capture.pop("captured_at")
        cases.extend([missing_capture, {**self.payment(), "captured_at": "2026-10-30T00:01:00Z"}])
        for observation in cases:
            with self.subTest(observation=observation):
                self.attempt = os.urandom(32)
                self.observation = observation
                result, written = self.post()
                self.assertEqual(result, "unknown")
                self.assertEqual(written, [self.body])

    def test_wrong_refund_parent_or_metadata_is_never_returned_as_success(self):
        self.select("main_refund")
        for change in (
            {"payment_id": "a2"},
            {"metadata": {"purpose": "public_main_refund", "operation_id": USER, "order_id": ORDER, "user_id": USER}},
        ):
            with self.subTest(change=change):
                self.attempt = os.urandom(32)
                original = self.observation
                self.observation = {**original, **change}
                result, written = self.post()
                self.assertEqual(result, "unknown")
                self.assertEqual(written, [self.body])
                self.observation = original

    def test_wrong_parent_payment_facts_prevent_any_refund_post(self):
        self.select("main_refund")
        self.parent["test"] = False
        result, written = self.post()
        self.assertEqual(result, "unknown")
        self.assertEqual(written, [b""])
        self.assertNotIn("post_write", self.events)

    def test_delayed_parent_get_expires_authority_before_final_claim_and_cannot_retry(self):
        self.select("main_refund")
        self.parent_release.clear()
        self.authority_expires = time.monotonic() + 0.1
        result = []
        worker = threading.Thread(target=lambda: result.append(self.post()))
        worker.start()
        self.assertTrue(self.parent_entered.wait(2))
        # The provider read is deliberately held beyond the synthetic PG authority deadline.
        threading.Event().wait(max(0, self.authority_expires - time.monotonic()) + 0.03)
        self.parent_release.set()
        worker.join(4)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result[0][0], "unknown")
        self.assertEqual(result[0][1], [b""])
        self.assertNotIn("post_write", self.events)
        self.assertGreater(self.events.index("claim"), self.events.index("parent_get"))
        self.assertEqual(len(self.claims), 1)
        # A later positive fake authority cannot erase the durable reserved attempt.
        self.authority_expires = float("inf")
        repeated, written = self.post()
        self.assertEqual(repeated, "cancelled")
        self.assertEqual(written, [b""])
        self.assertEqual(len(self.claims), 1)
