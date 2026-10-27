from __future__ import annotations

import contextlib
import json
import os
import posixpath
import re
import shlex
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

HOOK_DIR = Path(__file__).resolve().parent
REPO_CANDIDATE = HOOK_DIR.parents[1]
STACK = REPO_CANDIDATE / '.getzilla'
if str(STACK) not in sys.path:
    sys.path.insert(0, str(STACK))

from getzilla import fsx
from getzilla._policy_legacy import (
    _executable_name,
    _nested_commands,
    _shell_tokens,
    _simple_commands,
    _unwrap_execution_wrappers,
    analyze_command_authority,
)
from getzilla.util import find_root

_POSIX_SHELLS = {'bash', 'sh', 'zsh', 'dash', 'ksh'}
# Native Windows command interpreters and cmdlet spellings (compared lower-cased).
_WINDOWS_SHELLS = {'cmd', 'powershell', 'pwsh'}
_WINDOWS_DIRECTORY_COMMANDS = {'cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location'}
_WINDOWS_DYNAMIC_COMMANDS = {'invoke-expression', 'iex'}
# Interpreter code passed inline (option, stdin or here-document) is opaque to policy, unlike a
# reviewable script file or module, so such invocations fail closed.
_PYTHON_INTERPRETER = re.compile(r'^(?:python|pypy)(?:\d+(?:\.\d+)*)?$')
_PHP_INTERPRETER = re.compile(r'^php(?:\d+(?:\.\d+)*)?$')
_INLINE_CODE_OPTIONS = {
    'node': {'-e', '--eval', '-p', '--print', '-'},
    'nodejs': {'-e', '--eval', '-p', '--print', '-'},
    'bun': {'-e', '--eval', '-p', '--print'},
    'lua': {'-e', '-'},
    'luajit': {'-e', '-'},
    'rscript': {'-e'},
    'osascript': {'-e'},
}
_INLINE_CODE_CLUSTERS = {'perl': 'eE', 'ruby': 'e'}
_AWK_INTERPRETERS = {'awk', 'gawk', 'mawk', 'nawk'}
_AWK_EXECUTION = re.compile(r'system|getline|\||@load')
_HERE_DOCUMENT_OPERATORS = {'<<', '<<-', '<<<'}


def _shells() -> set[str]:
    return _POSIX_SHELLS | _WINDOWS_SHELLS if fsx.WINDOWS else _POSIX_SHELLS


def _is_directory_command(word: str) -> bool:
    if fsx.WINDOWS:
        return word.lower() in _WINDOWS_DIRECTORY_COMMANDS
    return word in {'cd', 'pushd'}


def _is_git(word: str) -> bool:
    if fsx.WINDOWS:
        return _executable_name(word) == 'git'
    return Path(word).name == 'git'


def record_degraded(hook: str, error: BaseException | str | None = None, payload: dict[str, Any] | None = None) -> None:
    """Append a HOOK_DEGRADED event: this hook let an action through because its own code failed.

    Never raises, and imports nothing from getzilla, because it runs exactly when that failed.
    """
    with contextlib.suppress(Exception):
        import datetime

        start = Path(str((payload or {}).get('cwd') or os.getcwd()))
        root = next((path for path in (start, *start.parents) if (path / '.getzilla').is_dir()), None)
        if root is None:
            return
        runtime = root / '.getzilla' / 'runtime'
        runtime.mkdir(parents=True, exist_ok=True)
        detail = error if isinstance(error, str) else (f'{type(error).__name__}: {error}' if error else 'unknown')
        event = {
            'ts': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'kind': 'HOOK_DEGRADED', 'hook': hook, 'harness': harness(), 'error': str(detail)[:300],
        }
        with (runtime / 'hook-events.jsonl').open('a', encoding='utf-8', newline='\n') as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + '\n')


def run_hook(main: Callable[[], None], fallback: dict[str, Any]) -> None:
    """Run a hook entry point.

    POSIX ``command`` lines in hooks.json end in ``|| python3 <alias> || python3
    -c "print('{}')"``, so a failure there is absorbed by the shell exactly as
    before. ``commandWindows`` lines have no fallback chain: on Windows a
    failing hook reports the traceback on stderr and emits the same fail-open
    fallback itself instead of crashing.
    """
    if not fsx.WINDOWS:
        main()
        return
    try:
        main()
    except Exception:
        with contextlib.suppress(Exception):
            traceback.print_exc()
        emit(fallback)

