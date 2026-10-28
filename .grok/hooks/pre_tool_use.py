#!/usr/bin/env python3
"""PreToolUse — policy gate; a policy that fails to load still refuses protected actions (#78)."""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

# Standard library only: used when the Getzilla policy or its helper library did not load (#78).
_DEGRADED_SHELL_TOOLS = frozenset({'Bash', 'bash', 'run_shell_command', 'shell', 'exec_command', 'PowerShell',
                                   'powershell', 'Monitor', 'monitor', 'terminal', 'run_in_terminal'})
_DEGRADED_WRITE_TOOLS = frozenset({'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'write_file', 'edit', 'replace',
                                   'edit_file', 'apply_patch', 'create_file', 'str_replace_editor'})
_DEGRADED_PROTECTED_SHELL = re.compile(
    r'(?:^|[\s;&|(`])(?:'
    r'git(?:\s+\S+)*?\s+(?:push|merge|tag|reset\s+--hard)\b'
    r'|gh(?:\s+\S+)*?\s+(?:pr\s+(?:merge|review)|release|workflow\s+run|api)\b'
    r'|docker(?:\s+\S+)*?\s+push\b|npm(?:\s+\S+)*?\s+publish\b|twine\s+upload\b'
    r'|terraform\s+(?:apply|destroy)\b|kubectl\s+(?:apply|delete)\b|rm\s+-\S*[rRf]'
    r')'
)
_DEGRADED_CONTROL_PLANE = re.compile(r'(?:^|[\s/"\'=>:])(?:\.getzilla/|\.grok/|\.claude/|\.codex/|\.qwen/|\.gemini/|AGENTS\.md\b)')
_DEGRADED_SHELL_WRITE = re.compile(r'>|\b(?:tee|cp|mv|rm|install|ln|chmod|truncate|touch|rsync)\b|\bsed\s+-i|\bperl\s+-\S*i')


def _degraded_denial(tool: str, inputs: Any) -> str | None:
    """Why a protected action is refused while the policy is not loaded, or None for anything else."""
    if not isinstance(inputs, dict):
        return None
    reason = ('Getzilla policy did not load, so this protected action is refused until the hook is repaired '
              '(see .getzilla/runtime/hook-events.jsonl). Reads and ordinary edits stay allowed.')
    if tool in _DEGRADED_SHELL_TOOLS:
        command = inputs.get('command', inputs.get('cmd'))
        if isinstance(command, list):
            command = ' '.join(str(part) for part in command)
        if not isinstance(command, str):
            return None
        if _DEGRADED_PROTECTED_SHELL.search(command):
            return reason
        if _DEGRADED_CONTROL_PLANE.search(command) and _DEGRADED_SHELL_WRITE.search(command):
            return reason
        return None
    if tool in _DEGRADED_WRITE_TOOLS:
        targets = [str(inputs.get(key)) for key in ('file_path', 'path', 'notebook_path', 'filePath') if inputs.get(key)]
        targets += [str(inputs.get(key)) for key in ('patch', 'input') if isinstance(inputs.get(key), str)]
        if any(_DEGRADED_CONTROL_PLANE.search(target.replace('\\', '/')) for target in targets):
            return reason
    return None


def _degraded_output(reason: str | None) -> str:
    if reason is None:
        return '{"decision":"allow"}'
    return json.dumps({
        'decision': 'deny', 'reason': reason,
        'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
                               'permissionDecisionReason': reason},
    })


def _degraded_payload() -> tuple[str, Any]:
    try:
        raw = sys.stdin.buffer.read().decode('utf-8-sig', errors='replace')
        payload = json.loads(raw) if raw.strip() else {}
    except (OSError, ValueError):
        return '', None
    if not isinstance(payload, dict):
        return '', None
    tool = str(payload.get('tool_name') or payload.get('toolName') or '')
    inputs = payload.get('tool_input', payload.get('toolInput', payload.get('toolArgs')))
    if isinstance(inputs, str):
        try:
            inputs = json.loads(inputs)
        except ValueError:
            inputs = None
    return tool, inputs


# Make stack importable even when cwd is project root
_ROOT_CANDIDATES = [
    Path.cwd(),
    Path.cwd() / ".getzilla",
]
for _p in _ROOT_CANDIDATES:
    s = str(_p)
    if s not in sys.path:
        sys.path.append(s)

try:
    from _lib import (
        record_degraded,
        RootContext,
        _shell_tokens,
        agent_generation,
        agent_id,
        emit,
        permission_output,
        read_payload,
        root_context,
        session_id,
        tool_input,
        tool_name,
    )
