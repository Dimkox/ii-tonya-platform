from __future__ import annotations

import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))

import argparse

from getzilla.receipts import write_receipt
from getzilla.package_status import diagnostic_messages, inspect_package, receipt_inputs_unavailable
from getzilla.state import get_active_change, get_active_route
from getzilla.util import find_root

parser = argparse.ArgumentParser(description='Record a fingerprint-bound independent review receipt.')
parser.add_argument('kind', choices=['code_review', 'test_review', 'bitrix_review', 'security_review', 'data_review', 'release_review'])
parser.add_argument('--status', choices=['pass', 'fail'], required=True)
parser.add_argument('--report', required=True)
parser.add_argument('--reviewed-commit', help='Exact full commit SHA inspected by the independent reviewer; required for pass.')
args = parser.parse_args()
if args.status == 'pass' and not args.reviewed_commit:
    parser.error('--reviewed-commit is required for pass')
root = find_root()
report_path = root / args.report
if not report_path.is_file():
    raise SystemExit(f'Review report does not exist: {args.report}')
active = get_active_change(root)
if active:
    package = inspect_package(root, get_active_route(root), active)
    messages = diagnostic_messages(package)
    if messages:
        print('Package diagnostics: ' + '; '.join(messages), file=sys.stderr)
    if receipt_inputs_unavailable(package):
        raise SystemExit('Review was not recorded: selected package inputs cannot be read safely for receipt binding.')
    if args.status == 'pass' and any(item['severity'] == 'error' for item in package['findings']):
        raise SystemExit('Passing review was not recorded: resolve package completeness errors first.')
try:
    path = write_receipt(root, args.kind, args.status, args.report, reviewed_commit=args.reviewed_commit)
except (RuntimeError, ValueError, OSError) as exc:
    raise SystemExit(f'Review was not recorded: {exc}') from None
print(path.relative_to(root))