TOOL_ALIASES = {
    'run_terminal_command': 'Bash',
    'read_file': 'Read',
    'read_many_files': 'Read',
    'open_file': 'Read',
    'search_replace': 'Edit',
    'write': 'Write',
    'Write': 'Write',
    'Edit': 'Edit',
    'spawn_subagent': 'Agent',
    'task': 'Agent',
    'Task': 'Agent',
    'run_shell_command': 'Bash',
    'monitor': 'Bash',
    'Monitor': 'Bash',
    'PowerShell': 'Bash',
    'shell': 'Bash',
    'local_shell': 'Bash',
    'exec_command': 'Bash',
    'container.exec': 'Bash',
    'write_file': 'Write',
    'edit': 'Edit',
    'replace': 'Edit',
    'MultiEdit': 'Edit',
    'NotebookEdit': 'Edit',
    'agent': 'Agent',
    'bash': 'Bash',
    'powershell': 'Bash',
    'create': 'Write',
    'view': 'Read',
    'str_replace': 'Edit',
}


def read_payload() -> dict[str, Any]:
    # Agents send UTF-8 JSON. Text-mode stdin uses the console code page on Windows (cp1251 on
    # a Russian system), which turned Cyrillic prompts into mojibake, so decode the bytes here.
    stream = getattr(sys.stdin, 'buffer', None)
    raw = stream.read().decode('utf-8-sig', errors='replace') if stream is not None else sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    with contextlib.suppress(ImportError):
        from getzilla.state import bind_session
        bind_session(session_id(data))  # each session reads its own route (#80)
    return data


def emit(data: dict[str, Any]) -> None:
    text = json.dumps(data, ensure_ascii=False) + ('\n' if data else '')
    stream = getattr(sys.stdout, 'buffer', None)
    if stream is None:
        sys.stdout.write(text)
        return
    # UTF-8 bytes, as agents read them, whatever the console code page is.
    sys.stdout.flush()
    stream.write(text.encode('utf-8'))
    stream.flush()


def harness() -> str:
    """Name of the agent that launched this hook: grok unless the command passed --harness."""
    args = sys.argv[1:]
    if '--harness' in args:
        index = args.index('--harness')
        if index + 1 < len(args):
            return args[index + 1]
    return 'grok'


def permission_output(allowed: bool, reason: str | None = None) -> dict[str, Any]:
    """A PreToolUse verdict in the shape the launching agent validates.

    Grok Build accepts the combined legacy shape. Claude Code, Codex and Qwen Code
    reject a top-level ``decision`` of allow/deny, so they get only
    ``hookSpecificOutput`` on denial. Copilot CLI reads a top-level
    ``permissionDecision`` and Gemini CLI a top-level ``decision``. Every agent but
    Grok gets no output on allow, which keeps its own permission prompts in force.
    """
    verdict = 'allow' if allowed else 'deny'
    specific: dict[str, Any] = {'hookEventName': 'PreToolUse', 'permissionDecision': verdict}
    if not allowed:
        specific['permissionDecisionReason'] = reason or ''
    agent = harness()
    if agent == 'grok':
        data: dict[str, Any] = {'decision': verdict}
        if not allowed:
            data['reason'] = reason or ''
        data['hookSpecificOutput'] = specific
        return data
    if allowed:
        return {}
    if agent == 'copilot':
        return {'permissionDecision': 'deny', 'permissionDecisionReason': reason or ''}
    if agent == 'gemini':
        return {'decision': 'deny', 'reason': reason or ''}
    return {'hookSpecificOutput': specific}


def first(*values: Any) -> Any:
    for value in values:
        if value not in (None, ''):
            return value
    return None


def root_from(payload: dict[str, Any]) -> Path:
    cwd = first(payload.get('cwd'), payload.get('workspaceRoot'), payload.get('workspace_root'))
    return find_root(cwd)


_SESSION_ROOT_ALIASES = ('cwd', 'workspaceRoot', 'workspace_root')
_COMMAND_ROOT_ALIASES = ('workdir', 'cwd', 'working_directory', 'workingDirectory', 'directory')


@dataclass(frozen=True)
class RootContext:
    session_cwd: str | None
    session_root: Path | None
    command_workdirs: dict[str, str]
    effective_root: Path | None
    resolution_status: str

    @property
    def sensitive_safe(self) -> bool:
        return self.effective_root is not None and self.resolution_status in {'session-root', 'effective-root'}

    @property
    def has_ambiguous_command_evidence(self) -> bool:
        return any(value == '<ambiguous>' for value in self.command_workdirs.values())

    @property
    def ledger_root(self) -> Path | None:
        return self.effective_root or self.session_root


def _recognized_root(value: Path) -> Path | None:
    root = find_root(value.resolve())
    return root.resolve() if (root / '.getzilla').is_dir() else None


def _literal_xargs_command(words: list[str]) -> list[str] | None:
    index = 1
    while index < len(words):
        token = words[index]
        if token == '--':  # nosec B105
            return words[index + 1:]
        if token in {'-a', '--arg-file'}:
            if index + 1 >= len(words):
                return None
            index += 2
            continue
        if token.startswith('--arg-file='):
            index += 1
            continue
        if token.startswith('-'):
            return None
        return words[index:]
    return []