except Exception as _lib_error:
    # If even _lib is missing, refuse only protected actions and leave a trace that policy did not run.
    # Standard library only: the Getzilla package is what failed to import.
    import contextlib as _contextlib
    with _contextlib.suppress(Exception):
        import datetime as _datetime
        import json as _json
        _start = Path.cwd()
        _root = next((_path for _path in (_start, *_start.parents) if (_path / '.getzilla').is_dir()), None)
        if _root is not None:
            (_root / '.getzilla' / 'runtime').mkdir(parents=True, exist_ok=True)
            with (_root / '.getzilla' / 'runtime' / 'hook-events.jsonl').open('a', encoding='utf-8', newline='\n') as _handle:
                _handle.write(_json.dumps({
                    'ts': _datetime.datetime.now(_datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                    'kind': 'HOOK_DEGRADED', 'hook': 'pre_tool_use', 'harness': 'unknown',
                    'error': f'{type(_lib_error).__name__}: {_lib_error}'[:300],
                }) + '\n')
    print(_degraded_output(_degraded_denial(*_degraded_payload())))
    raise SystemExit(0)


_DENIAL_WINDOW_SECONDS = 15 * 60
_DENIAL_MAX_ENTRIES = 128
_EXACT_CIRCUIT_BREAKER_GUIDANCE = (
    'Circuit breaker: this exact tool invocation was denied again. Do not retry it, mutate it cosmetically, '
    'or create a speculative grant. Stop dependent subagents, mark this objective BLOCKED, and report the blocker.'
)
_OBJECTIVE_CIRCUIT_BREAKER_GUIDANCE = (
    'Circuit breaker: the rewritten invocation was denied for the same objective. Do not retry this objective '
    'again or create a speculative grant. Stop dependent subagents, mark this objective BLOCKED, '
    'and report the blocker.'
)
_CONTROL_PLANE_BATCH_GUIDANCE = (
    'Create one exact protected-path grant covering every target, then use Edit/Write/apply_patch. '
    'For an atomic multi-file batch, put the manifest outside the repository '
    'and run `python3 scripts/getzilla_protected_write.py --manifest <path>`.'
)


def _actionable_reason(reason: str) -> str:
    if 'control-plane shell mutation' not in reason:
        return reason
    if 'getzilla_protected_write.py' in reason:
        return reason
    return f'{reason} {_CONTROL_PLANE_BATCH_GUIDANCE}'


def _fingerprint(material: dict[str, Any]) -> str:
    encoded = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
        default=str,
    ).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def _ledger_reason(action: str) -> str:
    if action == 'external-write':
        return 'External write denied by repository policy.'
    if action == 'protected-path-write':
        return 'Protected path write denied by repository policy.'
    if action.startswith('git-push') or action in {
        'pull-request-merge', 'docker-push', 'npm-publish', 'github-release', 'workflow-dispatch'
    }:
        return f'Production action {action} denied by repository policy.'
    return f'Action {action} denied by repository policy.'


def _grants_digest(context: RootContext) -> str | None:
    root = context.ledger_root
    if root is None:
        return None
    try:
        return hashlib.sha256((Path(root) / '.getzilla/runtime/approvals.json').read_bytes()).hexdigest()
    except OSError:
        return None


def _denial_fingerprints(
    session: str,
    tool: str,
    input_data: dict[str, Any],
    reason: str,
    context: RootContext,
    action: str,
) -> tuple[str, str]:
    roots = {
        'session_root': str(context.session_root) if context.session_root else None,
        'effective_root': str(context.effective_root) if context.effective_root else None,
        'resolution_status': context.resolution_status,
        # A grant recorded after a denial makes the retry a new attempt, not a blind repeat.
        'grants_sha256': _grants_digest(context),
    }
    exact = _fingerprint({
        'session_id': session,
        'tool_name': tool,
        'tool_input': input_data,
        'reason': _ledger_reason(action),
        'reason_sha256': hashlib.sha256(reason.encode('utf-8')).hexdigest(),
        'root_context': roots,
    })
    objective_material = {
        'session_id': session,
        'tool_name': tool,
        'reason': reason,
        'action': action,
        'root_context': roots,
    }
    if action == 'ambiguous-sensitive-shell' or not context.sensitive_safe:
        # One root-resolution reason covers every ambiguous command; the operands tell independent objectives
        # apart, while respacing or reordering flags stays the same objective (#80).
        objective_material['target_sha256'] = _command_target(input_data)
    objective = _fingerprint(objective_material)
    return exact, objective


