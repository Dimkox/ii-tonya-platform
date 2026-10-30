#!/usr/bin/env python3
"""Experimental HTTPS gateway, not production transport or a security proof.

Arming must follow externally verified process and egress fencing; all erasure
sources must be serialized by this actor. Neither condition is implemented.
"""
import select
import math
import socket
import ssl
import threading
import time

def _decode_chunked(data):
    """Return body only after a complete strictly framed bounded chunk stream."""
    import re
    position = 0
    output = bytearray()
    while True:
        end = data.find(b'\r\n', position)
        if end < 0:
            if len(data) - position > 1024: raise ValueError('oversized chunk line')
            return None
        line = data[position:end]
        if len(line) > 1024 or not re.fullmatch(rb'[0-9A-Fa-f]+(?:;[\x21-\x7e]+)?', line): raise ValueError('invalid chunk line')
        size = int(line.split(b';', 1)[0], 16)
        position = end + 2
        if size == 0:
            while True:
                end = data.find(b'\r\n', position)
                if end < 0: return None
                trailer = data[position:end]
                position = end + 2
                if not trailer:
                    if position != len(data): raise ValueError('unexpected trailing data')
                    return bytes(output)
                name, separator, value = trailer.partition(b':')
                if not separator or not re.fullmatch(rb'[!#$%&\' *+.^_`|~0-9A-Za-z-]+'.replace(b' ', b''), name) or any(c < 32 or c > 126 for c in value):
                    raise ValueError('invalid trailer')
                if name.lower() in (b'content-length', b'transfer-encoding'):
                    raise ValueError('invalid framing trailer')
        if size > 65536 or len(output) + size > 65536: raise ValueError('oversized chunk')
        if len(data) < position + size + 2: return None
        output.extend(data[position:position+size])
        position += size
        if data[position:position+2] != b'\r\n': raise ValueError('invalid chunk terminator')
        position += 2


def parse_response(data, confirmation_hosts=None):
    """Accept only a complete, bounded HTTP/1.1 response with a fixed length."""
    import json
    import re
    head, separator, body = data.partition(b'\r\n\r\n')
    if not separator or len(head) > 16384:
        return None
    lines = head.split(b'\r\n')
    match = re.fullmatch(rb'HTTP/1\.1 ([1-5][0-9][0-9])(?: [\x20-\x7e]*)?', lines[0])
    if not match:
        return None
    status = int(match.group(1))
    if status < 200:
        return None
    headers = {}
    for line in lines[1:]:
        name, sep, value = line.partition(b':')
        if not sep or not re.fullmatch(rb'[!#$%&\'*+.^_`|~0-9A-Za-z-]+', name):
            return None
        name = name.lower()
        if name in headers or any(c < 32 and c != 9 or c == 127 for c in value):
            return None
        headers[name] = value.strip()
    if b'transfer-encoding' in headers:
        if headers[b'transfer-encoding'].lower() != b'chunked' or b'content-length' in headers: return None
        try: body = _decode_chunked(body)
        except ValueError: return None
        if body is None: return None
    else:
        if not re.fullmatch(rb'[0-9]+', headers.get(b'content-length', b'')): return None
        if int(headers[b'content-length']) != len(body): return None
    try:
        payload = json.loads(body.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    payment_id = payload.get('id')
    payment_status = payload.get('status')
    if not isinstance(payment_id, str) or not re.fullmatch(r'[0-9a-fA-F-]{1,64}', payment_id):
        return None
    if payment_status not in ('pending', 'waiting_for_capture', 'succeeded', 'canceled'):
        return None
    if not 200 <= status < 300:
        return None
    result = {'outcome': 'response', 'http_status': status, 'payment_id': payment_id, 'payment_status': payment_status}
    if confirmation_hosts is not None:
        from urllib.parse import urlsplit
        confirmation = payload.get('confirmation')
        url = confirmation.get('confirmation_url') if isinstance(confirmation, dict) else None
        if url is None:
            return result
        try:
            if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in url): return None
            parts = urlsplit(url)
            if parts.scheme != 'https' or parts.hostname not in confirmation_hosts or parts.username or parts.password or parts.port not in (None, 443) or parts.fragment: return None
        except ValueError:
            return None
        result['confirmation_url'] = url
    return result

