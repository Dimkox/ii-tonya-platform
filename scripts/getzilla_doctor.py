from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))

from getzilla.doctor import run_doctor
from getzilla.toolchain import check_toolchain, offer_install_lines
from getzilla.util import find_root

parser = argparse.ArgumentParser(description='Health check. Prints toolchain pins and install offers for missing or old tools.')
parser.add_argument(
    '--offer-install',
    action='store_true',
    help='Print fallback/newer install commands for tools that are missing or below minimum.',
)
parser.add_argument(
    '--enforcement',
    action='store_true',
    help='Report what Getzilla actually enforces here (advisory hooks, CI on the exact head, Trust CI) and exit.',
)
parser.add_argument('--json', action='store_true', help='with --enforcement: print the report as JSON')
args = parser.parse_args()
root = find_root()
if args.enforcement:
    import json

    from getzilla.ci_gate import default_branch, repository_slug
    from getzilla.enforcement import default_gh_client, inspect_enforcement

    slug = repository_slug(root)
    branch = default_branch(root)[0]
    report = inspect_enforcement(root, slug=slug, branch=branch, github=default_gh_client(root))
    if args.json:
        print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    else:
        print(f'ENFORCEMENT level: {report.level}')
        for agent, hook in sorted(report.hooks.items()):
            print(f'  hooks {agent}: pre_tool_use={hook["pre_tool_use"]} stop_gate={hook["stop_gate"]} ({hook["config"]})')
        print(f'  hook self-test: {report.self_test.get("status")}')
        print(f'  stop gate: {report.stop_gate}')
        print(f'  CI workflow: {report.ci_workflow or "missing"}')
        protection = report.branch_protection
        print(f'  branch protection ({protection.get("branch")}): {protection.get("state")}'
              + (f', required checks {protection.get("required_checks")}' if protection.get('required_checks') else ''))
        for note in report.notes:
            print(f'  note: {note}')
    raise SystemExit(0)
items = run_doctor(root)
for item in items:
    print(f'{item.status.upper():4} {item.name}: {item.message}')
offers = offer_install_lines(check_toolchain(root))
if args.offer_install or offers:
    if offers:
        print('OFFER install fallback (or newer):')
        for line in offers:
            print(f'  {line}')
    elif args.offer_install:
        print('OFFER: all declared tools meet the minimum pin.')
raise SystemExit(1 if any(item.status == 'fail' for item in items) else 0)
