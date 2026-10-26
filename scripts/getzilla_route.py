from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))

import argparse
import json

from getzilla.router import build_route, route_context
from getzilla.state import ActiveChangeConflict, get_active_route, set_active_route, update_route
from getzilla.util import find_root

parser = argparse.ArgumentParser(description='Create or inspect an adaptive task route.')
parser.add_argument('task', nargs='?', help='Development task text')
parser.add_argument('--session', default='manual')
parser.add_argument('--show', action='store_true')
parser.add_argument('--reconcile', action='store_true', help='Derive the review plan from the exact committed diff; no tests or receipts')
parser.add_argument('--add-reviewer', action='append', default=[], help='With --reconcile, retain this explicitly selected reviewer in future plans')
parser.add_argument('--complete', action='store_true')
parser.add_argument('--cancel', action='store_true')
parser.add_argument('--json', action='store_true')
args = parser.parse_args()
root = find_root()
if args.reconcile:
    from getzilla.review_plan import reconcile_route
    try:
        data = reconcile_route(root, additional_reviewers=tuple(args.add_reviewer))
    except (ValueError, RuntimeError) as exc:
        parser.error(str(exc))
elif args.add_reviewer:
    parser.error('--add-reviewer requires --reconcile')
elif args.complete:
    data = update_route(root, status='completed')
elif args.cancel:
    data = update_route(root, status='cancelled')
elif args.task:
    route = build_route(root, args.task, args.session)
    data = route.to_dict()
    try:
        set_active_route(root, data)
    except ActiveChangeConflict as conflict:
        raise SystemExit(f'Route not changed: {conflict}')
else:
    data = get_active_route(root)
if not data:
    raise SystemExit('No active route and no task supplied.')
print(json.dumps(data, ensure_ascii=False, indent=2) if args.json else route_context(data))
