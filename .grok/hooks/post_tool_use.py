#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

try:
    from _lib import agent_generation, agent_id, emit, read_payload, root_from, run_hook, tool_input, tool_name
    from getzilla.agent_lifecycle import observe_tool
    from getzilla.receipts import invalidate_receipts
    from getzilla.state import get_active_route
    from getzilla.util import dump_json, load_json, runtime_dir, tree_fingerprint
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
    try:
        observe_tool(root, agent_id(payload), agent_generation(payload), finished=True)
    except (OSError, TimeoutError):
        pass
    marker = runtime_dir(root) / 'last-fingerprint.json'
    current = tree_fingerprint(root)
    previous = load_json(marker, {}) or {}
    last = previous.get('tree_fingerprint') if isinstance(previous, dict) else None
    route = get_active_route(root)
    if last and last != current and route:
        invalidate_receipts(root, route['route_id'], 'repository tree changed after tool use')
    dump_json(marker, {'tree_fingerprint': current})
    emit({
        'hookSpecificOutput': {
            'hookEventName': 'PostToolUse',
            'additionalContext': _path_hint(payload, root),
        }
    })


def _path_hint(payload: dict, root) -> str:
    """Closest real paths for any missing path a read command named (getzilla.path_hints)."""
    try:
        data = tool_input(payload)
        command = data.get('command')
        if tool_name(payload) != 'Bash' or not isinstance(command, str):
            return ''
        from getzilla.path_hints import command_cwd, hint
        return hint(root, command, command_cwd(root, payload, data)) or ''
    except Exception:
        return ''


if __name__ == '__main__':
    run_hook(main, {})
