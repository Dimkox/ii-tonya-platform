from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".grok-stack"))

from adaptive_grok import verification


class SecretScanAdaptationTests(unittest.TestCase):
    def test_ignores_placeholders_and_camel_case_identifier_suffixes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.ts"
            fixture.write_text(
                "\n".join(
                    [
                        'const leaseToken = "0123456789abcdef";',
                        'api_key = "test-api-key-placeholder"',
                        'secret = "placeholder-secret-value"',
                        'password = "example-password-value"',
                        'token = "dummy-token-value"',
                        'api_key = "fake-api-key-value"',
                        'secret = "change-me-before-use"',
                        'password = "replace-me-before-use"',
                    ]
                ),
                encoding="utf-8",
            )

            result = verification._secret_scan(root, [fixture.name])

        self.assertEqual(result.status, "pass")
        self.assertEqual(result.details, [])

    def test_rejects_realistic_api_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.py"
            fixture.write_text(
                "api" + '_key = "' + "sk_live_51QwErTyUiOpAsDfGhJk" + '"\n',
                encoding="utf-8",
            )

            result = verification._secret_scan(root, [fixture.name])

        self.assertEqual(result.status, "fail")
        self.assertEqual([finding["code"] for finding in result.details], ["generic-secret"])

    def test_rejects_realistic_prefixed_uppercase_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.env"
            fixture.write_text(
                "TELEGRAM_WEBHOOK_"
                + 'SECRET = "'
                + "whsec_51QwErTyUiOpAsDfGhJk"
                + '"\n',
                encoding="utf-8",
            )

            result = verification._secret_scan(root, [fixture.name])

        self.assertEqual(result.status, "fail")
        self.assertEqual([finding["code"] for finding in result.details], ["generic-secret"])


class QualityProfileAdaptationTests(unittest.TestCase):
    def _verify_with_profiles(self, root: Path, profiles: list[str]) -> None:
        with (
            patch.object(verification, "get_active_route", return_value={}),
            patch.object(verification, "changed_files", return_value=[]),
            patch.object(verification, "tree_fingerprint", return_value="test-fingerprint"),
        ):
            verification.verify(root, profiles=profiles, record=False)

    def test_frontend_profile_does_not_invoke_trivy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
            with patch.object(verification, "_trivy_config") as trivy:
                self._verify_with_profiles(root, ["base", "frontend"])

        trivy.assert_not_called()

    def test_infra_profile_preserves_trivy_check(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
            with patch.object(verification, "_trivy_config", return_value=None) as trivy:
                self._verify_with_profiles(root, ["base", "infra"])

        trivy.assert_called_once_with(root)


class EmbeddedWorkflowCoverageAdaptationTests(unittest.TestCase):
    @staticmethod
    def _passing_command_result(
        root: Path,
        name: str,
        command: list[str],
        timeout: int = 300,
    ) -> verification.CheckResult:
        del root, timeout
        return verification.CheckResult(name, "pass", "test", command=command)

    def test_pr_mode_without_python_project_runs_unittest_without_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tests = root / "tests"
            tests.mkdir()
            (tests / "test_embedded.py").write_text("pass\n", encoding="utf-8")
            with (
                patch.object(
                    verification,
                    "_ruff",
                    return_value=verification.CheckResult("ruff", "skip", "test"),
                ),
                patch.object(
                    verification,
                    "_bandit",
                    return_value=verification.CheckResult("bandit", "skip", "test"),
                ),
                patch.object(verification, "command_exists", return_value=True),
                patch.object(
                    verification,
                    "_command_check",
                    side_effect=self._passing_command_result,
                ),
            ):
                results = verification._python(root, mode="pr")

        commands = [result.command for result in results if result.command]
        self.assertIn(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests"],
            commands,
        )
        self.assertFalse(any(command[0] == "coverage" for command in commands))
        self.assertNotIn("coverage", [result.name for result in results])

    def test_pr_mode_with_python_project_preserves_unittest_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pyproject.toml").write_text("[project]\nname='fixture'\n", encoding="utf-8")
            tests = root / "tests"
            tests.mkdir()
            (tests / "test_project.py").write_text("pass\n", encoding="utf-8")

            def command_exists(name: str) -> bool:
                return name == "coverage"

            with (
                patch.object(
                    verification,
                    "_ruff",
                    return_value=verification.CheckResult("ruff", "skip", "test"),
                ),
                patch.object(
                    verification,
                    "_bandit",
                    return_value=verification.CheckResult("bandit", "skip", "test"),
                ),
                patch.object(verification, "command_exists", side_effect=command_exists),
                patch.object(
                    verification,
                    "_command_check",
                    side_effect=self._passing_command_result,
                ),
            ):
                results = verification._python(root, mode="pr")

        commands = [result.command for result in results if result.command]
        self.assertIn(
            [
                "coverage",
                "run",
                "--rcfile=.coveragerc",
                "-m",
                "unittest",
                "discover",
                "-s",
                "tests",
            ],
            commands,
        )
        self.assertIn(
            ["coverage", "report", "--rcfile=.coveragerc"],
            commands,
        )


if __name__ == "__main__":
    unittest.main()
