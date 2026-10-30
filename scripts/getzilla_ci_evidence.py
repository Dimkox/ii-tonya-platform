from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path, PurePosixPath
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.getzilla'))
from getzilla.ci_evidence import export_evidence
from getzilla.util import find_root, git_head, git_output


_MAX_REPORT_BYTES = 64 * 1024 * 1024
_STATUSES = {'passed', 'failed', 'pending', 'skipped', 'todo', 'disabled', 'focused'}
_ERRORS = (
    ('postgres_duplicate_relation', r'\b42P07\b|relation .{0,200} already exists'),
    ('postgres_duplicate_schema', r'\b42P06\b|schema .{0,200} already exists'),
    ('postgres_undefined_column', r'\b42703\b|column .{0,200} does not exist'),
    ('postgres_undefined_table', r'\b42P01\b|relation .{0,200} does not exist'),
    ('postgres_permission_denied', r'\b42501\b|permission denied'),
    ('postgres_serialization_failure', r'\b40001\b|could not serialize access'),
    ('postgres_lock_unavailable', r'\b55P03\b|could not obtain lock|lock timeout'),
    ('postgres_query_canceled', r'\b57014\b|statement timeout'),
    ('postgres_unique_violation', r'\b23505\b|duplicate key value'),
    ('postgres_check_violation', r'\b23514\b|violates check constraint'),
    ('promise_resolved_instead_of_rejecting', r'promise resolved .* instead of rejecting'),
    ('assertion_failure', r'\bAssertionError\b'),
    ('hook_timeout', r'Hook timed out'),
    ('test_timeout', r'Test timed out'),
    ('candidate_mismatch', r'\bearly_bird_candidate_mismatch\b'),
    ('capability_grants_invalid', r'\bpublic_expert_capability_grants_invalid\b'),
)


def _safe_path(value: str, root: Path, source_paths: set[str]) -> str:
    prefix = root.as_posix() + '/'
    if value.startswith(prefix):
        value = value[len(prefix):]
    path = PurePosixPath(value)
    if (value not in source_paths or not value or path.is_absolute() or '..' in path.parts
            or not re.fullmatch(r'[A-Za-z0-9_.@/-]+', value)
            or not path.parts or path.parts[0] not in {'packages', 'apps', 'tests', 'scripts', 'deploy'}
            or path.suffix not in {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'}):
        return '[external]'
    return value


def _diagnostics(messages: list[str], root: Path, source_paths: set[str]) -> dict:
    text = '\n'.join(messages)
    errors = [name for name, pattern in _ERRORS if re.search(pattern, text, re.I)]
    locations = []
    for match in re.finditer(r'([^\s():]+):(\d{1,9}):(\d{1,9})', text):
        path = _safe_path(match[1], root, source_paths)
        location = {'path': path, 'line': int(match[2]), 'column': int(match[3])}
        if path != '[external]' and location not in locations:
            locations.append(location)
    return {'errors': errors or (['unclassified_failure'] if messages else []), 'locations': locations}


def _status(value: object) -> str:
    if not isinstance(value, str) or value not in _STATUSES:
        raise ValueError('invalid report status')
    return value


def _messages(value: object) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError('invalid report diagnostics')
    return value


def retain_vitest_summary(root: Path, output: Path, *, expected_sha: str, run_id: str) -> None:
    """Only a fixed synthetic CI report is read; raw JSON/console never leaves CI.

    This summary is diagnostic evidence, not a test verdict or release receipt.
    Titles can contain arbitrary secrets in prose or parameterized values. Export
    only their digest and ordinal, never any original title fragment. An ordinal,
    committed source location and error category remain useful without disclosure.
    """
    head = git_head(root)
    summary = {'schema_version': 1, 'source_sha': head, 'run_id': run_id,
               'report_status': 'missing', 'files': []}
    if not re.fullmatch(r'[0-9a-f]{40}', expected_sha) or expected_sha != head:
        summary['report_status'] = 'source_mismatch'
    else:
        try:
            source_paths = set((git_output(root, 'ls-tree', '-r', '--name-only', '-z', head) or '').split('\0'))
            # Do not follow links, directories, FIFOs or paths from report contents.
            descriptor = os.open(root / 'vitest-results.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as stream:
                metadata = os.fstat(stream.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > _MAX_REPORT_BYTES:
                    raise ValueError('invalid report file')
                content = stream.read(_MAX_REPORT_BYTES + 1)
            if len(content) > _MAX_REPORT_BYTES:
                raise ValueError('report exceeds size limit')
            summary['original_sha256'] = hashlib.sha256(content).hexdigest()
            report = json.loads(content)
            if not isinstance(report, dict) or not isinstance(report.get('testResults'), list):
                raise ValueError('invalid report shape')
            files = []
            for record in report['testResults']:
                if (not isinstance(record, dict) or not isinstance(record.get('name'), str)
                        or not isinstance(record.get('assertionResults'), list)):
                    raise ValueError('invalid report file entry')
                tests = []
                for ordinal, test in enumerate(record['assertionResults'], start=1):
                    if not isinstance(test, dict) or not isinstance(test.get('fullName'), str):
                        raise ValueError('invalid report test entry')
                    tests.append({'ordinal': ordinal,
                                  'name_sha256': hashlib.sha256(test['fullName'].encode('utf-8')).hexdigest(),
                                  'status': _status(test.get('status')),
                                  **_diagnostics(_messages(test.get('failureMessages', [])), root, source_paths)})
                message = record.get('message', '')
                if not isinstance(message, str):
                    raise ValueError('invalid report file diagnostics')
                files.append({'path': _safe_path(record['name'], root, source_paths), 'status': _status(record.get('status')),
                              'tests': tests, **_diagnostics([message] if message else [], root, source_paths)})
            summary.update(report_status='available', files=files)
        except FileNotFoundError:
            pass
        except (OSError, ValueError, UnicodeError, RecursionError):
            # No exception details: JSON parser and file errors can contain secrets.
            summary['report_status'] = 'invalid'
    content = (json.dumps(summary, indent=2, sort_keys=True, ensure_ascii=True) + '\n').encode()
    (output / 'vitest-summary.json').write_bytes(content)
    provenance_path = output / 'provenance.json'
    provenance = json.loads(provenance_path.read_text())
    provenance['files'].append({'path': 'vitest-summary.json', 'sha256': hashlib.sha256(content).hexdigest()})
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + '\n')


def main() -> None:
    parser = argparse.ArgumentParser(description='Export allowlisted evidence from this CI run.')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--job', required=True)
    parser.add_argument('--status', required=True)
    parser.add_argument('--vitest-summary', action='store_true')
    args = parser.parse_args()
    root = find_root()
    run_id = os.environ['GITHUB_RUN_ID']
    export_evidence(root, args.output, logs=Path(os.environ['RUNNER_TEMP']), job=args.job,
                    status=args.status, run_id=run_id)
    if args.vitest_summary:
        retain_vitest_summary(root, args.output, expected_sha=os.environ.get('EXPECTED_SHA', ''), run_id=run_id)


if __name__ == '__main__':
    main()
