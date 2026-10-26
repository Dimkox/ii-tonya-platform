#!/usr/bin/env python3
"""Stop gate — soft (warn only, never block stop)."""
from __future__ import annotations

import sys
from pathlib import Path

for _p in (Path.cwd(), Path.cwd() / ".getzilla"):
    s = str(_p)
    if s not in sys.path:
        sys.path.append(s)

try:
    from _lib import emit, harness, read_payload, record_degraded, root_from, stop_hook_active
except Exception:
    print('{}')
    raise SystemExit(0)


def main() -> None:
    try:
        payload = read_payload()
        root = root_from(payload)
        try:
            from getzilla.package_status import collect_worktree, diagnostic_messages, inspect_package, receipt_inputs_unavailable
            from getzilla.receipts import validate_evidence
            from getzilla.state import get_active_change, get_active_route, reset_stop_attempt, update_route
        except Exception:
            emit({})
            return

        route = get_active_route(root)
        if route:
            try:
                from getzilla.claim_check import BLOCKING_HARNESSES, stop_mode, unsupported_claim
                from getzilla.hook_health import route_degraded_events

                claim = unsupported_claim(root, route, payload)
                degraded = route_degraded_events(root, route)
            except Exception as error:  # noqa: BLE001 - the checks are advisory; record that they did not run
                record_degraded('stop_gate', error, payload)
                claim, degraded = None, []
            if claim and stop_mode(root, route) == 'strict' and not stop_hook_active(payload):
                if harness() in BLOCKING_HARNESSES:
                    emit({'decision': 'block', 'reason': 'Getzilla stop gate: ' + claim})
                    return
                record_degraded('stop_gate', f'STRICT_BLOCK_UNSUPPORTED:{harness()}', payload)
        else:
            claim, degraded = None, []
        active = get_active_change(root)
        messages = []
        unsafe_inputs = False
        if active:
            package = inspect_package(root, route, active)
            worktree = collect_worktree(root, route, package['initial_checkpoint'])
            messages = diagnostic_messages(package, worktree)
            unsafe_inputs = receipt_inputs_unavailable(package)
        if not route:
            emit({'systemMessage': 'Adaptive note (non-blocking): ' + '; '.join(messages)} if messages else {})
            return
        gaps = (
            ['package: receipt validation unavailable until unsafe or unreadable selected inputs are resolved']
            if unsafe_inputs else validate_evidence(root, route) if route.get('required_evidence') else []
        )
        if gaps:
            messages.insert(0, 'missing/stale evidence: ' + '; '.join(gaps))
        if claim:
            messages.insert(0, 'unsupported verification claim: ' + claim)
        if degraded:
            messages.append(f'{len(degraded)} hook call(s) failed open since this route started, so Getzilla policy '
                            'did not run for them (.getzilla/runtime/hook-events.jsonl)')
        if messages:
            emit({'systemMessage': 'Adaptive note (non-blocking): ' + '; '.join(messages)})
            return
        if not route.get('required_evidence'):
            emit({})
            return

        reset_stop_attempt(root, route['route_id'])
        update_route(root, status='completed')
        emit({})
    except Exception as error:
        record_degraded('stop_gate', error)
        emit({})


if __name__ == '__main__':
    main()
