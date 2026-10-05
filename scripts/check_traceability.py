#!/usr/bin/env python3
"""Checks docs/traceability.csv: every P0 requirement must name at least one test, every named test must exist,
and every P0 row must have status "pass". Prints the P0 coverage and exits non-zero on any failure.

Test id forms (the part before ':' says where to look):
  pgtap:<file>#<text>      the text must appear in the pgTAP file (a test description)
  pytest:<file>::<name>    the file must define a test function <name>
  e2e:/k6:/script:/doc:/ci:/lighthouse:<file>   the file must exist
  make:<file>#<target>     the Makefile must define the target
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE_ONLY = {"e2e", "k6", "script", "doc", "ci", "lighthouse"}


def resolve(test_id: str) -> str | None:
    """Returns None when the test exists, otherwise a message saying what is wrong."""
    kind, _, rest = test_id.partition(":")
    if kind == "pgtap":
        path, _, text = rest.partition("#")
        target = ROOT / path
        if not target.is_file():
            return f"{path} does not exist"
        return None if text in target.read_text() else f'"{text}" not found in {path}'
    if kind == "pytest":
        path, _, name = rest.partition("::")
        target = ROOT / path
        if not target.is_file():
            return f"{path} does not exist"
        return None if re.search(rf"def {re.escape(name)}\(", target.read_text()) else f"{name} is not defined in {path}"
    if kind == "make":
        path, _, name = rest.partition("#")
        target = ROOT / path
        if not target.is_file():
            return f"{path} does not exist"
        return None if re.search(rf"^{re.escape(name)}:", target.read_text(), re.M) else f"target {name} not in {path}"
    if kind in FILE_ONLY:
        return None if (ROOT / rest).is_file() else f"{rest} does not exist"
    return f"unknown test id form: {test_id}"


def main() -> int:
    rows = list(csv.DictReader((ROOT / "docs" / "traceability.csv").open(newline="")))
    problems: list[str] = []
    p0_total = p0_covered = 0
    for row in rows:
        rid, priority, status = row["requirement_id"], row["priority"], row["status"]
        tests = [t for t in row["test_ids"].split(";") if t]
        broken = [f"{rid}: {msg}" for t in tests if (msg := resolve(t))]
        problems += broken
        if priority == "P0":
            p0_total += 1
            if not tests:
                problems.append(f"{rid}: P0 requirement has no test")
            elif status != "pass":
                problems.append(f'{rid}: P0 requirement has status "{status}", not "pass"')
            elif not broken:
                p0_covered += 1
        elif status == "pass" and not tests:
            problems.append(f"{rid}: marked pass but names no test")
    coverage = 100 * p0_covered / p0_total if p0_total else 0
    other = [r for r in rows if r["priority"] != "P0" and r["status"] != "pass"]
    for p in problems:
        print("FAIL", p)
    print(f"P0 coverage {coverage:.0f}% ({p0_covered} of {p0_total} requirements with a passing, existing test)")
    for r in other:
        print(f"note: {r['requirement_id']} ({r['priority']}) {r['status']}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