def _literal_git_subcommand(words: list[str]) -> str | None:
    index = 1
    while index < len(words):
        token = words[index]
        if token in {'-C', '-c', '--git-dir', '--work-tree'}:
            if index + 1 >= len(words):
                return None
            index += 2
            continue
        if token.startswith(('--git-dir=', '--work-tree=')):
            index += 1
            continue
        if token.startswith('-'):
            return None
        return token.lower()
    return None


def _contains_nested_command_shell(words: list[str]) -> bool:
    shells = _shells()
    return any(_executable_name(token) in shells for token in words)


def _has_unsafe_dispatcher_composition(words: list[str]) -> bool:
    if not words:
        return False
    shells = _shells()
    sensitive = {'git', 'gh', 'docker', 'npm', 'curl', 'wget'}
    outer = _executable_name(words[0])
    if outer == 'xargs':
        dispatched = _literal_xargs_command(words)
        if dispatched is None:
            return any(_executable_name(token) in sensitive | shells for token in words[1:])
        if not dispatched:
            return False
        dispatched, ambiguous_wrapper = _unwrap_execution_wrappers(dispatched)
        if ambiguous_wrapper:
            return True
        if not dispatched:
            return False
        executable = _executable_name(dispatched[0])
        if executable in shells:
            return True
        if executable == 'git':
            return _literal_git_subcommand(dispatched) != 'status'
        if executable in sensitive:
            return True
        if executable in {'echo', 'printf'}:
            return False
        if executable in {'env', 'sudo', 'doas', 'chroot', 'xargs'}:
            if any(_executable_name(token) in sensitive for token in dispatched[1:]):
                return True
        return _contains_nested_command_shell(dispatched[1:])
    if outer in sensitive | shells | {'cd', 'pushd', 'echo', 'printf'}:
        return False
    return _contains_nested_command_shell(words[1:])


def _lexical_program_path(value: str) -> str:
    """Normalize Linux path spelling without opening or resolving a program or its symlinks."""
    normalized = posixpath.normpath(value)
    # normpath preserves exactly two leading slashes; Linux treats these as the same root.
    return '/' + normalized.lstrip('/') if normalized.startswith('/') else normalized


def _opaque_program_file(value: str, cwds: tuple[str, ...] = ()) -> bool:
    """Stream/descriptor aliases are opaque even when written with lexical path variations."""
    if (value in {'', '-'} or '\0' in value
            or re.match(r'^[A-Za-z][A-Za-z0-9+.-]*://', value) is not None):
        return True
    paths = {_lexical_program_path(value)}
    if not value.startswith('/'):
        paths.update(_lexical_program_path(posixpath.join(base, value)) for base in cwds)
    return any(path == '/dev/stdin' or path.startswith('/dev/fd/')
               or re.match(r'^/proc/(?:self|thread-self|\d+)/(?:task/\d+/)?fd/', path) is not None
               for path in paths)


def _program_directory_candidates(commands: list[Any], cwd: str | None) -> tuple[str, ...] | None:
    """Conservative literal cwd candidates; never infer filesystem targets for program arguments."""
    bases = {_lexical_program_path(cwd)} if cwd is not None else set()
    for argv in commands:
        if not argv or not _is_directory_command(argv[0]):
            continue
        args = argv[1:]
        if args[:1] == ['--']:
            args = args[1:]
        if len(args) != 1 or args[0].startswith('-') or '\0' in args[0] or re.search(r'[$`*?\[\]{}()]', args[0]):
            return None
        directory = os.path.expanduser(args[0])
        if directory.startswith('/'):
            bases.add(_lexical_program_path(directory))
        elif not bases:
            return None
        else:
            # Nested shell cwd changes do not escape their shell. Retain earlier candidates
            # instead of guessing a flattened command's scope; any stream candidate is denied.
            bases.update(_lexical_program_path(posixpath.join(base, directory)) for base in tuple(bases))
        if len(bases) > 32:
            return None
    return tuple(sorted(bases))


def _python_program_is_inline(args: list[str], cwds: tuple[str, ...] = ()) -> bool:
    """Recognize the program selector; unknown options and implicit stdin fail closed."""
    index = 0
    diagnostic = False
    while index < len(args):
        arg = args[index]
        if arg == '--':
            return index + 1 >= len(args) or _opaque_program_file(args[index + 1], cwds)
        if arg == '-' or not arg.startswith('-'):
            return _opaque_program_file(arg, cwds)
        if arg in {'--help', '--help-env', '--help-xoptions', '--help-all', '--version'}:
            diagnostic = True
        elif arg.split('=', 1)[0] == '--check-hash-based-pycs':
            if '=' not in arg:
                index += 1
            if index >= len(args) or args[index].split('=', 1)[-1] not in {'always', 'default', 'never'}:
                return True
        elif arg.startswith('--'):
            return True
        else:
            flags = arg[1:]
            for position, flag in enumerate(flags):
                if flag in 'ci':
                    return True
                if flag == 'm':
                    module = flags[position + 1:] or (args[index + 1] if index + 1 < len(args) else '')
                    return not module or module.startswith('-') or _opaque_program_file(module, cwds)
                if flag in 'WX':
                    if position == len(flags) - 1:
                        index += 1
                        if index >= len(args):
                            return True
                    break
                if flag in 'h?V':
                    diagnostic = True
                elif flag not in 'bBdEIOPqRsSuvx':
                    return True
        index += 1
    return not diagnostic


