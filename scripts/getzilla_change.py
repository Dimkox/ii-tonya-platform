from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))

import argparse
import json

from getzilla.change import TRANSITIONS, start_change, transition
from getzilla.state import get_active_change
from getzilla.util import find_root
from getzilla.workflow_storage import change_directory

parser = argparse.ArgumentParser(description='Manage durable engineering change packages.')
sub = parser.add_subparsers(dest='command', required=True)
start = sub.add_parser('start')
start.add_argument('--title')
move = sub.add_parser('transition')
move.add_argument('change_id')
move.add_argument('target')
move.add_argument('--reason', required=True)
sub.add_parser('show')
args = parser.parse_args()
root = find_root()
if args.command == 'start':
    result = start_change(root, args.title)
elif args.command == 'transition':
    try:
        result = transition(root, args.change_id, args.target, args.reason)
    except (ValueError, FileNotFoundError) as exc:
        # A refused transition is a usage answer, not a crash (#186): name the allowed next states.
        try:
            state = json.loads((change_directory(root, args.change_id) / 'state.json').read_text(encoding='utf-8'))['status']
        except (OSError, ValueError, KeyError, TypeError):
            state = None
        moves = TRANSITIONS.get(state, set()) if state else set()
        # Name the allowed states only for an invalid move, not when a gate refused an allowed one.
        hint = f'; allowed from {state}: {", ".join(sorted(moves)) or "none"}' if state and args.target not in moves else ''
        print(f'getzilla change: {exc}{hint}', file=sys.stderr)
        raise SystemExit(2)
else:
    result = get_active_change(root)
print(json.dumps(result, ensure_ascii=False, indent=2))
