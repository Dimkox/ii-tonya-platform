from __future__ import annotations
import argparse
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))
from getzilla.ci_evidence import export_local_evidence
from getzilla.util import find_root
parser = argparse.ArgumentParser(description='Export bounded local workflow evidence without approvals or secrets.')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
try:
    export_local_evidence(find_root(), args.output)
except (OSError, ValueError, RuntimeError) as exc:
    parser.error(str(exc))
print(args.output)
