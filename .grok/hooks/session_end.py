#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

try:
    from _lib import emit, read_payload, root_from, run_hook
    from getzilla.util import dump_json, now_utc, runtime_dir
except Exception:
    if os.name != 'nt':
        raise
    # Windows commandWindows has no `|| python3 -c "print('{}')"` fallback chain.
    import traceback
    traceback.print_exc()
    sys.stdout.write('{}\n')
    raise SystemExit(0)


def main() -> None:
    payload = read_payload()
    root = root_from(payload)
    from getzilla.state import get_active_route
    from getzilla.route_metrics import record
    route = get_active_route(root) or {}
    record(root, 'session_end', route.get('route_id'))
    dump_json(runtime_dir(root) / 'last-session-end.json', {
        'ended_at': now_utc(),
        'reason': payload.get('reason'),
    })
    emit({})


if __name__ == '__main__':
    run_hook(main, {})
