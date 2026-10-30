import os
import tempfile
import threading
import subprocess
import sqlite3
import sys
import unittest

from durable_state import DurableState
from revocation import RevocationCoordinator, PendingRevocations


class RevocationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.state = DurableState(self.directory.name)
        self.pending = PendingRevocations(os.path.join(self.directory.name, 'pending.sqlite'))
        self.subject = os.urandom(32)
        self.disabled = []
        self.coordinator = RevocationCoordinator(self.state, self.pending, lambda: self.disabled.append(True))

    def tearDown(self):
        self.pending.close()
        self.state.close()
        self.directory.cleanup()

    def test_sqlite_uses_extra_durability_for_rollback_journal(self):
        self.assertEqual(self.pending._db.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
        self.assertEqual(self.pending._db.execute('PRAGMA synchronous').fetchone()[0], 3)

    def test_intent_and_tombstone_precede_mutation(self):
        def mutate(key):
            self.assertEqual(self.pending.list_pending(), [('request-1', self.subject)])
            with open(os.path.join(self.directory.name, 'gateway.log'), encoding='ascii') as log:
                self.assertIn('deleted', log.read())
            return key
        self.assertEqual(self.coordinator.revoke('request-1', self.subject, mutate), 'request-1')
        self.assertEqual(self.pending.list_pending(), [])

    def test_failed_mutation_is_replayed_with_same_idempotency_key(self):
        def fail(_):
            raise RuntimeError('database unavailable')
        with self.assertRaisesRegex(RuntimeError, 'database unavailable'):
            self.coordinator.revoke('request-1', self.subject, fail)
        self.pending.close()
        self.pending = PendingRevocations(os.path.join(self.directory.name, 'pending.sqlite'))
        coordinator = RevocationCoordinator(self.state, self.pending, lambda: self.disabled.append(True))
        seen = []
        coordinator.recover(lambda key, subject: seen.append((key, subject)))
        self.assertEqual(seen, [('request-1', self.subject)])
        self.assertEqual(self.pending.list_pending(), [])

    def test_crash_after_mutation_replays_without_double_effect(self):
        applied = set()
        effects = []
        def mutate(key):
            if key not in applied:
                applied.add(key)
                effects.append(key)
        complete = self.pending.complete
        self.pending.complete = lambda key: (_ for _ in ()).throw(OSError('synthetic crash'))
        with self.assertRaises(OSError):
            self.coordinator.revoke('request-1', self.subject, mutate)
        self.pending.complete = complete
        self.pending.close()
        self.pending = PendingRevocations(os.path.join(self.directory.name, 'pending.sqlite'))
        coordinator = RevocationCoordinator(self.state, self.pending, lambda: self.disabled.append(True))
        coordinator.recover(lambda key, subject: mutate(key))
        self.assertEqual(effects, ['request-1'])
        self.assertEqual(self.pending.list_pending(), [])

    def test_process_death_replays_against_durable_deduplication(self):
        root = self.directory.name
        self.pending.close()
        self.state.close()
        script = """
import os, sqlite3, sys
from durable_state import DurableState
from revocation import PendingRevocations, RevocationCoordinator
root, subject_hex = sys.argv[1:]
state = DurableState(root)
pending = PendingRevocations(os.path.join(root, 'pending.sqlite'))
def mutation(key):
    db = sqlite3.connect(os.path.join(root, 'mutation.sqlite'))
    db.execute('CREATE TABLE IF NOT EXISTS effects (id TEXT PRIMARY KEY)')
    db.execute('INSERT OR IGNORE INTO effects VALUES (?)', (key,))
    db.commit()
    db.close()
    os._exit(72)
RevocationCoordinator(state, pending, lambda: None).revoke('process-death', bytes.fromhex(subject_hex), mutation)
"""
        result = subprocess.run([sys.executable, '-c', script, root, self.subject.hex()],
                                env=dict(os.environ, PYTHONPATH=os.path.dirname(__file__)), timeout=5)
        self.assertEqual(result.returncode, 72)
        self.state = DurableState(root)
        self.pending = PendingRevocations(os.path.join(root, 'pending.sqlite'))
        self.assertEqual(self.pending.list_pending(), [('process-death', self.subject)])
        def recover(key, subject):
            with sqlite3.connect(os.path.join(root, 'mutation.sqlite')) as db:
                db.execute('INSERT OR IGNORE INTO effects VALUES (?)', (key,))
        RevocationCoordinator(self.state, self.pending, lambda: None).recover(recover)
        with sqlite3.connect(os.path.join(root, 'mutation.sqlite')) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM effects').fetchone()[0], 1)
        self.assertEqual(self.pending.list_pending(), [])

    def test_journal_failure_disables_and_still_attempts_privacy_mutation(self):
        class BrokenState:
            def delete(self, subject):
                raise OSError('storage failed')
        changed = []
        coordinator = RevocationCoordinator(BrokenState(), self.pending, lambda: self.disabled.append(True))
        with self.assertRaisesRegex(RuntimeError, 'revocation durability uncertain'):
            coordinator.revoke('request-1', self.subject, lambda key: changed.append(key))
        self.assertEqual(changed, ['request-1'])
        self.assertEqual(self.disabled, [True])
        self.assertEqual(self.pending.list_pending(), [('request-1', self.subject)])

    def test_invalid_subject_still_performs_privacy_mutation(self):
        changed = []
        with self.assertRaisesRegex(RuntimeError, 'revocation durability uncertain'):
            self.coordinator.revoke('request-1', b'invalid', lambda key: changed.append(key))
        self.assertEqual(changed, ['request-1'])
        self.assertEqual(self.disabled, [True])

    def test_conflicting_key_never_calls_mutation(self):
        self.pending.remember('request-1', self.subject)
        changed = []
        with self.assertRaises(ValueError):
            self.coordinator.revoke('request-1', os.urandom(32), lambda key: changed.append(key))
        self.assertEqual(changed, [])

    def test_concurrent_duplicate_mutation_runs_once(self):
        entered = threading.Event()
        release = threading.Event()
        calls = []
        def mutate(key):
            calls.append(key)
            entered.set()
            release.wait(1)
        first = threading.Thread(target=lambda: self.coordinator.revoke('request-1', self.subject, mutate))
        second = threading.Thread(target=lambda: self.coordinator.revoke('request-1', self.subject, mutate))
        first.start()
        self.assertTrue(entered.wait(1))
        second.start()
        release.set()
        first.join(1)
        second.join(1)
        self.assertEqual(calls, ['request-1'])

    def test_rejects_symlink_database(self):
        target = os.path.join(self.directory.name, 'victim')
        link = os.path.join(self.directory.name, 'other.sqlite')
        open(target, 'w').close()
        os.symlink(target, link)
        with self.assertRaises((ValueError, OSError)):
            PendingRevocations(link)

    def test_request_id_cannot_be_reused_for_different_subject(self):
        self.pending.remember('request-1', self.subject)
        with self.assertRaises(ValueError):
            self.pending.remember('request-1', os.urandom(32))

if __name__ == '__main__':
    unittest.main()
