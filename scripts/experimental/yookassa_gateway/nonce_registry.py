"""Experimental durable nonce registry; requires a trusted private directory.

Initialize explicitly once; opening never creates a missing registry. The
100000-entry capacity has no eviction: exhaustion requires coordinated key and
registry rotation. SQLite reopens by pathname, so same-UID directory replacement
and backup rollback remain outside this component's guarantees.
"""
import hashlib
import hmac
import os
import re
import sqlite3
import stat
import threading
from urllib.parse import quote


class NonceRegistry:
    @classmethod
    def initialize(cls, path, auth_key):
        cls._validate_key(auth_key)
        directory, name = cls._open_directory(path)
        try:
            fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            os.close(fd)
            os.fsync(directory)
        finally:
            os.close(directory)
        return cls(path, auth_key, _initializing=True)

    @staticmethod
    def _validate_key(key):
        if not isinstance(key, bytes) or len(key) < 32:
            raise ValueError('invalid authentication key')

    @staticmethod
    def _open_directory(path):
        parent = os.path.dirname(os.path.abspath(path))
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(directory)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            os.close(directory)
            raise ValueError('private owned directory required')
        return directory, os.path.basename(path)

    def __init__(self, path, auth_key, *, _initializing=False):
        self._validate_key(auth_key)
        self._lock = threading.Lock()
        directory, name = self._open_directory(path)
        try:
            fd = os.open(name, os.O_RDWR | os.O_NOFOLLOW, dir_fd=directory)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise ValueError('private regular registry required')
            finally:
                os.close(fd)
        finally:
            os.close(directory)
        uri = 'file:' + quote(os.path.abspath(path)) + '?mode=rw'
        self._db = sqlite3.connect(uri, uri=True, check_same_thread=False)
        try:
            self._db.execute('PRAGMA journal_mode=DELETE')
            self._db.execute('PRAGMA synchronous=EXTRA')
            identity = hmac.digest(auth_key, b'ii-tonya-gateway-nonce-registry-v1', hashlib.sha256).hex()
            self._identity = identity
            if _initializing:
                with self._db:
                    self._db.execute('CREATE TABLE nonces (value TEXT PRIMARY KEY)')
                    self._db.execute('CREATE TABLE metadata (identity TEXT NOT NULL)')
                    self._db.execute('INSERT INTO metadata VALUES (?)', (identity,))
            else:
                rows = self._db.execute('SELECT identity FROM metadata').fetchall()
                if len(rows) != 1 or not hmac.compare_digest(rows[0][0], identity):
                    raise ValueError('registry key mismatch')
                self._db.execute('SELECT value FROM nonces LIMIT 1').fetchall()
        except BaseException:
            self._db.close()
            raise

    def bound_to(self, auth_key):
        self._validate_key(auth_key)
        identity = hmac.digest(auth_key, b'ii-tonya-gateway-nonce-registry-v1', hashlib.sha256).hex()
        return hmac.compare_digest(self._identity, identity)

    def consume(self, nonce):
        if not isinstance(nonce, str) or not re.fullmatch(r'[0-9a-f]{64}', nonce):
            raise ValueError('invalid nonce')
        with self._lock, self._db:
            if self._db.execute('SELECT count(*) FROM nonces').fetchone()[0] >= 100000:
                raise RuntimeError('nonce registry full')
            cursor = self._db.execute('INSERT OR IGNORE INTO nonces(value) VALUES (?)', (nonce,))
            return cursor.rowcount == 1

    def close(self):
        with self._lock:
            self._db.close()
