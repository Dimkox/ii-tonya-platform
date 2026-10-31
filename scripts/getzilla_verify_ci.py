"""Run the installed Getzilla PR gate with a bounded hosted-suite timeout."""
from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if os.environ.get('II_TONYA_CI_DB_REPORT') != 'true':
    raise SystemExit('hosted CI report mode is required')
sys.path.insert(0, str(ROOT / '.getzilla'))
sys.path.insert(0, str(ROOT / 'scripts'))
import getzilla  # noqa: E402
from getzilla import verification  # noqa: E402
from getzilla_ci_timeout import install_ci_test_timeout  # noqa: E402
from getzilla_reviewed_opengrep import install_reviewed_opengrep  # noqa: E402

if getzilla.__version__ != '2.3.1':
    raise SystemExit('unsupported Getzilla version; review timeout adapter')
install_ci_test_timeout(verification)
install_reviewed_opengrep(
    verification,
    getzilla.__version__,
    ROOT / 'engineering/opengrep-reviewed-observations.json',
)
# The hosted runner has no project venv; use its pinned setup-python interpreter.
os.environ['GETZILLA_NO_VENV'] = '1'
script = ROOT / 'scripts/getzilla_verify.py'
sys.argv = [str(script), '--mode', 'pr']
runpy.run_path(str(script), run_name='__main__')