def _php_program_is_inline(args: list[str], cwds: tuple[str, ...] = ()) -> bool:
    """PHP accepts attached/clustered selectors; only explicit files/server/diagnostics are inspectable."""
    index = 0
    program = server = diagnostic = False
    value_options = {'c', 'd', 'f', 'F', 'S', 't', 'z'}
    long_values = {'--php-ini': 'c', '--define': 'd', '--file': 'f', '--process-file': 'F',
                   '--server': 'S', '--docroot': 't', '--zend-extension': 'z',
                   '--rf': '?', '--rc': '?', '--re': '?', '--rz': '?', '--ri': '?'}
    while index < len(args):
        arg = args[index]
        if arg == '--':
            return not (program or server or diagnostic)
        if arg == '-' or not arg.startswith('-'):
            return False if program else _opaque_program_file(arg, cwds)
        if arg.startswith('--'):
            option, separator, attached = arg.partition('=')
            if option in {'--run', '--process-code', '--begin', '--end', '--interactive'}:
                return True
            if option in {'--help', '--info', '--modules', '--version', '--ini'}:
                diagnostic = True
                index += 1
                continue
            if option in {'--no-php-ini', '--syntax-check', '--syntax-highlight', '--strip', '--hide-args'}:
                index += 1
                continue
            flag = long_values.get(option)
            if flag is None:
                return True
            value = attached if separator else None
        else:
            flag = ''
            value = None
            for position, flag in enumerate(arg[1:]):
                if flag in 'arRBE':
                    return True
                if flag in value_options:
                    value = arg[position + 2:] or None
                    break
                if flag in 'himv?':
                    diagnostic = True
                elif flag not in 'nelHsw':
                    return True
            else:
                index += 1
                continue
        if value is None:
            index += 1
            if index >= len(args):
                return True
            value = args[index]
        if not value:
            return True
        if flag in {'f', 'F', 'z'} and _opaque_program_file(value, cwds):
            return True
        program = program or flag in {'f', 'F'}
        server = server or flag == 'S'
        diagnostic = diagnostic or flag == '?'
        index += 1
    return not (program or server or diagnostic)


def _without_redirection_operands(command: str, tokens: list[Any]) -> str | None:
    """Keep shell redirections out of argv, including adjacent numeric descriptor prefixes."""
    characters = list(command)
    for index, token in enumerate(tokens):
        if not token.operator or ('<' not in token.value and '>' not in token.value):
            continue
        if index + 1 >= len(tokens) or tokens[index + 1].operator:
            return None
        start = token.start
        if index and tokens[index - 1].end == start:
            previous = tokens[index - 1]
            if not previous.operator and command[previous.start:previous.end].isdigit():
                start = previous.start
        end = tokens[index + 1].end
        characters[start:end] = ' ' * (end - start)
    return ''.join(characters)


def _shell_word_is_opaque(raw: str, token: Any) -> bool:
    """Identify expansion without evaluating it; quoting/escaping keeps literal paths literal."""
    if token.expansion or raw.startswith('~'):
        return True
    assignment = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', raw) is not None
    quote = ''
    index = 0
    while index < len(raw):
        char = raw[index]
        if quote == "'":
            if char == "'":
                quote = ''
        elif char == '\\':
            index += 1
        elif quote:
            if char == quote:
                quote = ''
        elif char in {'"', "'"}:
            quote = char
        elif char in '*?[{':
            return True
        elif char == '~' and assignment and raw[index - 1:index] in {'=', ':'}:
            return True
        index += 1
    return False


def _opaque_shell_words(command: str) -> str:
    """Guard-only shadow: the argv selector, not an arbitrary data argument, decides opacity."""
    chunks: list[str] = []
    cursor = 0
    for token in _shell_tokens(command):
        if token.operator:
            continue
        raw = command[token.start:token.end]
        if _shell_word_is_opaque(raw, token):
            assignment = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', raw)
            marker = (assignment.group(0) if assignment else '') + '\0'
            chunks.extend((command[cursor:token.start], shlex.quote(marker)))
            cursor = token.end
    chunks.append(command[cursor:])
    return ''.join(chunks)


