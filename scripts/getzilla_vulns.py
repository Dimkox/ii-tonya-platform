from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))

from getzilla.known_vulns import ECOSYSTEMS, VulnerabilityError, download_database, scan  # noqa: E402
from getzilla.util import find_root  # noqa: E402
from getzilla.known_vulns import _version_key as upgrade_key  # noqa: E402

parser = argparse.ArgumentParser(
    description='Check pinned dependencies against known vulnerabilities (OSV: GitHub Advisory, PyPA, RustSec, Go, npm, NVD).',
)
parser.add_argument('--json', action='store_true', help='print the full report as JSON')
parser.add_argument('--online', action='store_true', help='query api.osv.dev (same as GETZILLA_OSV_ONLINE=1)')
parser.add_argument('--db', help='offline OSV mirror directory (same as GETZILLA_OSV_DB)')
parser.add_argument('--download-db', metavar='DIR',
                    help='refresh an offline mirror in DIR and exit; run on a host with network access')
parser.add_argument('--ecosystem', action='append', choices=ECOSYSTEMS,
                    help='with --download-db: only these ecosystems (default: all supported)')
args = parser.parse_args()

try:
    if args.download_db:
        for path in download_database(Path(args.download_db), args.ecosystem or ECOSYSTEMS):
            print(f'updated {path}')
        raise SystemExit(0)
    environ = dict(os.environ)
    if args.online:
        environ['GETZILLA_OSV_ONLINE'] = '1'
    if args.db:
        environ['GETZILLA_OSV_DB'] = args.db
    report = scan(find_root(), environ=environ)
except VulnerabilityError as exc:
    print(f'getzilla_vulns: {exc}', file=sys.stderr)
    raise SystemExit(2) from exc

if args.json:
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
else:
    print(f"{report['status'].upper()} known-vulnerabilities: {report['summary']}")
    for item in report['findings']:
        fixed = f" -> fixed in {', '.join(item['fixed'])}" if item['fixed'] else ' (no fixed version yet)'
        aliases = f" ({', '.join(item['aliases'][:3])})" if item['aliases'] else ''
        severity = f" [{item['severity']}]" if item['severity'] else ''
        print(f"  {item['ecosystem']} {item['package']} {item['version']}: {item['id']}{aliases}{severity}{fixed} — {item['manifest']}")
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        grouped: dict[tuple[str, str, str, str], list[dict]] = {}
        for item in report['findings']:
            grouped.setdefault((item['manifest'], item['ecosystem'], item['package'], item['version']), []).append(item)
        for (manifest, ecosystem, package, version), items in sorted(grouped.items()):
            fixes = sorted({fix for item in items for fix in item['fixed']}, key=upgrade_key)
            target = f'upgrade to >= {fixes[-1]}' if fixes else 'no fixed version published'
            ids = ', '.join(item['id'] for item in items)
            print(f"::error file={manifest},title={ecosystem} {package} {version}: {len(items)} known vulnerabilities::{target}. {ids}")
    for item in report['accepted']:
        print(f"  accepted until {item['accepted_until']}: {item['package']} {item['version']} {item['id']}")
status = report['status']
raise SystemExit(0 if status in {'pass', 'skip'} else 1 if status == 'fail' else 2)
