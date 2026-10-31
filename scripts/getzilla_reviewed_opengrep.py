"""Classify exact independently reviewed observations while retaining raw evidence.

This is a source-bound triage adapter, not authenticated human approval. It is
not installed in CI until independently reviewed and explicitly wired there.
"""

from copy import deepcopy
from dataclasses import asdict, is_dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types
import secrets

MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_ENTRIES = 128
CATEGORIES = {
    "getzilla.sast.rules.getzilla.javascript.reflected-xss": "json-or-cli-output",
    "getzilla.sast.rules.getzilla.javascript.command-injection": "regex-exec",
    "getzilla.sast.rules.getzilla.javascript.sql-injection": ("parameterized-sql", "domain-command-execute"),
    "getzilla.sast.rules.getzilla.python.unsafe-deserialization": "ruamel-roundtrip",
    "getzilla.sast.rules.getzilla.javascript.ssrf": "operator-health-fetch",
}


class ReviewError(ValueError):
    pass


def _read(root, relative, limit):
    if not isinstance(relative, str) or not relative or relative.startswith("/") or "\\" in relative:
        raise ReviewError("invalid relative path")
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ReviewError("noncanonical path")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        child = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            info = os.fstat(child)
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise ReviewError("invalid file")
            chunks = []
            length = 0
            while True:
                chunk = os.read(child, min(65536, limit + 1 - length))
                if not chunk:
                    break
                chunks.append(chunk)
                length += len(chunk)
                if length > limit:
                    raise ReviewError("file too large")
            return b"".join(chunks)
        finally:
            os.close(child)
    except OSError as exc:
        raise ReviewError("file inaccessible") from exc
    finally:
        os.close(fd)


