from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))

from getzilla.startup_cpu import measure  # noqa: E402

parser = argparse.ArgumentParser(description='Record Getzilla startup CPU capacity.')
parser.add_argument('--no-probe', action='store_true')
parser.add_argument('--reserve', type=int, default=0)
args = parser.parse_args()
if args.reserve < 0:
    parser.error('--reserve must not be negative')
print(json.dumps(measure(reserve=args.reserve, probe=not args.no_probe), indent=2, ensure_ascii=True))
