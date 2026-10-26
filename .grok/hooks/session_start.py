#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

try:
    from _lib import emit, read_payload, root_from, run_hook
    from getzilla.router import route_context
    from getzilla.state import get_active_change, get_active_route
except Exception:
    if os.name != 'nt':
        raise
    # Windows commandWindows has no `|| python3 -c "print('{}')"` fallback chain.
    import traceback
    traceback.print_exc()
    sys.stdout.write('{}\n')
    raise SystemExit(0)


def _tool_update_note() -> str | None:
    try:
        import time

        from getzilla.updater import home_dir, reminder
        return reminder(home_dir(), time.time())
    except Exception:
        return None


def _capacity_note(root) -> str | None:
    try:
        from getzilla.parallel import session_note
        return session_note(root)
    except Exception:
        return None


def main() -> None:
    payload = read_payload()
    root = root_from(payload)
    route = get_active_route(root)
    from getzilla.route_metrics import record
    record(root, 'session_start', (route or {}).get('route_id'))
    change = get_active_change(root)
    if route:
        extra = f' Active route {route.get("route_id")}. Change: {(change or {}).get("change_id", "none")}.'
        context = route_context(route) + extra
    else:
        context = 'No active route. Submit a development task to classify work.'
    note = _tool_update_note()
    if note:
        context = f'{context} {note}'
    capacity = _capacity_note(root)
    if capacity:
        context = f'{context} {capacity}'
    emit({
        'hookSpecificOutput': {
            'hookEventName': 'SessionStart',
            'additionalContext': context,
        }
    })


if __name__ == '__main__':
    run_hook(main, {})
