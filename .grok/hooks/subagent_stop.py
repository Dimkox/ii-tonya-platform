#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

try:
    from _lib import agent_generation, agent_id, agent_type, emit, read_payload, root_from, run_hook
    from getzilla.state import record_agent_stop
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
    record_agent_stop(root, agent_id(payload), agent_type(payload), generation=agent_generation(payload))
    # Empty payload: additionalContext retriggers Grok's SubagentStop (~8 retries).
    emit({})


if __name__ == '__main__':
    run_hook(main, {})