def _awk_programs(args: list[str]) -> list[str]:
    """Inline awk program texts; a program read with ``-f`` is a file, not inline text."""
    programs: list[str] = []
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in {'-e', '--source'}:
            programs.extend(args[index + 1:index + 2])
            index += 2
            continue
        if arg in {'-F', '-v', '-f', '--field-separator', '--assign', '--file'}:
            index += 2
            continue
        if arg == '--':
            programs.extend(args[index + 1:index + 2])
            break
        if arg.startswith('-') and len(arg) > 1:
            index += 1
            continue
        if not any(other in {'-f', '--file'} or other.startswith('-f') for other in args[:index]):
            programs.append(arg)
        break
    return programs


def _runs_inline_program(command: str, tokens: list[Any], *, depth: int = 0, cwd: str | None = None) -> bool:
    """Whether any simple command runs interpreter code given inline instead of as a file."""
    here_document = any(token.operator and token.value in _HERE_DOCUMENT_OPERATORS for token in tokens)
    argv_command = _without_redirection_operands(command, tokens)
    if argv_command is None or depth > 4:
        return True
    # The shared argv scanner discards quote provenance. Mark expanded words first;
    # NUL is impossible in an executable pathname and never leaves this guard-only text.
    commands = _simple_commands(argv_command)
    shadow = _opaque_shell_words(argv_command)
    shadow_commands = _simple_commands(shadow) if shadow != argv_command else commands
    cwds = _program_directory_candidates(shadow_commands, cwd)
    # Keep literal option recognition too (e.g. node --eval=$CODE, perl -e$CODE).
    if shadow != argv_command:
        commands = [*commands, *shadow_commands]
    for argv in commands:
        if not argv:
            continue
        if '\0' in argv[0]:
            return True
        # The shared scanner expands nested commands but drops their redirection operators.
        # Reinspect their original text before an input filename can masquerade as a program.
        for nested in _nested_commands(argv):
            if isinstance(nested, str):
                try:
                    if _runs_inline_program(nested, _shell_tokens(nested), depth=depth + 1, cwd=cwd):
                        return True
                except ValueError:
                    return True
        name, args = _executable_name(argv[0]), argv[1:]
        if _PYTHON_INTERPRETER.match(name):
            if here_document or cwds is None or _python_program_is_inline(args, cwds):
                return True
            continue
        if _PHP_INTERPRETER.match(name):
            if here_document or cwds is None or _php_program_is_inline(args, cwds):
                return True
            continue
        options = _INLINE_CODE_OPTIONS.get(name)
        if options is not None and (here_document or any(arg.split('=', 1)[0] in options for arg in args)):
            return True
        cluster = _INLINE_CODE_CLUSTERS.get(name)
        if cluster is not None and (here_document or any(
            arg.startswith('-') and not arg.startswith('--') and any(flag in cluster for flag in arg[1:])
            for arg in args
        )):
            return True
        if name == 'deno' and args[:1] == ['eval']:
            return True
        if name in _AWK_INTERPRETERS and any(_AWK_EXECUTION.search(program) for program in _awk_programs(args)):
            return True
    return False


_DYNAMIC_SHELL_WORDS = frozenset({'eval', 'source', '.'})
_PASS_THROUGH_WRAPPERS = frozenset({
    'sudo', 'doas', 'nohup', 'time', 'command', 'builtin', 'nice', 'ionice', 'timeout', 'stdbuf', 'exec',
    'xargs', 'env', 'setsid', 'chrt', 'flock', 'watch', 'unbuffer', 'parallel',
})
_EXEC_OPTIONS = frozenset({'-exec', '-execdir', '-ok', '-okdir'})


def _runs_dynamic_shell(tokens: list[Any]) -> bool:
    """eval/source/. at a command position (#80).

    For an ordinary program (`rg TODO .`, `find . -name x`) the words are data. A wrapper or
    `find -exec` can run its arguments as a command, so there every word still counts.
    """
    segment: list[str] = []
    skip_target = False
    for token in [*tokens, None]:
        if token is not None and token.operator and ('<' in token.value or '>' in token.value):
            skip_target = True
            continue
        if token is None or token.operator:
            words = list(segment)
            while words and re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', words[0]):
                words = words[1:]
            if words:
                if words[0] in _DYNAMIC_SHELL_WORDS:
                    return True
                if _executable_name(words[0]) in _PASS_THROUGH_WRAPPERS or _EXEC_OPTIONS & set(words):
                    if _DYNAMIC_SHELL_WORDS & set(words):
                        return True
            segment = []
            continue
        if skip_target:
            skip_target = False
            continue
        segment.append(token.value)
    return False


