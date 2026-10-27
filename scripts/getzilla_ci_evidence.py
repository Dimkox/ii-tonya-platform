from __future__ import annotations
import argparse
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))
from getzilla.ci_evidence import export_evidence
from getzilla.util import find_root

parser = argparse.ArgumentParser(description='Export allowlisted evidence from this CI run.')
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--job', required=True)
parser.add_argument('--status', required=True)
args = parser.parse_args()
export_evidence(find_root(), args.output, logs=Path(os.environ['RUNNER_TEMP']), job=args.job,
                status=args.status, run_id=os.environ['GITHUB_RUN_ID'])