class LocalHttpGateway:
    def __init__(self, durable_state=None):
        self._durable_state = durable_state
        self._lock = threading.Lock()
        self._deleted = set()
        self._armed = False

    def arm_after_external_fencing(self):
        with self._lock:
            self._armed = True

    def delete(self, subject, persist):
        with self._lock:
            self._deleted.add(subject)
        persist()

    @staticmethod
    def _wait(connection, want_write, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0: return False
        read = [] if want_write else [connection]
        write = [connection] if want_write else []
        ready_r, ready_w, _ = select.select(read, write, [], remaining)
        return bool(ready_r or ready_w)

    def dispatch(self, subject, prepare_tls, request, *, before_admission=lambda: None, timeout=3, max_response=65536, not_after=None, attempt_id=None, confirmation_hosts=None, before_first_write=None):
        """Send exactly once on pre-established TLS; return only non-sensitive outcome.

        Any error, zero-write or OpenSSL WANT on the FIRST write is unknown:
        OpenSSL may already have transmitted ciphertext. There is no retry or
        second connection. A partial first write is unknown and is not continued. Responses are bounded, validated, and returned to the caller.
        """
        # `not_after` is a caller-supplied wall-clock deadline, not proof of
        # current database authority or of a trustworthy system clock. The check
        # and send are not atomic: scheduling can delay the first write past expiry.
        if not_after is not None and (isinstance(not_after, bool) or not isinstance(not_after, (int, float)) or not math.isfinite(not_after) or time.time() >= not_after):
            return 'cancelled'
        deadline = time.monotonic() + timeout
        try:
            connection = prepare_tls()
        except (OSError, ssl.SSLError):
            return 'unknown'
        if time.monotonic() >= deadline:
            connection.close()
            return 'unknown'
        try:
            before_admission()
            with self._lock:
                if time.monotonic() >= deadline or (not_after is not None and time.time() >= not_after) or not self._armed or subject in self._deleted:
                    return 'cancelled'
                connection.setblocking(False)
                try:
                    if self._durable_state is None:
                        written = connection.send(request)
                    else:
                        result = []
                        def write():
                            if before_first_write is not None and before_first_write() is not True:
                                raise RuntimeError('authority claim unavailable')
                            result.append(connection.send(request))
                        admitted = self._durable_state.begin_named_attempt(subject, attempt_id, write)
                        if not admitted:
                            return 'cancelled'
                        written = result[0]
                except (ssl.SSLWantReadError, ssl.SSLWantWriteError, BlockingIOError, OSError, RuntimeError):
                    return 'unknown'
                if written <= 0: return 'unknown'
            # A partial first TLS write may contain only HTTP headers. Do not
            # send remaining bytes after deletion could have been accepted.
            if written != len(request):
                return 'unknown'
            response = bytearray()
            while True:
                try:
                    chunk = connection.recv(4096)
                except ssl.SSLWantReadError:
                    if not self._wait(connection, False, deadline): return 'unknown'
                    continue
                except ssl.SSLWantWriteError:
                    if not self._wait(connection, True, deadline): return 'unknown'
                    continue
                except (BlockingIOError, OSError):
                    return 'unknown'
                if not chunk: break
                response.extend(chunk)
                if len(response) > max_response: return 'unknown'
                head, sep, body = response.partition(b'\r\n\r\n')
                if sep:
                    fields = [line.partition(b':') for line in head.split(b'\r\n')[1:]]
                    lengths = [value.strip() for name, colon, value in fields if colon and name.lower() == b'content-length']
                    transfers = [value.strip().lower() for name, colon, value in fields if colon and name.lower() == b'transfer-encoding']
                    if transfers:
                        if transfers != [b'chunked'] or lengths: return 'unknown'
                        try:
                            if _decode_chunked(bytes(body)) is not None: break
                        except ValueError: return 'unknown'
                    else:
                        if len(lengths) != 1 or not lengths[0].isdigit(): return 'unknown'
                        expected = int(lengths[0])
                        if len(head) + 4 + expected > max_response: return 'unknown'
                        if len(body) >= expected: break
                elif len(response) > 16384: return 'unknown'
            return parse_response(bytes(response), confirmation_hosts) or 'unknown'
        finally:
            connection.close()

# There is deliberately no live CLI: an environment flag cannot attest that
# every deletion source and every process is fenced. Integration remains off.
if __name__ == '__main__':
    print('{"outcome":"disabled"}')
    raise SystemExit(1)
