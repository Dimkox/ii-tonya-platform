from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))

from getzilla.ci_gate import apply_gate, plan_gate  # noqa: E402

parser = argparse.ArgumentParser(description='Plan or render the visibility-appropriate Getzilla CI gate.')
action = parser.add_mutually_exclusive_group(required=True)
action.add_argument('--plan', action='store_true')
action.add_argument('--write', action='store_true')
parser.add_argument('--target', type=Path, default=ROOT)
parser.add_argument('--visibility', choices=['public', 'private'])
parser.add_argument('--branch')
args = parser.parse_args()
method = apply_gate if args.write else plan_gate
result = method(args.target.resolve(), ROOT, visibility=args.visibility, branch=args.branch)
print(json.dumps(result, indent=2, ensure_ascii=True))
if result.get('result') in ('undetermined', 'refused') or result.get('gate') is None:
    raise SystemExit(1)
