#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

try:
    from _lib import agent_generation, agent_id, emit, read_payload, root_from, run_hook, session_id, tool_input, tool_name
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
    _remember_reads(payload, root)
    emit({
        'hookSpecificOutput': {
            'hookEventName': 'PostToolUse',
            'additionalContext': _path_hint(payload, root),
        }
    })


def _remember_reads(payload: dict, root) -> None:
    """Record the files this call read or wrote, for the read-before-edit guard (getzilla.read_ledger)."""
    try:
        from getzilla.path_hints import command_cwd
        from getzilla.read_ledger import observe, record
        data = tool_input(payload)
        tool = tool_name(payload)
        cwd = command_cwd(root, payload, data)
        if tool in {'Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'}:
            raw = data.get('file_path') or data.get('notebook_path') or data.get('path')
            if isinstance(raw, str):
                from getzilla.read_ledger import _relative
                rel = _relative(root, raw, cwd)
                if rel:
                    record(root, session_id(payload), {rel})
            return
        response = payload.get('tool_response')
        if isinstance(response, dict):
            response = '\n'.join(str(response.get(key) or '') for key in ('output', 'stdout', 'aggregated_output'))
        observe(root, session_id(payload), tool, data.get('command'), cwd, response if isinstance(response, str) else '')
    except Exception:
        return


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
