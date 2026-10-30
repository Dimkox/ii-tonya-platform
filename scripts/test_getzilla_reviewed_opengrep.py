import hashlib
import json
import tempfile
import types
import unittest
from dataclasses import dataclass, field
from pathlib import Path

from getzilla_reviewed_opengrep import classify, ReviewError, install_reviewed_opengrep

RULE = "getzilla.sast.rules.getzilla.javascript.sql-injection"


@dataclass
class Result:
    name: str = "opengrep"
    status: str = "fail"
    summary: str = "1 taint findings from Getzilla OpenGrep rules"
    command: list = field(default_factory=lambda: ["opengrep"])
    stdout: str = "raw-output"
    stderr: str = ""
    details: list = field(
        default_factory=lambda: [
            {"rule": RULE, "path": "app.ts", "line": "1", "severity": "ERROR", "message": "raw finding"}
        ]
    )


def run(*args, **kwargs):
    raise RuntimeError("test transport not installed")


def fake_engine(root):
    run(["opengrep", "scan"], cwd=root)
    return Result(stdout="")


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / ".getzilla").mkdir()
        self.source = self.root / "app.ts"
        self.source.write_text("const x = 1;\n")
        self.config = self.root / "review.json"
        self.entry = {
            "rule": RULE,
            "path": "app.ts",
            "line": "1",
            "sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "category": "parameterized-sql",
            "evidence": "docs/operations/review.md",
        }
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        self.config.write_text(json.dumps({"version": 1, "entries": [self.entry]}))

    def test_exact_match_preserves_raw_status_message_and_output(self):
        original = Result()
        result = classify(original, self.root, self.config)
        self.assertEqual(result.status, "pass")
        self.assertEqual(result.stdout, "raw-output")
        self.assertEqual(result.details[0]["severity"], "ERROR")
        self.assertEqual(result.details[0]["message"], "raw finding")
        self.assertEqual(result.details[0]["effective_severity"], "INFO")
        self.assertNotIn("effective_severity", original.details[0])

    def test_real_getzilla_consumer_accepts_classification_and_refuses_raw(self):
        import sys

        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".getzilla"))
        from getzilla.verification import CheckResult, required_check_refused

        example = Result()
        raw = CheckResult(
            name=example.name,
            status=example.status,
            summary=example.summary,
            command=example.command,
            stdout=example.stdout,
            stderr=example.stderr,
            details=example.details,
        )
        classified = classify(raw, self.root, self.config)
        self.assertTrue(required_check_refused(raw, mode="pr"))
        self.assertFalse(required_check_refused(classified, mode="pr"))
        self.assertEqual(raw.status, "fail")
        self.assertIn("raw scanner status=fail", classified.summary)

    def test_genuine_clean_result_does_not_require_stale_source(self):
        self.source.write_text("the issue was fixed")
        raw = Result(status="pass", summary="no taint findings from Getzilla OpenGrep rules", details=[])
        result = classify(raw, self.root, self.config)
        self.assertEqual(result.status, "pass")
        self.assertEqual(result.summary, raw.summary)
        self.assertEqual(result.details, [])
        self.config.unlink()
        with self.assertRaises(ReviewError):
            classify(raw, self.root, self.config)

    def test_unknown_line_rule_source_and_missing_config_reject(self):
        for changed in ({"line": "2"}, {"rule": "unknown"}, {"path": "other.ts"}):
            result = Result()
            result.details[0].update(changed)
            with self.assertRaises(ReviewError):
                classify(result, self.root, self.config)
        self.source.write_text("changed")
        with self.assertRaises(ReviewError):
            classify(Result(), self.root, self.config)
        self.config.unlink()
        with self.assertRaises(ReviewError):
            classify(Result(), self.root, self.config)

    def test_duplicate_traversal_and_symlink_reject(self):
        self.config.write_text(json.dumps({"version": 1, "entries": [self.entry, self.entry]}))
        with self.assertRaises(ReviewError):
            classify(Result(), self.root, self.config)
        self.entry["path"] = "../escape"
        self.save()
        with self.assertRaises(ReviewError):
            classify(Result(), self.root, self.config)
        self.source.unlink()
        self.source.symlink_to("/etc/passwd")
        self.entry["path"] = "app.ts"
        self.save()
        with self.assertRaises(ReviewError):
            classify(Result(), self.root, self.config)

    def test_wrapper_preserves_raw_json_and_rejects_tool_errors(self):
        finding = {
            "check_id": RULE,
            "path": "app.ts",
            "start": {"line": 1},
            "extra": {"severity": "ERROR", "message": "raw finding"},
        }
        report = {"results": [finding], "errors": []}
        fake_engine.__globals__["run"] = lambda *a, **k: types.SimpleNamespace(
            returncode=0, stdout=json.dumps(report), stderr=""
        )
        engine = types.SimpleNamespace(_opengrep=fake_engine)
        install_reviewed_opengrep(engine, "2.3.1", self.config)
        transport = fake_engine.__globals__["run"]
        result = engine._opengrep(self.root)
        self.assertIs(fake_engine.__globals__["run"], transport)
        evidence = list((self.root / ".getzilla/runtime").glob("opengrep-review-*.json"))
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0].stat().st_mode & 0o777, 0o600)
        saved = json.loads(evidence[0].read_text())
        self.assertEqual(json.loads(saved["raw_stdout"]), report)
        self.assertEqual(saved["engine_result"]["status"], "fail")
        self.assertEqual(json.loads(result.stdout), report)
        self.assertEqual(result.status, "pass")
        report["errors"].append({"level": "error"})
        with self.assertRaises(ReviewError):
            engine._opengrep(self.root)
        fake_engine.__globals__["run"] = lambda *a, **k: types.SimpleNamespace(
            returncode=124, stdout="", stderr="timeout"
        )
        with self.assertRaises(ReviewError):
            engine._opengrep(self.root)
        with self.assertRaises(ReviewError):
            install_reviewed_opengrep(engine, "wrong-version", self.config)

    def test_tool_failure_and_truncated_result_reject(self):
        for result in (
            Result(summary="opengrep exited 2"),
            Result(status="skip"),
            Result(summary="2 taint findings from Getzilla OpenGrep rules"),
        ):
            with self.assertRaises(ReviewError):
                classify(result, self.root, self.config)
