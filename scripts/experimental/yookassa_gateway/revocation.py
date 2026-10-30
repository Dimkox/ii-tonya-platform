"""Experimental recovery queue, not a production privacy or gateway integration.

The mutation must durably deduplicate on its request key. SQLite and the DB
mutation are not atomic; retries must use the same key, including after crashes.
The queue must be on a trusted, durable private filesystem. Sending stays disabled.
"""
import sqlite3
import os
import stat
import threading


class RequestConflict(ValueError):
    pass


class PendingRevocations:
    def __init__(self, path):
        self._lock = threading.Lock()
        self.operation_lock = threading.RLock()
        directory = os.path.dirname(os.path.abspath(path))
        parent = os.stat(directory, follow_symlinks=False)
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
            raise ValueError('private owned directory required')
        fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('private regular database required')
        finally:
            os.close(fd)
        # SQLite reopens by pathname; this requires the directory to be trusted
        # against same-UID replacement. It is not adversarial filesystem fencing.
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute('PRAGMA journal_mode=DELETE')
        self._db.execute('PRAGMA synchronous=EXTRA')
        self._db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, subject BLOB NOT NULL, done INTEGER NOT NULL DEFAULT 0)')
        self._db.commit()

    def remember(self, key, subject):
        if not isinstance(key, str) or not key or len(key) > 128:
            raise ValueError('invalid request key')
        if not isinstance(subject, bytes) or len(subject) != 32:
            raise ValueError('invalid subject')
        with self._lock, self._db:
            self._db.execute('INSERT OR IGNORE INTO requests(id, subject) VALUES (?, ?)', (key, subject))
            row = self._db.execute('SELECT subject, done FROM requests WHERE id=?', (key,)).fetchone()
            if row[0] != subject:
                raise RequestConflict('request key already bound')
            return bool(row[1])

    def complete(self, key):
        with self._lock, self._db:
            self._db.execute('UPDATE requests SET done=1 WHERE id=?', (key,))

    def list_pending(self):
        with self._lock:
            return self._db.execute('SELECT id, subject FROM requests WHERE done=0 ORDER BY id').fetchall()

    def close(self):
        with self._lock:
            self._db.close()


class RevocationCoordinator:
    def __init__(self, state, pending, disable):
        self._state = state
        self._pending = pending
        self._disable = disable

    def revoke(self, key, subject, mutate):
        with self._pending.operation_lock:
            return self._revoke(key, subject, mutate)

    def _revoke(self, key, subject, mutate):
        try:
            if self._pending.remember(key, subject):
                return None
            self._state.delete(subject)
        except RequestConflict:
            raise
        except Exception as error:
            errors = [error]
            try:
                self._disable()
            except Exception as disable_error:
                errors.append(disable_error)
            try:
                mutate(key)
            except Exception as mutation_error:
                errors.append(mutation_error)
            if len(errors) > 1:
                raise ExceptionGroup('revocation durability uncertain', errors)
            raise RuntimeError('revocation durability uncertain') from error
        result = mutate(key)
        self._pending.complete(key)
        return result

    def recover(self, mutate):
        for key, subject in self._pending.list_pending():
            self.revoke(key, subject, lambda operation_key: mutate(operation_key, subject))
