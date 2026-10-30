"""Synthetic single-host state experiment, not a production authority.

The caller must ensure exclusive control of the state directory, all deletion
paths and network egress. This module does not provide distributed fencing.
An attempt permanently poisons this store; there is deliberately no rearm API.
"""
import fcntl
import hashlib
import json
import os
import threading
import stat

class DurableState:
    def __init__(self, directory, *, synthetic_fresh_start=False, require_existing=False):
        self._mutex = threading.Lock()
        self._deleted = set()
        self._attempts = set()
        self._uncertain = False
        self._stopped = False
        self._runtime_fault = False
        self._require_existing = require_existing
        self._closed = True
        self._dir = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            # Fence the directory inode before opening replaceable child files.
            # This is cooperative, single-host fencing only.
            fcntl.flock(self._dir, fcntl.LOCK_EX | fcntl.LOCK_NB)
            directory_info = os.fstat(self._dir)
            if directory_info.st_uid != os.getuid() or directory_info.st_mode & 0o077: raise PermissionError('private state directory required')
            create = 0 if require_existing else os.O_CREAT
            self._lock = os.open('gateway.lock', create | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=self._dir)
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._log = os.open('gateway.log', create | os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW, 0o600, dir_fd=self._dir)
            for fd in (self._lock, self._log):
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077: raise PermissionError('private state files required')
            os.fsync(self._dir)
            with os.fdopen(os.dup(self._log), 'rb') as stream:
                for line in stream:
                    entry = json.loads(line)
                    if set(entry) == {'deleted'} and isinstance(entry['deleted'], str) and len(entry['deleted']) == 64:
                        self._deleted.add(entry['deleted'])
                    elif set(entry) == {'attempt_id'} and isinstance(entry['attempt_id'], str) and len(entry['attempt_id']) == 64:
                        self._attempts.add(entry['attempt_id'])
                    elif entry == {'stopped': True}:
                        self._uncertain = True
                        self._stopped = True
                    elif entry == {'attempt': True}:
                        self._uncertain = True
                    else:
                        raise ValueError('invalid journal')
            self._closed = False
            # A journal cannot detect valid-record truncation without an
            # external trusted anchor. Restart is therefore always disarmed.
            self._enabled = synthetic_fresh_start and os.fstat(self._log).st_size == 0
        except BaseException:
            if hasattr(self, '_log'): os.close(self._log)
            if hasattr(self, '_lock'): os.close(self._lock)
            os.close(self._dir)
            raise

    @staticmethod
    def _key(subject):
        if not isinstance(subject, bytes) or len(subject) != 32:
            raise ValueError('subject must be a 32-byte opaque token')
        return hashlib.sha256(subject).hexdigest()

    def _append(self, entry):
        data = (json.dumps(entry, separators=(',', ':')) + '\n').encode('ascii')
        while data:
            count = os.write(self._log, data)
            if count <= 0: raise OSError('journal write failed')
            data = data[count:]
        os.fsync(self._log)

    def _check_lock_inode(self):
        held = os.fstat(self._lock)
        path = os.stat("gateway.lock", dir_fd=self._dir, follow_symlinks=False)
        if held.st_nlink != 1 or (held.st_dev, held.st_ino) != (path.st_dev, path.st_ino):
            self._enabled = False
            self._runtime_fault = True
            raise RuntimeError("lock file replaced")

    def delete(self, subject, before_persist=None):
        key = self._key(subject)
        with self._mutex:
            if self._closed: raise RuntimeError('closed')
            self._check_lock_inode()
            self._deleted.add(key)
            try:
                if before_persist is not None and before_persist() is not True:
                    raise RuntimeError('authority revocation unavailable')
                self._append({'deleted': key})
            except BaseException:
                self._uncertain = True
                self._enabled = False
                self._runtime_fault = True
                raise

    def resume_from_authority(self, authority):
        from pg_authority import PgAuthority
        with self._mutex:
            if self._closed or not self._require_existing or self._stopped or self._runtime_fault or not isinstance(authority, PgAuthority):
                return False
            self._check_lock_inode()
            try:
                if authority.check_readiness() is not True:
                    return False
            except Exception:
                return False
            # PostgreSQL is authoritative for previously claimed attempts and
            # revoked contacts; every future send must still call PG claim.
            self._uncertain = False
            self._enabled = True
            return True

    def barrier(self, authority):
        from pg_authority import PgAuthority
        with self._mutex:
            if self._closed or not self._enabled or self._uncertain or self._stopped or self._runtime_fault or not isinstance(authority, PgAuthority):
                return False
            try:
                self._check_lock_inode()
                return authority.check_readiness() is True
            except Exception:
                return False

    def stop_all(self):
        with self._mutex:
            if self._closed: raise RuntimeError('closed')
            self._enabled = False
            self._uncertain = True
            self._stopped = True
            self._check_lock_inode()
            self._append({'stopped': True})

    def begin_named_attempt(self, subject, attempt, first_write):
        key = self._key(subject)
        attempt_key = self._key(attempt)
        with self._mutex:
            if self._closed or not self._enabled or self._uncertain or key in self._deleted or attempt_key in self._attempts:
                return False
            self._check_lock_inode()
            # Reserve before network; an ambiguous result can never resend.
            self._attempts.add(attempt_key)
            try:
                self._append({'attempt_id': attempt_key})
            except BaseException:
                self._uncertain = True
                self._enabled = False
                self._runtime_fault = True
                raise
            first_write()
            return True

    def begin_attempt(self, subject, first_write):
        key = self._key(subject)
        with self._mutex:
            if self._closed or not self._enabled or self._uncertain or key in self._deleted:
                return False
            self._check_lock_inode()
            # Persist before any possible network action. Crash or ambiguous
            # completion cannot automatically authorize a second attempt.
            self._uncertain = True
            self._append({'attempt': True})
            # Only a synchronous first-write callback is allowed. This lock
            # does not fence any other process or deletion outside this class.
            first_write()
            return True

    def close(self):
        with self._mutex:
            if self._closed: return
            self._closed = True
            os.close(self._log)
            os.close(self._lock)
            os.close(self._dir)
