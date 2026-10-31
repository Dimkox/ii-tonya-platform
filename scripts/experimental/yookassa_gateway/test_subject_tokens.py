import unittest
from subject_tokens import user_token


class SubjectTokenTests(unittest.TestCase):
    def test_same_user_maps_all_contacts_and_uuid_case_to_one_token(self):
        key = b"k" * 32
        lower = "12345678-abcd-4abc-8abc-123456789abc"
        self.assertEqual(user_token(key, lower), user_token(key, lower.upper()))
        self.assertNotIn(lower.encode(), user_token(key, lower))
        self.assertNotEqual(user_token(key, lower), user_token(b"z" * 32, lower))
        self.assertNotEqual(user_token(key, lower), user_token(key, "12345678-abcd-4abc-8abc-123456789abd"))

    def test_rejects_invalid_key_and_user(self):
        for key, user in [(b"short", "12345678-abcd-4abc-8abc-123456789abc"), (b"k" * 32, "email@example.com")]:
            with self.assertRaises(ValueError):
                user_token(key, user)

    def test_contact_tokens_are_domain_separated_and_distinct(self):
        from subject_tokens import contact_token

        key = b"k" * 32
        first = "12345678-abcd-4abc-8abc-123456789abc"
        second = "12345678-abcd-4abc-8abc-123456789abd"
        self.assertNotEqual(contact_token(key, first), user_token(key, first))
        self.assertNotEqual(contact_token(key, first), contact_token(key, second))
        self.assertEqual(contact_token(key, first), contact_token(key, first.upper()))
