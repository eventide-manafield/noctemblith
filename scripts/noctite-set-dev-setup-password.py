#!/usr/bin/env python3
"""Set a private Noctite initial-admin password without echoing or storing it in shell history.

Run only on the administrator-controlled host:
    sudo python3 scripts/noctite-set-dev-setup-password.py .config/default.yml

This is for the isolated development instance BEFORE public ingress.
It does not create a Noctite user, run Docker, or expose the service.
"""
import getpass
import json
import os
import pathlib
import subprocess
import sys


def main() -> int:
    if os.geteuid() != 0:
        print("Run as root from an operator-owned terminal (sudo).", file=sys.stderr)
        return 1
    if len(sys.argv) != 2:
        print("Usage: sudo python3 scripts/noctite-set-dev-setup-password.py .config/default.yml", file=sys.stderr)
        return 2

    path = pathlib.Path(sys.argv[1])
    if path.name != "default.yml" or path.parent.name != ".config" or not path.is_file() or path.is_symlink():
        print("Refusing to alter a non-Noctite configuration file.", file=sys.stderr)
        return 2

    current = path.read_text(encoding="utf-8")
    if any(line.strip().startswith("setupPassword:") for line in current.splitlines()):
        print("setupPassword is already configured. No change made.")
        return 0
    if "id: aidx" not in current or "url: https://noctite-dev.manafield.studio/" not in current:
        print("Expected the reviewed dev URL and id: aidx before configuring the setup password.", file=sys.stderr)
        return 2

    first = getpass.getpass("Noctite dev INITIAL ADMIN setup password (minimum 20 characters): ")
    second = getpass.getpass("Repeat the setup password: ")
    if first != second or len(first) < 20 or not first.isprintable():
        print("Passwords differ, are too short, or contain non-printable characters. No change made.", file=sys.stderr)
        return 2

    # Restrict local readability BEFORE writing the secret to the file.
    os.chown(path, 0, 0)
    os.chmod(path, 0o600)
    with path.open("a", encoding="utf-8") as config:
        config.write("\n# Required to prevent unauthenticated first-admin takeover.\n")
        config.write("setupPassword: " + json.dumps(first, ensure_ascii=True) + "\n")

    # The official Noctite Docker runtime runs as uid 991 and mounts this file
    # read-only. Grant only that UID read permission; nobody else gains access.
    subprocess.run(["setfacl", "-m", "u:991:r--", str(path)], check=True)
    print("Setup password stored privately; its value was not displayed.")
    print("Restart ONLY the Noctite app before enabling a public ingress route.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
