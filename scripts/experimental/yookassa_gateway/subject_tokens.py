"""User-scoped experimental gateway identifiers, never raw user IDs on IPC.

Both sending and revocation must use the same separately managed key and user
UUID. Key rotation requires a fail-closed migration of every pending operation.
"""

import hashlib
import hmac
import uuid


def _token(key, user_id, domain):
    if not isinstance(key, bytes) or len(key) < 32 or not isinstance(user_id, str):
        raise ValueError("invalid subject identity")
    try:
        parsed = uuid.UUID(user_id)
    except ValueError as error:
        raise ValueError("invalid subject identity") from error
    if str(parsed) != user_id.lower():
        raise ValueError("canonical UUID required")
    return hmac.digest(key, domain + parsed.bytes, hashlib.sha256)


def user_token(key, user_id):
    return _token(key, user_id, b"ii-tonya-gateway-user-v1\0")


def contact_token(key, contact_id):
    return _token(key, contact_id, b"ii-tonya-gateway-contact-v1\0")
