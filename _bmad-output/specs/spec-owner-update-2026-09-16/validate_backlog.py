#!/usr/bin/env python3
"""Validate the owner-spec package without dependencies or provider access."""

import argparse
import hashlib
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--artifact-root", default=None)
    args = parser.parse_args()
    repo = Path(args.repo_root).resolve()
    artifact = Path(args.artifact_root).resolve() if args.artifact_root else repo

    def exists(path):
        return (repo / path).exists() or (artifact / path).exists()

    spec = Path(__file__).resolve().parent

    def read(p):
        return json.loads(p.read_text(encoding="utf-8-sig"))

    requirements = read(spec / "requirements.json")
    backlog = read(spec / "backlog.json")
    extraction = read(spec / "source-claims.json")
    manifest = read(artifact / "docs/source/ii-tonya-owner-2026-09-16-manifest.json")
    line_map = read(spec / "source-line-map.json")
    details = read(spec / "source-details.json")
    errors = []
    reqs = {r["id"]: r for r in requirements}
    items = {i["id"]: i for r in requirements for i in r["items"]}
    tasks = {t["id"]: t for t in backlog["tasks"]}
    decisions = {d["id"]: d for d in backlog["decisions"]}
    claims = {c["id"]: c for c in extraction["claims"]}
    if len(reqs) != len(requirements):
        errors.append("duplicate requirement IDs")
    if len(items) != sum(len(r["items"]) for r in requirements):
        errors.append("duplicate item IDs")
    if len(tasks) != len(backlog["tasks"]):
        errors.append("duplicate task IDs")
    if len(decisions) != len(backlog["decisions"]):
        errors.append("duplicate decision IDs")
    covered_items = set()
    covered_claims = set()
    item_claims = set()
    for req in requirements:
        if not req["items"]:
            errors.append(f"empty requirement {req['id']}")
        for cid in req["source_claim_ids"]:
            if cid not in claims:
                errors.append(f"unknown claim {cid}")
            covered_claims.add(cid)
        for item in req["items"]:
            if not item["text"] or not item["acceptance"] or not item["source_claim_ids"]:
                errors.append(f"incomplete item {item['id']}")
            for cid in item["source_claim_ids"]:
                item_claims.add(cid)
                if cid not in claims:
                    errors.append(f"unknown item source {cid}")
    alias_ids = {x["removed_claim"] for x in extraction["duplicate_aliases"]}
    if set(claims) - covered_claims - alias_ids:
        errors.append("unmapped claims " + str(sorted(set(claims) - covered_claims - alias_ids)))
    if set(claims) - item_claims - alias_ids:
        errors.append("claims without item trace " + str(sorted(set(claims) - item_claims - alias_ids)))
    for t in tasks.values():
        for iid in t.get("item_ids", []):
            if iid not in items:
                errors.append(f"{t['id']} unknown item {iid}")
            covered_items.add(iid)
        for rid in t["requirement_ids"]:
            if rid not in reqs:
                errors.append(f"{t['id']} unknown requirement {rid}")
        for dependency in t["depends_on"]:
            if dependency not in tasks:
                errors.append(f"{t['id']} unknown dependency {dependency}")
        for did in t["decision_ids"]:
            if did not in decisions:
                errors.append(f"{t['id']} unknown decision {did}")
        if not t["deliverables"] or not t["steps"] or not t["acceptance"]:
            errors.append(f"incomplete task {t['id']}")
        for field in ("inspect", "modify"):
            for path in t["files"].get(field, []):
                if not exists(path):
                    errors.append(f"missing {field}: {t['id']} {path}")
        for path in t["files"].get("tests", []):
            if not exists(path) and path not in t["files"].get("create", []):
                errors.append(f"test not existing or declared create: {t['id']} {path}")
        if not (spec / "tasks" / f"{t['id']}.md").is_file():
            errors.append(f"missing task card {t['id']}")
    if set(items) - covered_items:
        errors.append("uncovered items " + str(sorted(set(items) - covered_items)))
    for d in decisions.values():
        if not d["question"] or len(d["options"]) < 2:
            errors.append(f"incomplete decision {d['id']}")
        for tid in d["blocks"]:
            if tid not in tasks:
                errors.append(f"unknown blocked task {tid}")
        for cid in d["source_claim_ids"]:
            if cid not in claims:
                errors.append(f"unknown decision source {cid}")
    visiting = set()
    visited = set()

    def visit(tid):
        if tid in visiting:
            errors.append("dependency cycle at " + tid)
            return
        if tid in visited or tid not in tasks:
            return
        visiting.add(tid)
        for dep in tasks[tid]["depends_on"]:
            visit(dep)
        visiting.remove(tid)
        visited.add(tid)

    for tid in tasks:
        visit(tid)

    def ancestors(tid, seen=None):
        seen = set() if seen is None else seen
        for dep in tasks.get(tid, {}).get("depends_on", []):
            if dep in tasks and dep not in seen:
                seen.add(dep)
                ancestors(dep, seen)
        return seen

    for t in tasks.values():
        available = {p for dep in ancestors(t["id"]) for p in tasks[dep]["files"].get("create", [])}
        for p in t["files"].get("future_inputs", []):
            if p not in available:
                errors.append("future input not produced by a dependency: " + t["id"] + " " + p)

    def normalize(s):
        return re.sub(r"^\s*\d+[.)]\s*", "", re.sub(r"\s+", " ", s)).strip().casefold()

    raw_details = {
        normalize(x.get("text", "") if isinstance(x, dict) else x)
        for c in claims.values()
        for x in ([c["details"]] if isinstance(c.get("details"), str) else c.get("details", []))
    }
    found_details = {normalize(x["text"]) for x in details}
    if raw_details - found_details:
        errors.append("missing source detail entries")
    if len(found_details) != len(details):
        errors.append("duplicate detail text")
    for detail in details:
        if detail["primary_task_id"] not in tasks:
            errors.append("detail lacks task " + detail["id"])
        elif detail["id"] not in tasks[detail["primary_task_id"]]["detail_ids"]:
            errors.append("detail task mismatch " + detail["id"])
        if not detail["item_ids"]:
            errors.append("detail lacks canonical item " + detail["id"])
    for source in manifest["snapshots"]:
        p = artifact / source["path"]
        if not p.is_file():
            errors.append("missing source " + str(p))
            continue
        raw = p.read_bytes()
        if hashlib.sha256(raw).hexdigest() != source["snapshot_sha256"]:
            errors.append("source digest " + str(p))
        lines = raw.decode("utf-8-sig").split("\n")
        mapped = {row["line"]: row for row in line_map[source["id"]]}
        for n, line in enumerate(lines, 1):
            if not line.strip():
                continue
            row = mapped.get(n)
            if row is None:
                errors.append(f"source gap {source['id']}:{n}")
                continue
            if not row["claim_ids"] and not row["non_requirement_reasons"]:
                errors.append(f"unclassified line {source['id']}:{n}")
            if row["claim_ids"] and not row["item_ids"]:
                errors.append(f"no item trace {source['id']}:{n}")
            for iid in row["item_ids"]:
                if iid not in items:
                    errors.append("unknown line-map item " + iid)
    result = {
        "ok": not errors,
        "requirements": len(reqs),
        "atomic_items": len(items),
        "catalog_details": len(details),
        "tasks": len(tasks),
        "decisions": len(decisions),
        "source_claims": len(claims),
        "classified_nonempty_source_lines": sum(map(len, line_map.values())),
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
