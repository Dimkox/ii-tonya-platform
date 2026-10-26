# CI gate by repository visibility

The CI/merge gate follows the repository's GitHub visibility (owner decision 2026-10-06):

| Visibility | Gate | What Getzilla writes |
| --- | --- | --- |
| public | GitHub Actions | `.github/workflows/getzilla-verify.yml` from `github-actions-verify.yml` |
| private | Trust CI (`adaptive-trust-ci` GitHub App, code in `trust-ci/`) | nothing; onboarding steps are printed |

```bash
python3 scripts/getzilla_ci.py --plan --target /path/to/repo
python3 scripts/getzilla_ci.py --write --target /path/to/repo
python3 scripts/getzilla_ci.py --write --target /path/to/repo --visibility private
```

Visibility comes from `gh api repos/<owner>/<repo>`, otherwise from the unauthenticated GitHub API. When neither can confirm it, nothing is written and `--visibility public|private` is required.

`--write` creates the workflow exclusively and never overwrites a different file. The template pins every action to a full commit SHA, grants only `contents: read`, checks out without persisted credentials and runs `python scripts/getzilla_verify.py --mode pr`. Make the `getzilla-verify` check required in branch protection yourself; Getzilla does not change repository settings.

Local `make verify` / `python3 scripts/getzilla_verify.py --mode pr` stays the pre-push gate in both cases. Do not add Dependabot or another CI vendor, and never dispatch workflows from an agent.