def _unique(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ReviewError("duplicate JSON key")
        out[key] = value
    return out


def classify(result, root, config_path):
    """Return a classified copy; the original status, messages and output remain intact."""
    root = Path(root).absolute()
    try:
        relative = Path(config_path).absolute().relative_to(root).as_posix()
        config = json.loads(_read(root, relative, MAX_FILE), object_pairs_hook=_unique)
    except (OSError, ValueError, UnicodeError) as exc:
        raise ReviewError("invalid review configuration") from exc
    if (
        not isinstance(config, dict)
        or set(config) != {"version", "entries"}
        or type(config["version"]) is not int
        or config["version"] != 1
        or not isinstance(config["entries"], list)
        or len(config["entries"]) > MAX_ENTRIES
    ):
        raise ReviewError("invalid review configuration")
    clean = (
        result.name == "opengrep"
        and result.status == "pass"
        and result.summary == "no taint findings from Getzilla OpenGrep rules"
        and result.details == []
        and not result.stderr
    )
    records = {}
    hashes = {}
    total = 0
    for item in config["entries"]:
        if not isinstance(item, dict) or set(item) != {"rule", "path", "line", "sha256", "category", "evidence"}:
            raise ReviewError("invalid record")
        rule, path, line = item["rule"], item["path"], item["line"]
        if (
            not all(isinstance(x, str) for x in (rule, path, line, item["sha256"], item["category"], item["evidence"]))
            or rule not in CATEGORIES
            or (
                item["category"] not in CATEGORIES[rule]
                if isinstance(CATEGORIES[rule], tuple)
                else item["category"] != CATEGORIES[rule]
            )
            or not re.fullmatch(r"[1-9][0-9]*", line)
            or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
            or not re.fullmatch(r"docs/operations/[a-zA-Z0-9._/-]+\.md", item["evidence"])
            or ".." in item["evidence"].split("/")
        ):
            raise ReviewError("invalid record")
        if not path or path.startswith("/") or "\\" in path or any(part in ("", ".", "..") for part in path.split("/")):
            raise ReviewError("noncanonical path")
        key = (rule, path, line)
        if key in records:
            raise ReviewError("duplicate record")
        if clean:
            records[key] = item
            continue
        if path not in hashes:
            data = _read(root, path, MAX_FILE)
            total += len(data)
            if total > MAX_TOTAL:
                raise ReviewError("source limit exceeded")
            hashes[path] = hashlib.sha256(data).hexdigest()
        if hashes[path] != item["sha256"]:
            raise ReviewError("stale source")
        records[key] = item
    if clean:
        return deepcopy(result)
    if result.name != "opengrep" or result.status != "fail" or result.stderr or not isinstance(result.details, list):
        raise ReviewError("tool unavailable or noncanonical result")
    match = re.fullmatch(r"([1-9][0-9]*) taint findings from Getzilla OpenGrep rules", result.summary)
    if not match or int(match.group(1)) != len(result.details):
        raise ReviewError("incomplete tool result")
    annotated = deepcopy(result)
    seen = set()
    for detail in annotated.details:
        if (
            not isinstance(detail, dict)
            or set(detail) != {"rule", "path", "line", "severity", "message"}
            or not all(isinstance(detail[k], str) for k in detail)
        ):
            raise ReviewError("noncanonical finding")
        key = (detail["rule"], detail["path"], detail["line"])
        if key in seen or key not in records:
            raise ReviewError("unknown or duplicate finding")
        seen.add(key)
        detail["effective_severity"] = "INFO"
        detail["review"] = deepcopy(records[key])
    if seen != set(records):
        raise ReviewError("review set differs from findings")
    annotated.status = "pass"
    annotated.summary = f"{len(seen)} reviewed observations; raw scanner status=fail; 0 unresolved"
    return annotated


def _retain_evidence(root, result, raw, config_path):
    """Store the original engine result and provider output in ignored local state."""
    try:
        relative = Path(config_path).absolute().relative_to(Path(root).absolute()).as_posix()
        config_sha = hashlib.sha256(_read(root, relative, MAX_FILE)).hexdigest()
    except (OSError, ValueError):
        config_sha = None
    if not is_dataclass(result):
        raise ReviewError("noncanonical engine result")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        child = os.open(".getzilla", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
        os.close(directory)
        directory = child
        try:
            os.mkdir("runtime", mode=0o700, dir_fd=directory)
        except FileExistsError:
            pass
        child = os.open("runtime", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
        os.close(directory)
        directory = child
        filename = "opengrep-review-" + secrets.token_hex(16) + ".json"
        fd = os.open(filename, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        try:
            data = json.dumps(
                {
                    "review_config_sha256": config_sha,
                    "engine_result": asdict(result),
                    "returncode": raw.returncode,
                    "raw_stdout": raw.stdout,
                    "raw_stderr": raw.stderr,
                },
                ensure_ascii=True,
            ).encode("utf8")
            while data:
                count = os.write(fd, data)
                if count <= 0:
                    raise OSError("evidence write failed")
                data = data[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(directory)
    except OSError as exc:
        raise ReviewError("could not retain scan evidence") from exc
    finally:
        os.close(directory)


def install_reviewed_opengrep(verification, version, config_path):
    """Install only on the pinned engine; retain and validate actual scan JSON."""
    if version != "2.3.1":
        raise ReviewError("unsupported Getzilla version")
    original = verification._opengrep
    if not isinstance(original, types.FunctionType):
        raise ReviewError("unsupported OpenGrep adapter")

    def checked(root):
        captured = []
        engine_run = original.__globals__["run"]

        def capture(args, **kwargs):
            result = engine_run(args, **kwargs)
            captured.append(result)
            return result

        namespace = dict(original.__globals__, run=capture)
        isolated = types.FunctionType(
            original.__code__, namespace, original.__name__, original.__defaults__, original.__closure__
        )
        result = isolated(root)
        if len(captured) != 1:
            raise ReviewError("missing scan output")
        raw = captured[0]
        if (
            not isinstance(raw.stdout, str)
            or not isinstance(raw.stderr, str)
            or len(raw.stdout.encode("utf8")) > MAX_TOTAL
            or len(raw.stderr.encode("utf8")) > MAX_FILE
        ):
            raise ReviewError("scan output too large or invalid")
        _retain_evidence(root, result, raw, config_path)
        if raw.returncode not in (0, 1):
            raise ReviewError("scan failed")
        try:
            report = json.loads(raw.stdout, object_pairs_hook=_unique)
        except (ValueError, TypeError) as exc:
            raise ReviewError("invalid scan JSON") from exc
        if (
            not isinstance(report, dict)
            or not isinstance(report.get("results"), list)
            or not isinstance(report.get("errors"), list)
            or report["errors"]
        ):
            raise ReviewError("scan reported errors")
        try:
            normalized = [
                {
                    "rule": str(x.get("check_id", "")),
                    "path": str(x.get("path", "")),
                    "line": str((x.get("start") or {}).get("line", "")),
                    "severity": str((x.get("extra") or {}).get("severity", "")),
                    "message": str((x.get("extra") or {}).get("message", ""))[:300],
                }
                for x in report["results"]
            ]
        except (AttributeError, TypeError) as exc:
            raise ReviewError("invalid scan finding") from exc
        if normalized != result.details or result.stdout or result.stderr:
            raise ReviewError("scan and engine result mismatch")
        annotated = classify(result, root, config_path)
        annotated.stdout = raw.stdout
        annotated.stderr = raw.stderr
        return annotated

    verification._opengrep = checked
