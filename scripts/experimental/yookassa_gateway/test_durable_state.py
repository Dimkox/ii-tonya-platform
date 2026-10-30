import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from durable_state import DurableState


class DurableStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.subject = b"a" * 32

    def tearDown(self):
        self.tmp.cleanup()

    def test_delete_survives_restart(self):
        state = DurableState(self.tmp.name)
        state.delete(self.subject)
        state.close()
        state = DurableState(self.tmp.name)
        self.assertFalse(state.begin_attempt(self.subject, lambda: None))
        state.close()

    def test_global_stop_is_durable_and_rejects_later_attempts(self):
        state = DurableState(self.tmp.name, synthetic_fresh_start=True)
        state.stop_all()
        self.assertFalse(state.begin_attempt(self.subject, lambda: self.fail("sent")))
        state.close()
        state = DurableState(self.tmp.name)
        self.assertFalse(state.begin_attempt(self.subject, lambda: self.fail("sent")))
        with open(os.path.join(self.tmp.name, "gateway.log"), encoding="ascii") as log:
            self.assertIn('"stopped":true', log.read())
        state.close()

    def test_second_instance_is_fenced(self):
        state = DurableState(self.tmp.name)
        with self.assertRaises(BlockingIOError):
            DurableState(self.tmp.name)
        state.close()

    def test_lock_file_replacement_cannot_admit_second_instance(self):
        state = DurableState(self.tmp.name, synthetic_fresh_start=True)
        os.unlink(Path(self.tmp.name, "gateway.lock"))
        Path(self.tmp.name, "gateway.lock").touch()
        try:
            with self.assertRaises(BlockingIOError):
                DurableState(self.tmp.name, synthetic_fresh_start=True)
        finally:
            state.close()

    def test_attempt_blocks_restart_and_other_subjects(self):
        state = DurableState(self.tmp.name, synthetic_fresh_start=True)
        self.assertTrue(state.begin_attempt(self.subject, lambda: None))
        state.close()
        state = DurableState(self.tmp.name)
        self.assertFalse(state.begin_attempt(b"b" * 32, lambda: None))
        state.close()

    def test_process_death_preserves_attempt(self):
        script = 'from durable_state import DurableState; import os,sys; s=DurableState(sys.argv[1], synthetic_fresh_start=True); assert s.begin_attempt(b"a"*32, lambda: None); os._exit(0)'
        subprocess.run([sys.executable, "-c", script, self.tmp.name], cwd=Path(__file__).parent, check=True, timeout=5)
        state = DurableState(self.tmp.name)
        self.assertFalse(state.begin_attempt(self.subject, lambda: None))
        state.close()

    def test_lock_replacement_disables_attempt(self):
        state = DurableState(self.tmp.name, synthetic_fresh_start=True)
        os.unlink(Path(self.tmp.name, "gateway.lock"))
        Path(self.tmp.name, "gateway.lock").touch()
        with self.assertRaises(RuntimeError):
            state.begin_attempt(self.subject, lambda: None)
        state.close()

    def test_disk_failure_restart_is_disarmed(self):
        state = DurableState(self.tmp.name, synthetic_fresh_start=True)
        state._append = lambda entry: (_ for _ in ()).throw(OSError("disk failure"))
        with self.assertRaises(OSError):
            state.delete(self.subject)
        state.close()
        state = DurableState(self.tmp.name)
        self.assertFalse(state.begin_attempt(self.subject, lambda: self.fail("write")))
        state.close()

    def test_valid_log_truncation_restart_is_disarmed(self):
        state = DurableState(self.tmp.name, synthetic_fresh_start=True)
        state.delete(self.subject)
        state.close()
        Path(self.tmp.name, "gateway.log").write_bytes(b"")
        state = DurableState(self.tmp.name)
        self.assertFalse(state.begin_attempt(self.subject, lambda: self.fail("write")))
        state.close()

    def test_delete_cannot_overtake_first_write(self):
        import threading

        state = DurableState(self.tmp.name, synthetic_fresh_start=True)
        entered = threading.Event()
        resume = threading.Event()
        deleted = threading.Event()
        worker = threading.Thread(
            target=lambda: state.begin_attempt(self.subject, lambda: (entered.set(), resume.wait(3)))
        )
        worker.start()
        self.assertTrue(entered.wait(3))
        eraser = threading.Thread(target=lambda: (state.delete(self.subject), deleted.set()))
        eraser.start()
        self.assertFalse(deleted.wait(0.05))
        resume.set()
        worker.join(3)
        eraser.join(3)
        self.assertTrue(deleted.is_set())
        state.close()

    def test_corrupt_journal_fails_closed(self):
        Path(self.tmp.name, "gateway.log").write_bytes(b"{broken")
        os.chmod(Path(self.tmp.name, "gateway.log"), 0o600)
        with self.assertRaises(ValueError):
            DurableState(self.tmp.name)


if __name__ == "__main__":
    unittest.main()
