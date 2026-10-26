# Getzilla OpenGrep rules

Taint rules for [OpenGrep](https://github.com/opengrep/opengrep) (LGPL-2.1), the open fork of the Semgrep engine. `getzilla_verify` runs them as the `opengrep` check wherever an `opengrep` binary is installed. Both gates install the same pinned, checksum-verified release: the free GitHub Actions workflow rendered by `scripts/getzilla_ci.py --write` for public repositories, and the Trust CI runner image for private ones.

Every rule here is written for Getzilla and distributed under the repository's MIT license. Nothing is copied from `semgrep-rules` or `opengrep-rules`: those carry the Semgrep Rules License or a Commons Clause that forbids selling a service built on them.

| File | Rules |
| --- | --- |
| `rules/python.yaml` | SQL, command and code injection, path traversal, SSRF, unsafe deserialization |
| `rules/javascript.yaml` | command and code injection, SQL injection, path traversal, SSRF, reflected XSS, open redirect (JS and TS) |
| `rules/php.yaml` | SQL and command injection, file inclusion, reflected XSS, code injection (including Bitrix request objects and escaping helpers) |
| `rules/go.yaml` | SQL and command injection, SSRF |

The checks run with `--taint-intrafile`, so data is followed across functions inside a file. Each rule file has a sibling example (`python.py.example`, `javascript.js.example`, …) whose `ruleid:` and `ok:` comments are the rule's tests; the `.example` suffix keeps them out of scans and the architecture inventory. `tests/test_opengrep.py` restores the real extensions in a temporary directory and runs `opengrep scan --test --taint-intrafile` on it:

```bash
python3 -m unittest tests.test_opengrep
```

A finding that is a reviewed false positive is silenced on its line with `# nosemgrep: <rule-id>` (or `// nosemgrep: <rule-id>`), which OpenGrep honours.
