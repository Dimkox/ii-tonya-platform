#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

try:
    from _lib import emit, is_child_payload, prompt_text, read_payload, root_from, run_hook, session_id
    from getzilla.router import build_route, can_reuse_active_route, is_system_notice, route_context
    from getzilla.state import ActiveChangeConflict, get_active_route, set_active_route
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
    prompt = prompt_text(payload)
    existing = get_active_route(root)
    if existing and (is_child_payload(payload) or can_reuse_active_route(prompt, existing, session_id(payload))):
        context = route_context(existing)
    elif existing is None and is_system_notice(prompt):
        # A harness notice is not a task (#185). With no route at all it creates none. A route that this
        # session cannot reuse (another session's, or closed) is replaced as before, so no fallback to it.
        context = ''
    else:
        route = build_route(root, prompt or 'development task', session_id(payload))
        try:
            set_active_route(root, route.to_dict())
            context = route_context(route)
        except ActiveChangeConflict as conflict:
            # Keep the open change package's route; a new prompt must not orphan it.
            context = (route_context(existing) + '\n\n') if existing else ''
            context += f'Getzilla kept the active route: {conflict}'
    emit({
        'hookSpecificOutput': {
            'hookEventName': 'UserPromptSubmit',
            'additionalContext': context,
        }
    })


if __name__ == '__main__':
    run_hook(main, {})
