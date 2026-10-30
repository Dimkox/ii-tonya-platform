import unittest
from provider_reader import ProviderReader

class Response:
    status = 200
    def __init__(self, payload): self.payload = payload
    def read(self, count): return self.payload[:count]

class Connection:
    def __init__(self, payload): self.payload = payload; self.requests = []
    def request(self, method, path, headers): self.requests.append((method, path, headers))
    def getresponse(self): return Response(self.payload)
    def close(self): pass

class ProviderReaderTests(unittest.TestCase):
    def test_payment_strips_customer_and_keeps_verification_fields(self):
        conn = Connection(b'{"id":"abc-123","status":"pending","paid":false,"test":true,"amount":{"value":"10.00","currency":"RUB"},"created_at":"2026-01-01T00:00:00Z","metadata":{"order_id":"1","operation_id":"2","user_id":"3","purpose":"onboarding","extra":"secret"},"customer":{"email":"canary@example.com"},"refundable":false}')
        reader = ProviderReader(('1','s'), factory=lambda: conn)
        result = reader.inspect_payment('abc-123')
        self.assertEqual(result['id'], 'abc-123')
        self.assertIs(result['refundable'], False)
        self.assertNotIn('canary', str(result))
        self.assertNotIn('secret', str(result))
        self.assertEqual(conn.requests[0][1], '/v3/payments/abc-123')
        self.assertIn('Authorization', conn.requests[0][2])

    def test_rejects_paths_invalid_objects_and_list_window(self):
        reader = ProviderReader(('1','s'), factory=lambda: Connection(b'{}'))
        with self.assertRaises(ValueError): reader.inspect_payment('../evil')
        with self.assertRaises(ValueError): reader.inspect_payment('valid')
        with self.assertRaises(ValueError): reader.list_payments('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 10, None)

    def test_payment_confirmation_is_allowlisted_and_available(self):
        payload = b'{"id":"abc-123","status":"pending","paid":false,"test":true,"amount":{"value":"10.00","currency":"RUB"},"created_at":"2026-01-01T00:00:00Z","metadata":{},"refundable":false,"confirmation":{"type":"redirect","confirmation_url":"https://checkout.example/pay"}}'
        reader = ProviderReader(('1','s'), factory=lambda: Connection(payload), confirmation_hosts={'checkout.example'})
        self.assertEqual(reader.inspect_payment('abc-123')['confirmation'], {'type':'redirect', 'confirmation_url':'https://checkout.example/pay'})
        reader = ProviderReader(('1','s'), factory=lambda: Connection(payload), confirmation_hosts={'other.example'})
        with self.assertRaises(ValueError): reader.inspect_payment('abc-123')

    def test_refundable_is_optional_but_must_be_boolean_if_present(self):
        payload = b'{"id":"abc-123","status":"pending","paid":false,"test":true,"amount":{"value":"10.00","currency":"RUB"},"created_at":"2026-01-01T00:00:00Z","metadata":{}}'
        reader = ProviderReader(('1','s'), factory=lambda: Connection(payload))
        self.assertNotIn('refundable', reader.inspect_payment('abc-123'))
        invalid = payload.replace(b'"metadata":{}', b'"metadata":{},"refundable":"false"')
        with self.assertRaises(ValueError): ProviderReader(('1','s'), factory=lambda: Connection(invalid)).inspect_payment('abc-123')

    def test_deferred_stage_is_preserved_and_validated(self):
        payload = b'{"id":"abc-123","status":"pending","paid":false,"test":true,"amount":{"value":"10.00","currency":"RUB"},"created_at":"2026-01-01T00:00:00Z","refundable":false,"metadata":{"purpose":"early_bird_deferred","stage":"onboarding","opaqueaccount_id":"private"}}'
        reader = ProviderReader(('1','s'), factory=lambda: Connection(payload))
        metadata = reader.inspect_payment('abc-123')['metadata']
        self.assertEqual(metadata['stage'], 'onboarding')
        self.assertNotIn('opaqueaccount_id', metadata)
        invalid = payload.replace(b'onboarding', b'unknown')
        with self.assertRaises(ValueError): ProviderReader(('1','s'), factory=lambda: Connection(invalid)).inspect_payment('abc-123')
