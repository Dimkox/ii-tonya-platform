"""Fixed YooKassa GETs; synthetic integration only until authority is wired."""

import base64
import datetime
import http.client
import re
import ssl
import uuid

from pg_authority import strict_json
from urllib.parse import urlencode, urlsplit


class ProviderReader:
    def __init__(self, merchant_auth, *, factory=None, confirmation_hosts=frozenset()):
        if (
            not isinstance(merchant_auth, tuple)
            or len(merchant_auth) != 2
            or any(not isinstance(x, str) or not x or ":" in x or "\n" in x or "\r" in x for x in merchant_auth)
        ):
            raise ValueError("invalid merchant credentials")
        self._confirmation_hosts = frozenset(confirmation_hosts)
        self._authorization = "Basic " + base64.b64encode((merchant_auth[0] + ":" + merchant_auth[1]).encode()).decode()
        self._factory = factory or (
            lambda: http.client.HTTPSConnection("api.yookassa.ru", 443, timeout=3, context=ssl.create_default_context())
        )

    @staticmethod
    def _id(value):
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
            raise ValueError("invalid provider id")
        return value

    def _get(self, path):
        conn = self._factory()
        try:
            conn.request("GET", path, headers={"Authorization": self._authorization, "Accept": "application/json"})
            response = conn.getresponse()
            if response.status != 200:
                raise ValueError("provider unavailable")
            data = response.read(65537)
            if len(data) > 65536:
                raise ValueError("provider response too large")
            value = strict_json(data)
            if not isinstance(value, dict):
                raise ValueError("invalid provider response")
            return value
        finally:
            conn.close()

    @staticmethod
    def _amount(value):
        if (
            not isinstance(value, dict)
            or not isinstance(value.get("value"), str)
            or not re.fullmatch(r"\d{1,12}\.\d{2}", value["value"])
            or value.get("currency") != "RUB"
        ):
            raise ValueError("invalid amount")
        return {"value": value["value"], "currency": "RUB"}

    @staticmethod
    def _timestamp(value):
        if not isinstance(value, str) or len(value) > 40:
            raise ValueError("invalid timestamp")
        try:
            parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError()
        except ValueError as error:
            raise ValueError("invalid timestamp") from error
        return parsed

    @staticmethod
    def _metadata(value):
        if not isinstance(value, dict):
            raise ValueError("invalid metadata")
        result = {}
        for key in (
            "order_id",
            "operation_id",
            "user_id",
            "purpose",
            "pricing_policy",
            "price_kind",
            "pricing_grant_id",
            "stage",
        ):
            if key in value:
                if not isinstance(value[key], str) or len(value[key]) > 128:
                    raise ValueError("invalid metadata")
                if key == "stage" and value[key] not in ("onboarding", "subscription"):
                    raise ValueError("invalid metadata stage")
                result[key] = value[key]
        return result

    def _payment(self, value):
        if not isinstance(value, dict):
            raise ValueError("invalid payment")
        result = {
            "id": self._id(value.get("id")),
            "status": value.get("status"),
            "paid": value.get("paid"),
            "test": value.get("test"),
            "amount": self._amount(value.get("amount")),
            "created_at": value.get("created_at"),
            "metadata": self._metadata(value.get("metadata")),
        }
        if (
            result["status"] not in ("pending", "waiting_for_capture", "succeeded", "canceled")
            or type(result["paid"]) is not bool
            or type(result["test"]) is not bool
        ):
            raise ValueError("invalid payment")
        self._timestamp(result["created_at"])
        if "payment_method" in value and value["payment_method"] is not None:
            method = value["payment_method"]
            if (
                not isinstance(method, dict)
                or not isinstance(method.get("type"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", method["type"])
            ):
                raise ValueError("invalid payment method")
            result["payment_method"] = {"type": method["type"]}
        if "captured_at" in value and value["captured_at"] is not None:
            self._timestamp(value["captured_at"])
            result["captured_at"] = value["captured_at"]
        if "confirmation" in value and value["confirmation"] is not None:
            confirmation = value["confirmation"]
            url = confirmation.get("confirmation_url") if isinstance(confirmation, dict) else None
            if url is not None:
                if confirmation.get("type") != "redirect":
                    raise ValueError("invalid confirmation type")
                try:
                    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in url):
                        raise ValueError()
                    parsed = urlsplit(url)
                    if (
                        parsed.scheme != "https"
                        or parsed.hostname not in self._confirmation_hosts
                        or parsed.username
                        or parsed.password
                        or parsed.port not in (None, 443)
                        or parsed.fragment
                    ):
                        raise ValueError()
                except ValueError as error:
                    raise ValueError("invalid confirmation URL") from error
                result["confirmation"] = {"type": "redirect", "confirmation_url": url}
        if "refundable" in value:
            if type(value["refundable"]) is not bool:
                raise ValueError("invalid refundable")
            result["refundable"] = value["refundable"]
        return result

    def inspect_payment(self, payment_id):
        value = self._payment(self._get("/v3/payments/" + self._id(payment_id)))
        if value["id"] != payment_id:
            raise ValueError("provider id mismatch")
        return value

    @staticmethod
    def _refund(raw):
        if not isinstance(raw, dict):
            raise ValueError("invalid refund")
        result = {
            "id": ProviderReader._id(raw.get("id")),
            "payment_id": ProviderReader._id(raw.get("payment_id")),
            "status": raw.get("status"),
            "amount": ProviderReader._amount(raw.get("amount")),
            "created_at": raw.get("created_at"),
        }
        if result["status"] not in ("pending", "succeeded", "canceled"):
            raise ValueError("invalid refund")
        ProviderReader._timestamp(result["created_at"])
        if "metadata" in raw:
            metadata = raw["metadata"]
            if not isinstance(metadata, dict):
                raise ValueError("invalid refund identity")
            if metadata.get("purpose") == "public_main_refund":
                if set(metadata) != {"purpose", "operation_id", "order_id", "user_id"}:
                    raise ValueError("invalid refund identity")
                for key in ("operation_id", "order_id", "user_id"):
                    if not isinstance(metadata[key], str) or str(uuid.UUID(metadata[key])) != metadata[key]:
                        raise ValueError("invalid refund identity")
            result["metadata"] = ProviderReader._metadata(metadata)
        return result

    def inspect_refund(self, refund_id):
        result = self._refund(self._get("/v3/refunds/" + self._id(refund_id)))
        if result["id"] != refund_id:
            raise ValueError("provider id mismatch")
        return result

    def list_refunds(self, created_from, created_to, limit, cursor):
        return self._list("refunds", self._refund, created_from, created_to, limit, cursor)

    def list_payments(self, created_from, created_to, limit, cursor):
        return self._list("payments", self._payment, created_from, created_to, limit, cursor)

    def _list(self, resource, project, created_from, created_to, limit, cursor):
        start, end = self._timestamp(created_from), self._timestamp(created_to)
        if (
            start >= end
            or (end - start) > datetime.timedelta(days=31)
            or type(limit) is not int
            or not 1 <= limit <= 100
        ):
            raise ValueError("invalid query bounds")
        if cursor is not None and (
            not isinstance(cursor, str)
            or not cursor
            or len(cursor) > 512
            or any(ord(c) < 33 or ord(c) > 126 for c in cursor)
        ):
            raise ValueError("invalid cursor")
        params = {"created_at.gte": created_from, "created_at.lt": created_to, "limit": str(limit)}
        if cursor is not None:
            params["cursor"] = cursor
        raw = self._get("/v3/" + resource + "?" + urlencode(params))
        if not isinstance(raw.get("items"), list) or len(raw["items"]) > limit:
            raise ValueError("invalid page")
        items = [project(item) for item in raw["items"] if isinstance(item, dict)]
        if len(items) != len(raw["items"]) or len({item["id"] for item in items}) != len(items):
            raise ValueError("invalid page")
        next_cursor = raw.get("next_cursor")
        if next_cursor is not None and (
            not isinstance(next_cursor, str)
            or not next_cursor
            or len(next_cursor) > 512
            or any(ord(c) < 33 or ord(c) > 126 for c in next_cursor)
        ):
            raise ValueError("invalid page cursor")
        return {"items": items, **({"next_cursor": next_cursor} if next_cursor is not None else {})}
