#!/usr/bin/env python3
"""Verify the reviewed SQL bytes. This program never connects to a database."""

import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", action="store_true", help="print verified migration paths in install order")
    parser.add_argument("--include-base", action="store_true", help="also list the base schema; disposable empty databases only")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / "backend/release-manifest.json").read_text())
    if manifest.get("formatVersion") != 1:
        raise SystemExit("Unsupported backend manifest format")
    all_entries = [manifest["baseSchema"], *manifest["migrations"]]
    seen = set()
    for entry in all_entries:
        relative = entry["path"]
        path = (root / relative).resolve()
        if path == root or root not in path.parents or relative in seen or path.suffix != ".sql":
            raise SystemExit(f"Invalid or duplicate manifest path: {relative}")
        seen.add(relative)
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != entry["sha256"]:
            raise SystemExit(f"SQL differs from reviewed release: {relative}")
    # Verify every entry before emitting anything that a caller might execute.
    if args.paths:
        entries = all_entries if args.include_base else manifest["migrations"]
        print("\n".join(entry["path"] for entry in entries))
    else:
        print(f"Verified base schema and {len(manifest['migrations'])} ordered migrations.")


if __name__ == "__main__":
    main()