# What the agent can do instead, by the reason the command's directory could not be established.
_ROOT_HINTS = (
    ('command.inline-program',
     ' Inline interpreter code (python -c, php -r, node -e, a heredoc into an interpreter) can touch any path, '
     'so it is not run. Write the program to .getzilla/runtime/scratch/<name>.py (no grant needed) and run it '
     'as a file: python3 .getzilla/runtime/scratch/<name>.py.'),
    ('command.dynamic-substitution',
     ' $(...) and backticks hide the directory. Run the inner command on its own, then use its output as a '
     'literal path.'),
    ('command.control-flow',
     ' Only && and ; are followed. Split pipes, || and & into separate commands.'),
)


def _root_hint(context: Any) -> str:
    sources = set(getattr(context, 'command_workdirs', {}) or {})
    for source, hint in _ROOT_HINTS:
        if source in sources:
            return hint
    status = getattr(context, 'resolution_status', '')
    if status == 'ambiguous-command-root':
        return (' Use one literal directory: no $VARIABLES, globs or braces in cd, pushd or git -C, and no two '
                'repositories in one command. Split it: one command per repository, each starting with '
                'cd <that repository>, and write long text such as a commit message to a file first.')
    if status == 'cross-root':
        return (f' The command runs in {getattr(context, "effective_root", None)}, but the session is in '
                f'{getattr(context, "session_root", None)}. Run it as its own command that starts with cd into '
                'that repository, and record any grant from inside that repository.')
    return ''


def _command_target(input_data: dict[str, Any]) -> str | None:
    command = input_data.get('command') if isinstance(input_data, dict) else None
    if not isinstance(command, str):
        return None
    try:
        words = [token.value for token in _shell_tokens(command) if not token.operator]
    except ValueError:
        words = command.split()
    operands = sorted({word for word in words if not word.startswith('-')})
    return hashlib.sha256(json.dumps(operands, ensure_ascii=False).encode('utf-8')).hexdigest()


def _fresh_entries(value: Any, now: float) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    fresh: dict[str, dict[str, Any]] = {}
    for key, entry in value.items():
        if not isinstance(entry, dict):
            continue
        updated_at = entry.get('updated_at')
        if isinstance(updated_at, (int, float)) and now - float(updated_at) <= _DENIAL_WINDOW_SECONDS:
            fresh[str(key)] = entry
    return fresh


def _increment_entry(
    entries: dict[str, dict[str, Any]],
    fingerprint: str,
    *,
    session: str,
    tool: str,
    now: float,
    evidence: dict[str, Any],
) -> int:
    previous = entries.get(fingerprint, {})
    previous_count = previous.get('count', 0) if isinstance(previous, dict) else 0
    count = int(previous_count) + 1 if isinstance(previous_count, int) else 1
    entries[fingerprint] = {
        'count': count,
        'session_id': session,
        'tool_name': tool,
        'updated_at': now,
        **evidence,
    }
    return count


