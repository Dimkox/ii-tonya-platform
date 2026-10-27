#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

try:
    from _lib import emit, first, read_payload, root_from, run_hook
    from getzilla.state import get_active_change, get_active_route
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
    dump_json(runtime_dir(root) / 'handoff.json', {
        'created_at': now_utc(),
        'trigger': first(payload.get('trigger'), 'unknown'),
        'route': get_active_route(root),
        'change': get_active_change(root),
    })
    emit({'continue': True})


if __name__ == '__main__':
    run_hook(main, {})
