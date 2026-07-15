#!/usr/bin/env python3
"""Create/sign an upgrade bundle for the Upgrades settings section.

Usage:
  python scripts/sign_bundle.py path/to/bundle.tar.gz            # sign existing archive
  python scripts/sign_bundle.py --pack backend VERSION CHANGELOG.md -o bundle.tar.gz

The signing key comes from $UPGRADE_SIGNING_KEY (must match the server).
Upload the archive together with the printed hex signature.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import os
import sys
import tarfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="archive to sign, or paths to pack with --pack")
    parser.add_argument("--pack", action="store_true", help="pack the given paths into a new .tar.gz first")
    parser.add_argument("-o", "--output", default="bundle.tar.gz", help="output archive when using --pack")
    args = parser.parse_args()

    key = os.environ.get("UPGRADE_SIGNING_KEY")
    if not key:
        print("error: set UPGRADE_SIGNING_KEY (must match the server)", file=sys.stderr)
        return 2

    if args.pack:
        with tarfile.open(args.output, "w:gz") as tar:
            for path in args.paths:
                tar.add(path)
        archive = args.output
        print(f"packed: {archive}")
    else:
        archive = args.paths[0]

    data = open(archive, "rb").read()
    signature = hmac.new(key.encode(), data, hashlib.sha256).hexdigest()
    print(f"bundle:    {archive}")
    print(f"sha256:    {hashlib.sha256(data).hexdigest()}")
    print(f"signature: {signature}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