def _command_directory_aliases(command: str, *, depth: int = 0, cwd: str | None = None) -> dict[str, str]:
    aliases: dict[str, str] = {}
    try:
        tokens = _shell_tokens(command)
    except ValueError:
        return {'shell': '<ambiguous>'}
    if any(token.substitution for token in tokens):
        return {'command.dynamic-substitution': '<ambiguous>'}
    if _runs_inline_program(command, tokens, cwd=cwd):
        return {'command.inline-program': '<ambiguous>'}
    # ';' runs commands in sequence exactly like a newline; both keep root tracking linear.
    if any(token.operator and token.value not in {'&&', ';', '\n'} and '<' not in token.value and '>' not in token.value
           for token in tokens):
        return {'command.control-flow': '<ambiguous>'}
    words = [token.value for token in tokens]
    expects_command = True
    for token in tokens:
        word = token.value
        if token.operator:
            expects_command = True
            continue
        if not expects_command:
            continue
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', word):
            continue
        if token.expansion:
            return {'command.dynamic-position': '<ambiguous>'}
        expects_command = False
    if any(_is_directory_command(word) for word in words) and os.environ.get('CDPATH'):
        return {'command.cdpath-environment': '<ambiguous>'}
    if any(word.startswith('CDPATH=') and word != 'CDPATH=' for word in words):
        return {'command.cdpath-assignment': '<ambiguous>'}
    assignment_index = 0
    while words and re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', words[0]):
        name, value = words[0].split('=', 1)
        if name in {'GIT_DIR', 'GIT_WORK_TREE'}:
            aliases[f'command.env.{name}[{assignment_index}]'] = value
            assignment_index += 1
        words = words[1:]
    if words and _executable_name(words[0]) == 'env':
        aliases['command.env-wrapper'] = '<ambiguous>'
        return aliases
    if words and _executable_name(words[0]) in {'sudo', 'doas'}:
        if len(words) < 2 or words[1].startswith('-'):
            aliases['command.wrapper-options'] = '<ambiguous>'
            return aliases
        words = words[1:]
    words, ambiguous_wrapper = _unwrap_execution_wrappers(words)
    if ambiguous_wrapper:
        aliases['command.wrapper-options'] = '<ambiguous>'
        return aliases
    authority = analyze_command_authority(command)
    if authority.ambiguous or (authority.actions and not authority.context_proven):
        aliases['command.production-authority'] = '<ambiguous>'
        return aliases
    if _has_unsafe_dispatcher_composition(words):
        aliases['command.dispatcher-composition'] = '<ambiguous>'
        return aliases
    if _runs_dynamic_shell(tokens) or (
        fsx.WINDOWS and any(word.lower() in _WINDOWS_DYNAMIC_COMMANDS for word in words)
    ):
        aliases['command.dynamic-shell'] = '<ambiguous>'
        return aliases
    if words and words[0] == 'exec':
        aliases['command.exec-shell'] = '<ambiguous>'
        return aliases
    if words:
        executable = _executable_name(words[0])
        if executable in _POSIX_SHELLS:
            if depth > 0:
                aliases['command.nested-shell-depth'] = '<ambiguous>'
                return aliases
            if len(words) != 3 or words[1] not in {'-c', '-lc'}:
                aliases['command.shell-options'] = '<ambiguous>'
                return aliases
            aliases.update({
                f'shell.{key}': value
                for key, value in _command_directory_aliases(words[2], depth=depth + 1, cwd=cwd).items()
            })
            return aliases
    directory_index = git_index = git_invocations = 0
    for index, word in enumerate(words):
        assignment = re.match(r'^(GIT_DIR|GIT_WORK_TREE)=(.*)$', word)
        if assignment:
            aliases[f'command.env.{assignment.group(1)}[{assignment_index}]'] = assignment.group(2)
            assignment_index += 1
        if _is_directory_command(word):
            # Windows spellings share the cd/pushd alias keys that root resolution reads.
            kind = word if not fsx.WINDOWS else ('pushd' if word.lower() in {'pushd', 'push-location'} else 'cd')
            cursor = index + 1
            if fsx.WINDOWS and cursor < len(words) and words[cursor].lower() == '/d':
                cursor += 1  # cmd.exe `cd /d D:\path` also switches drive
            if cursor < len(words) and words[cursor] == '--':
                cursor += 1
            elif cursor < len(words) and words[cursor].startswith('-'):
                aliases[f'command.{kind}[{directory_index}]'] = '<ambiguous>'
                directory_index += 1
                continue
            if cursor >= len(words) or words[cursor] in {'&&', '||', ';', '|'}:
                aliases[f'command.{kind}[{directory_index}]'] = '<ambiguous>'
            else:
                aliases[f'command.{kind}[{directory_index}]'] = words[cursor]
            directory_index += 1
        if _is_git(word):
            git_invocations += 1
            cursor = index + 1
            while cursor < len(words):
                if words[cursor] == '-c':
                    if cursor + 1 >= len(words):
                        aliases[f'command.git-config[{git_index}]'] = '<ambiguous>'
                        break
                    if not re.fullmatch(r'protocol\.version=\d+', words[cursor + 1]):
                        aliases[f'command.git-config[{git_index}]'] = '<ambiguous>'
                        break
                    cursor += 2
                    continue
                if words[cursor] == '-C':
                    if cursor + 1 >= len(words):
                        aliases[f'command.git-C[{git_index}]'] = '<ambiguous>'
                        break
                    aliases[f'command.git-C[{git_index}]'] = words[cursor + 1]
                    git_index += 1
                    cursor += 2
                    continue
                if words[cursor] in {'--git-dir', '--work-tree'}:
                    if cursor + 1 >= len(words):
                        aliases[f'command.git-root[{git_index}]'] = '<ambiguous>'
                        break
                    aliases[f'command.git-root[{git_index}]'] = words[cursor + 1]
                    git_index += 1
                    cursor += 2
                    continue
                if words[cursor].startswith(('--git-dir=', '--work-tree=')):
                    aliases[f'command.git-root[{git_index}]'] = words[cursor].split('=', 1)[1]
                    git_index += 1
                    cursor += 1
                    continue
                break
    if git_invocations > 1 and any('.git-' in key for key in aliases):
        aliases['command.multiple-git-roots'] = '<ambiguous>'
    return aliases