def _cap_entries(entries: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if len(entries) <= _DENIAL_MAX_ENTRIES:
        return entries
    ordered = sorted(
        entries.items(),
        key=lambda item: float(item[1].get('updated_at', 0)),
        reverse=True,
    )[:_DENIAL_MAX_ENTRIES]
    return dict(ordered)


def _source_sha256(module: Any, filename: str) -> str:
    """Digest of a hook source; one inside the engine archive (getzilla.zip) is read through its import loader."""
    try:
        data = Path(filename).read_bytes()
    except OSError:
        data = module.__loader__.get_data(filename)
    return hashlib.sha256(data).hexdigest()


def _record_denial(
    root: Path,
    session: str,
    tool: str,
    input_data: dict[str, Any],
    reason: str,
    context: RootContext,
    action: str,
) -> tuple[int, int]:
    from getzilla import _policy_legacy
    from getzilla.state import runtime_lock
    from getzilla.util import dump_json, load_json, runtime_dir

    now = time.time()
    exact_fingerprint, objective_fingerprint = _denial_fingerprints(
        session,
        tool,
        input_data,
        reason,
        context,
        action,
    )
    path = runtime_dir(root) / 'tool-denials.json'
    command = input_data.get('command')
    sources = {
        'hook': (sys.modules.get(__name__), __file__),
        'root_parser': (sys.modules.get(root_context.__module__), root_context.__code__.co_filename),
        'policy_parser': (_policy_legacy, _policy_legacy.__file__),
    }
    evidence = {
        'session_cwd': context.session_cwd,
        'session_root': str(context.session_root) if context.session_root else None,
        'command_workdirs': {
            key: '<ambiguous>' if value == '<ambiguous>' else '<declared>'
            for key, value in context.command_workdirs.items()
        },
        'command_workdir_sources': sorted(context.command_workdirs),
        'root_failure_sources': sorted(
            key for key, value in context.command_workdirs.items() if value == '<ambiguous>'
        ),
        'hook_implementation': {
            name: {'path': str(Path(filename).resolve()), 'sha256': _source_sha256(module, filename)}
            for name, (module, filename) in sources.items()
        },
        'effective_root': str(context.effective_root) if context.effective_root else None,
        'resolution_status': context.resolution_status,
        'action': action,
        'reason': _ledger_reason(action),
        'reason_sha256': hashlib.sha256(reason.encode('utf-8')).hexdigest(),
        'tool_input_sha256': _fingerprint(input_data),
        'command_sha256': hashlib.sha256(command.encode('utf-8')).hexdigest() if isinstance(command, str) else None,
    }
    with runtime_lock(root, 'tool-denials'):
        data = load_json(path, {}) or {}
        if not isinstance(data, dict):
            data = {}
        exact_entries = _fresh_entries(data.get('exact', data.get('entries')), now)
        objective_entries = _fresh_entries(data.get('objectives'), now)
        exact_count = _increment_entry(
            exact_entries,
            exact_fingerprint,
            session=session,
            tool=tool,
            now=now,
            evidence=evidence,
        )
        objective_count = _increment_entry(
            objective_entries,
            objective_fingerprint,
            session=session,
            tool=tool,
            now=now,
            evidence=evidence,
        )
        dump_json(path, {
            'schema_version': 3,
            'exact': _cap_entries(exact_entries),
            'objectives': _cap_entries(objective_entries),
        })
    return exact_count, objective_count


def _warn_observer_failure() -> None:
    try:
        sys.stderr.write('Getzilla: lifecycle observation unavailable; authorization continues.\n')
    except Exception:
        # A broken diagnostics sink cannot bypass mandatory authorization either.
        return


# Same bound as the policy's command scan. An oversize Bash command is refused here,
# before root_context or the policy parses it, so the verdict lands well inside the
# harness hook timeout instead of racing it (review round 3).
MAX_BASH_COMMAND_CHARS = 131072


def _oversize_bash_command(current_tool: str, current_input: Any) -> bool:
    if current_tool != 'Bash':
        return False
    command = current_input.get('command') if isinstance(current_input, dict) else current_input
    size = len(command) if isinstance(command, str) else len(json.dumps(command, default=str))
    return size > MAX_BASH_COMMAND_CHARS


def _deny(payload: dict[str, Any], current_tool: str, current_input: dict[str, Any],
          reason: str, *, context: RootContext | None = None,
          action: str = 'policy-denial') -> None:
    """An established denial stays denied when context or recording fails."""
    message = reason
    try:
        message = _actionable_reason(reason)
        if context is None:
            context_input = current_input
            if action in {'invalid-tool-input', 'oversize-command'}:
                # Refused commands are not parsed to establish ledger identity.
                context_input = {key: value for key, value in current_input.items()
                                 if key not in {'command', 'cmd'}}
            context = root_context(payload, context_input, current_tool)
        ledger_root = context.ledger_root
        if ledger_root is None:
            raise RuntimeError('no recognized repository root for denial ledger')
        exact_count, objective_count = _record_denial(
            ledger_root, session_id(payload), current_tool, current_input,
            message, context, action,
        )
        if exact_count >= 2:
            message = f'{_EXACT_CIRCUIT_BREAKER_GUIDANCE} Original denial: {message}'
        elif objective_count >= 2:
            message = f'{_OBJECTIVE_CIRCUIT_BREAKER_GUIDANCE} Original denial: {message}'
    except Exception:
        message = f'{message} Denial recording unavailable; repeat counts are not established.'
    emit(permission_output(False, message))


def _path_miss(current_tool: str, current_input: dict[str, Any], payload: dict[str, Any], root: Path | None) -> str | None:
    """A read whose every named path is missing is refused with the real paths (getzilla.path_hints)."""
    command = current_input.get('command')
    if current_tool != 'Bash' or root is None or not isinstance(command, str):
        return None
    try:
        from getzilla.path_hints import command_cwd, refusal
        return refusal(root, command, command_cwd(root, payload, current_input))
    except Exception:
        try:
            sys.stderr.write('Getzilla: path hints unavailable; the command runs unchecked.\n')
        except Exception:
            # Diagnostics are advisory; an allowed command still runs.
            return None
        return None


def _unread_edit(current_tool: str, current_input: dict[str, Any], payload: dict[str, Any], root: Path | None) -> str | None:
    """A patch that changes an existing file this session never read is refused (getzilla.read_ledger)."""
    command = current_input.get('command')
    if current_tool != 'apply_patch' or root is None or not isinstance(command, str):
        return None
    try:
        from getzilla.path_hints import command_cwd
        from getzilla.read_ledger import refusal
        return refusal(root, session_id(payload), command, command_cwd(root, payload, current_input))
    except Exception:
        # The ledger is a guard against blind edits; when it cannot be read, the patch runs.
        return None


def _serial_batch(current_tool: str, current_input: dict[str, Any], payload: dict[str, Any], root: Path | None) -> str | None:
    """A serial batch of heavy commands is refused with the parallel command (getzilla.parallel)."""
    command = current_input.get('command')
    if current_tool != 'Bash' or root is None or not isinstance(command, str):
        return None
    try:
        from getzilla.parallel import serial_refusal
        from getzilla.path_hints import command_cwd
        return serial_refusal(root, command, command_cwd(root, payload, current_input))
    except Exception:
        try:
            sys.stderr.write('Getzilla: parallel guard unavailable; the command runs unchecked.\n')
        except Exception:
            # Diagnostics are advisory; an allowed command still runs.
            return None
        return None


def main() -> None:
    try:
        payload = read_payload()
        current_tool = tool_name(payload)
        current_input = tool_input(payload)
        if current_input.get('_getzilla_input_error'):
            _deny(payload, current_tool, current_input, current_input['_getzilla_input_error'],
                  action='invalid-tool-input')
            return
        if _oversize_bash_command(current_tool, current_input):
            _deny(payload, current_tool, current_input, (
                f'Blocked a Bash command longer than {MAX_BASH_COMMAND_CHARS} characters; '
                'split it or write the payload to a file first.'
            ), action='oversize-command')
            return
        context = root_context(payload, current_input, current_tool)
        try:
            from getzilla.policy import evaluate_pre_tool, sensitive_action
        except Exception as error:
            # Policy stack not importable: record it, refuse protected actions, allow the rest (#78).
            record_degraded('pre_tool_use', error, payload)
            denial = _degraded_denial(current_tool, current_input)
            emit(permission_output(denial is None, denial))
            return

        classification_root = context.effective_root or context.session_root or Path.cwd()
        action = sensitive_action(classification_root, {
            'tool_name': current_tool,
            'tool_input': current_input,
        })
        if current_tool == 'Bash' and context.has_ambiguous_command_evidence and action is None:
            action = 'ambiguous-sensitive-shell'
        root = context.effective_root or context.session_root
        if root is not None:
            try:
                from getzilla.agent_lifecycle import observe_tool
                observe_tool(root, agent_id(payload), agent_generation(payload))
            except Exception:
                # Observation is advisory; failure must never skip authorization.
                _warn_observer_failure()
        if action and not context.sensitive_safe:
            allowed = False
            reason = (f'Sensitive action {action} denied: root resolution status is {context.resolution_status}.'
                      + _root_hint(context))
        elif root is None:
            allowed, reason = True, None
        else:
            try:
                allowed, reason = evaluate_pre_tool(root, {
                    'tool_name': current_tool,
                    'tool_input': current_input,
                })
            except Exception:
                if action:
                    allowed, reason = False, f'Sensitive action {action} denied: policy evaluation failed closed.'
                else:
                    raise
        if allowed:
            miss = (_path_miss(current_tool, current_input, payload, root)
                    or _unread_edit(current_tool, current_input, payload, root)
                    or _serial_batch(current_tool, current_input, payload, root))
            emit(permission_output(miss is None, miss))
            return

        _deny(payload, current_tool, current_input, reason or 'Blocked by Getzilla policy',
              context=context, action=action or 'policy-denial')
    except Exception as error:
        # Fail-open: never lock the agent on hook bugs, but record that policy did not run
        record_degraded('pre_tool_use', error)
        emit(permission_output(True))


if __name__ == '__main__':
    main()
