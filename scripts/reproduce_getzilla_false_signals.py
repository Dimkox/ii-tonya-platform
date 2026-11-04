#!/usr/bin/env python3
"""SCRUM-503 slice 4: reproduce Getzilla review_plan false signals at a fixed commit pair.

Read-only. Runs the vendored engine's review_plan.assess() for BASE..HEAD, then attributes every
path that makes the engine report BINARY_OR_UNKNOWN_INVENTORY to the exact engine branch that
fired (archive extension, extensionless name, 100755 mode, non-regular mode, unreadable numstat).
Each path is joined with the slice-1 classifier class so a reviewer can see why it is a false
signal. Prints JSON; exits 0. Usage: reproduce_getzilla_false_signals.py BASE HEAD
"""

from __future__ import annotations

import json
import subprocess  # nosec B404 - fixed git/node argv, no shell
import sys
import tempfile
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def git(*args: str) -> bytes:
    return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True).stdout  # nosec B603 B607


def modes(ref: str) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for row in git('ls-tree', '-r', '-z', ref).split(b'\0'):
        if row:
            meta, name = row.split(b'\t', 1)
            out.setdefault(name.decode(), set()).add(meta.split()[0].decode())
    return out


def causes(name: str, path_modes: set[str], suffixes: tuple[str, ...]) -> list[str]:
    """Mirror of review_plan.assess() binary branch (engine 2.3.1), one label per firing condition."""
    found = []
    if name.lower().endswith(suffixes):
        found.append('archive-or-executable-suffix')
    if '.' not in name.rsplit('/', 1)[-1].lstrip('.'):
        found.append('extensionless-name')
    if '100755' in path_modes:
        found.append('executable-mode')
    if not path_modes or not path_modes <= {'100644', '100755'}:
        found.append('non-regular-mode')
    return found


def main(base: str, head: str) -> dict:
    base, head = (git('rev-parse', '--verify', f'{ref}^{{commit}}').decode().strip() for ref in (base, head))
    # assess() reads HEAD and the working tree of its root, so it runs in a clean detached
    # worktree of HEAD with the engine vendored at that commit.
    with tempfile.TemporaryDirectory() as scratch:
        tree = Path(scratch) / 'tree'
        git('worktree', 'add', '--quiet', '--detach', str(tree), head)
        try:
            sys.path.insert(0, str(tree / '.getzilla'))
            from getzilla import __version__
            from getzilla import review_plan

            engine = review_plan.assess(tree, None, SimpleNamespace(
                bases=[SimpleNamespace(comparison_base_sha=base)], findings=[]))['risk_assessment']
        finally:
            git('worktree', 'remove', '--force', str(tree))
    stats = git('diff', '--numstat', '-z', '--no-renames', '--no-textconv', '--no-ext-diff', base, head, '--')
    merged: dict[str, set[str]] = {}
    for ref in (base, head):
        for name, values in modes(ref).items():
            merged.setdefault(name, set()).update(values)
    classes = {e['path']: e['class'] for e in json.loads(subprocess.run(  # nosec B603 B607
        ['node', 'scripts/classify-historical-binaries.mjs', '--full'], cwd=ROOT, check=True,
        capture_output=True, text=True).stdout)['entries']}
    signals, flagged_binary = [], 0
    for row in stats.split(b'\0'):
        if not row:
            continue
        added, removed, raw = row.split(b'\t', 2)
        name = raw.decode()
        if added == removed == b'-':
            reasons = causes(name, merged.get(name, set()), review_plan._EXECUTABLE_BINARY)
            if not reasons:
                flagged_binary += 1  # BINARY_FILE high-risk reason, not a gap
                continue
        elif not (added.isdigit() and removed.isdigit()):
            reasons = ['unreadable-numstat']
        else:
            continue
        signals.append({'path': name, 'causes': reasons, 'classifier': classes.get(name, 'not-in-classifier')})
    by_cause = Counter(c for s in signals for c in s['causes'])
    by_class = Counter(s['classifier'] for s in signals)
    return {'engine_version': __version__, 'base': base, 'head': head,
            'engine': {k: engine[k] for k in ('status', 'risk', 'gaps')},
            'binary_file_reasons': flagged_binary, 'gap_paths': len(signals),
            'by_cause': dict(by_cause), 'by_classifier': dict(by_class),
            'unexplained': [s for s in signals if s['classifier'] in ('unclassified', 'not-in-classifier')],
            'examples': {cls: [s for s in signals if s['classifier'] == cls][:3] for cls in by_class}}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(json.dumps(main(sys.argv[1], sys.argv[2]), indent=1))