def root_context(payload: dict[str, Any], input_data: dict[str, Any], tool: str) -> RootContext:
    try:
        return _root_context(payload, input_data, tool)
    except (OSError, RuntimeError, ValueError):
        session_cwd = next(
            (str(payload[key]) for key in _SESSION_ROOT_ALIASES if payload.get(key) not in (None, '')),
            None,
        )
        return RootContext(session_cwd, None, {}, None, 'root-resolution-error')


def _root_context(payload: dict[str, Any], input_data: dict[str, Any], tool: str) -> RootContext:
    session_values = {
        key: str(payload[key]) for key in _SESSION_ROOT_ALIASES if payload.get(key) not in (None, '')
    }
    session_cwd = next(iter(session_values.values()), None)
    session_paths: list[Path] = []
    session_roots: set[Path] = set()
    recognized_session_values = 0
    for raw in session_values.values():
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        path = path.resolve()
        session_paths.append(path)
        recognized = _recognized_root(path)
        if recognized is not None:
            session_roots.add(recognized)
            recognized_session_values += 1
    if session_values and recognized_session_values != len(session_values):
        return RootContext(session_cwd, None, {}, None, 'unrecognized-session-root')
    if len(session_roots) > 1 or (session_values and len(session_roots) != 1):
        return RootContext(session_cwd, None, {}, None, 'ambiguous-session-root')
    session_root = next(iter(session_roots), None)

    command_values = {
        key: str(input_data[key]) for key in _COMMAND_ROOT_ALIASES if input_data.get(key) not in (None, '')
    }
    command = input_data.get('command')
    if tool == 'Bash' and isinstance(command, str):
        # Resolve only the declared execution directory, as the root checks below already do.
        # Program arguments themselves receive lexical normalization and no filesystem access.
        inline_base = session_paths[0] if session_paths else Path.cwd()
        if command_values:
            declared = Path(next(iter(command_values.values()))).expanduser()
            inline_base = (declared if declared.is_absolute() else inline_base / declared).resolve()
        command_values.update(_command_directory_aliases(command, cwd=str(inline_base)))
    if not command_values:
        status = 'session-root' if session_root is not None else 'missing-root'
        return RootContext(session_cwd, session_root, {}, session_root, status)

    if '<ambiguous>' in command_values.values():
        return RootContext(session_cwd, session_root, command_values, None, 'ambiguous-command-root')
    base = session_paths[0] if session_paths else None
    shell_base = base
    git_base = base
    command_roots: set[Path] = set()
    declared_directories: set[Path] = set()
    for key, raw in command_values.items():
        if re.search(r'[$`*?\[\]{}()]', raw):
            return RootContext(session_cwd, session_root, command_values, None, 'ambiguous-command-root')
        try:
            path = Path(raw).expanduser()
        except (OSError, RuntimeError, ValueError):
            return RootContext(session_cwd, session_root, command_values, None, 'root-resolution-error')
        if not path.is_absolute():
            if '.git-C[' in key or '.git-root[' in key:
                resolution_base = git_base
            elif key.startswith(('command.', 'shell.')):
                resolution_base = shell_base
            else:
                resolution_base = base
            if resolution_base is None:
                return RootContext(session_cwd, session_root, command_values, None, 'unresolved-relative-root')
            path = resolution_base / path
        try:
            path = path.resolve()
        except (OSError, RuntimeError, ValueError):
            return RootContext(session_cwd, session_root, command_values, None, 'root-resolution-error')
        if '.cd[' in key or '.pushd[' in key:
            shell_base = path
            git_base = path
        elif '.git-C[' in key:
            git_base = path
        elif not key.startswith(('command.', 'shell.')):
            declared_directories.add(path)
            shell_base = path
            git_base = path
        recognized = _recognized_root(path)
        if recognized is None:
            return RootContext(session_cwd, session_root, command_values, None, 'unrecognized-command-root')
        command_roots.add(recognized)
    if len(declared_directories) > 1:
        return RootContext(session_cwd, session_root, command_values, None, 'ambiguous-command-root')
    if len(command_roots) != 1:
        return RootContext(session_cwd, session_root, command_values, None, 'ambiguous-command-root')
    effective_root = next(iter(command_roots))
    status = 'effective-root' if session_root in (None, effective_root) else 'cross-root'
    return RootContext(session_cwd, session_root, command_values, effective_root, status)


