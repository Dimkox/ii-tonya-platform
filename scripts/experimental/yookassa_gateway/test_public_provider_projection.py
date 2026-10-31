"""Public projection controls exercise the real reader over a synthetic HTTP seam."""

import json
import unittest
from provider_reader import ProviderReader
from test_provider_reader import Connection

META = {
    "purpose": "public_main_refund",
    "operation_id": "11111111-1111-4111-8111-111111111111",
    "order_id": "22222222-2222-4222-8222-222222222222",
    "user_id": "33333333-3333-4333-8333-333333333333",
}


class PublicProjectionTests(unittest.TestCase):
    def reader(self, payload):
        return ProviderReader(("1", "synthetic"), factory=lambda: Connection(json.dumps(payload).encode()))

    def test_genuine_method_is_preserved_and_absence_is_not_invented(self):
        payment = dict(
            id="a1",
            status="pending",
            paid=False,
            test=True,
            amount=dict(value="3000.00", currency="RUB"),
            created_at="2026-10-30T00:00:00Z",
            metadata={},
            refundable=False,
        )
        self.assertNotIn("payment_method", self.reader(payment).inspect_payment("a1"))
        for method in ("bank_card", "sbp"):
            payment["payment_method"] = {"type": method, "card": {"first6": "private"}}
            self.assertEqual(self.reader(payment).inspect_payment("a1")["payment_method"], {"type": method})

    def test_refund_preserves_strict_identity_and_omits_invented_payment_facts(self):
        refund = dict(
            id="b1",
            payment_id="a1",
            status="succeeded",
            amount=dict(value="3000.00", currency="RUB"),
            created_at="2026-10-30T00:00:00Z",
            metadata=META,
            customer={"email": "private@example.com"},
        )
        result = self.reader(refund).inspect_refund("b1")
        self.assertEqual(result["metadata"], META)
        self.assertNotIn("test", result)
        self.assertNotIn("private", str(result))
        for metadata in (
            {**META, "user_id": "forged"},
            {**META, "email": "private@example.com"},
            {"purpose": "public_main_refund"},
        ):
            with self.assertRaises(ValueError):
                self.reader({**refund, "metadata": metadata}).inspect_refund("b1")

    def test_refund_list_is_bounded_and_rejects_truncation_duplicates_and_unsafe_cursors(self):
        refund = dict(
            id="b1",
            payment_id="a1",
            status="pending",
            amount=dict(value="3000.00", currency="RUB"),
            created_at="2026-10-30T00:00:00Z",
            metadata=META,
        )
        reader = self.reader({"items": [refund], "next_cursor": "next"})
        self.assertTrue(callable(getattr(reader, "list_refunds", None)), "refund list missing")
        page = reader.list_refunds("2026-10-30T00:00:00Z", "2026-10-31T00:00:00Z", 1, None)
        self.assertEqual(page["next_cursor"], "next")
        self.assertEqual(page["items"][0]["metadata"], META)
        for raw in ({"items": [refund, refund]}, {"items": [], "next_cursor": "bad\n"}, {"items": "truncated"}):
            with self.assertRaises(ValueError):
                self.reader(raw).list_refunds("2026-10-30T00:00:00Z", "2026-10-31T00:00:00Z", 1, None)

    def test_duplicate_and_nonstandard_provider_json_is_not_accepted(self):
        for payload in (b'{"id":"a1","id":"a2"}', b'{"x":NaN}'):
            with self.assertRaises(ValueError):
                ProviderReader(("1", "synthetic"), factory=lambda: Connection(payload))._get("/v3/payments/a1")