def session_id(payload: dict[str, Any]) -> str:
    return str(first(payload.get('session_id'), payload.get('sessionId'), 'manual'))


def prompt_text(payload: dict[str, Any]) -> str:
    return str(first(payload.get('prompt'), payload.get('userPrompt'), payload.get('user_prompt'), '') or '')


def tool_name(payload: dict[str, Any]) -> str:
    raw = str(first(payload.get('tool_name'), payload.get('toolName'), '') or '')
    return TOOL_ALIASES.get(raw, raw)


def tool_input(payload: dict[str, Any]) -> dict[str, Any]:
    value = payload.get('tool_input')
    if value is None:
        value = payload.get('toolInput')
    if value is None and isinstance(payload.get('toolArgs'), str):
        try:
            value = json.loads(payload['toolArgs'])
        except json.JSONDecodeError:
            value = {'command': payload['toolArgs']}
    elif value is None:
        value = payload.get('toolArgs')
    raw_tool = str(first(payload.get('tool_name'), payload.get('toolName'), ''))
    if not isinstance(value, dict):
        if raw_tool == 'exec_command':
            return {'_getzilla_input_error': 'exec_command requires a command object.'}
        return {}
    mapped = dict(value)
    mapped.pop('_getzilla_input_error', None)
    # Normalize only the known native contract. Validate without throwing into
    # the soft hook's outer fail-open handler; main emits this explicit denial.
    if raw_tool == 'exec_command':
        if 'cmd' in mapped:
            cmd = mapped['cmd']
            if not isinstance(cmd, str) or not cmd.strip():
                mapped['_getzilla_input_error'] = 'exec_command cmd must be a non-empty string.'
            elif 'command' in mapped:
                alias = mapped['command']
                if isinstance(alias, list) and alias and all(isinstance(part, str) for part in alias):
                    alias = shlex.join(alias)
                if not isinstance(alias, str) or alias != cmd:
                    mapped['_getzilla_input_error'] = 'exec_command cmd and command conflict.'
            mapped['command'] = cmd
        else:
            alias = mapped.get('command')
            valid = isinstance(alias, str) and bool(alias.strip())
            valid = valid or (isinstance(alias, list) and bool(alias)
                              and all(isinstance(part, str) for part in alias)
                              and any(part.strip() for part in alias))
            if not valid:
                mapped['_getzilla_input_error'] = 'exec_command requires cmd or a legacy command.'
    if 'command' not in mapped and str(first(payload.get('tool_name'), payload.get('toolName'), '')) == 'apply_patch':
        patch = first(mapped.get('patch'), mapped.get('input'))
        if isinstance(patch, str):
            mapped['command'] = patch
    command = mapped.get('command')
    if isinstance(command, list) and command and all(isinstance(part, str) for part in command):
        mapped['command'] = shlex.join(command)
    if 'subagent_type' in mapped and 'agent_type' not in mapped:
        mapped['agent_type'] = mapped['subagent_type']
    if 'agentType' in mapped and 'agent_type' not in mapped:
        mapped['agent_type'] = mapped['agentType']
    return mapped


def agent_id(payload: dict[str, Any]) -> str:
    return str(first(
        payload.get('agent_id'),
        payload.get('agentId'),
        payload.get('subagent_id'),
        payload.get('subagentId'),
        'unknown',
    ))


def agent_type(payload: dict[str, Any]) -> str:
    nested = tool_input(payload)
    return str(first(
        payload.get('agent_type'),
        payload.get('agentType'),
        payload.get('subagent_type'),
        payload.get('subagentType'),
        nested.get('agent_type'),
        nested.get('subagent_type'),
        'unknown',
    ))


def agent_generation(payload: dict[str, Any]) -> str | None:
    value = first(payload.get('generation'), payload.get('agent_generation'), payload.get('agentGeneration'))
    return str(value) if value is not None else None


def stop_hook_active(payload: dict[str, Any]) -> bool:
    return bool(first(payload.get('stop_hook_active'), payload.get('stopHookActive'), False))


_CHILD_KEYS = (
    'agent_id', 'agentId', 'subagent_id', 'subagentId',
    'agent_type', 'agentType', 'subagent_type', 'subagentType',
)
_CHILD_BRIEF = re.compile(r'^\s*You are \w+', re.IGNORECASE)


def is_child_payload(payload: dict[str, Any]) -> bool:
    if any(payload.get(key) not in (None, '') for key in _CHILD_KEYS):
        return True
    return bool(_CHILD_BRIEF.match(prompt_text(payload)))
