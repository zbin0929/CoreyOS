#!/usr/bin/env python3
"""Patch Hermes ssl_guard.py to auto-heal stale CA bundle paths.

Problem: agent.ssl_guard.verify_ca_bundle() raises SSLConfigurationError
when SSL_CERT_FILE / REQUESTS_CA_BUNDLE points at a deleted PyInstaller
`_MEI*` temp dir.  The gateway's own _ensure_ssl_certs() already handles
this by popping stale vars, but verify_ca_bundle() (called later during
agent init) does NOT — it validates first, crashes second.

This patch inserts an auto-heal loop BEFORE the validation loop in
verify_ca_bundle(), mirroring the same "pop if path missing" logic that
_ensure_ssl_certs already uses.

Idempotent: safe to run multiple times (checks for marker comment).
"""
from __future__ import annotations

import sys
from pathlib import Path

MARKER = "# corey-patched: stale CA auto-heal"

AUTOHEAL_SNIPPET = (
    "    # Auto-heal: remove stale CA bundle env vars that point at deleted\n"
    "    # paths (common with PyInstaller _MEI* temp dirs from prior runs).\n"
    "    " + MARKER + "\n"
    "    for env_var in _CA_BUNDLE_ENV_VARS:\n"
    "        value = os.getenv(env_var)\n"
    "        if value:\n"
    "            path = Path(value).expanduser()\n"
    "            if not path.exists():\n"
    "                logger.warning(\n"
    '                    "Ignoring stale %s=%r (path does not exist)",\n'
    "                    env_var, value,\n"
    "                )\n"
    "                os.environ.pop(env_var, None)\n"
    "\n"
)


def find_ssl_guard() -> Path | None:
    try:
        import agent.ssl_guard as sg
        return Path(sg.__file__)
    except Exception:
        return None


def patch_file(path: Path) -> bool:
    src = path.read_text(encoding="utf-8")
    if MARKER in src:
        print(f"skip (already patched): {path}")
        return False

    anchor = "    for env_var in _CA_BUNDLE_ENV_VARS:\n        value = os.getenv(env_var)\n        if value:\n            _validate_bundle_path(env_var, value)"
    if anchor not in src:
        print(f"ERROR: cannot find anchor in {path}")
        print("Hermes ssl_guard.py may have been restructured. Manual review needed.")
        return False

    patched = src.replace(anchor, AUTOHEAL_SNIPPET + anchor, 1)
    path.write_text(patched, encoding="utf-8")
    print(f"patched: {path}")
    return True


def main() -> int:
    path = find_ssl_guard()
    if path is None or not path.exists():
        print("ERROR: agent.ssl_guard not found. Is hermes-agent installed?")
        return 1

    print(f"ssl_guard.py: {path}")
    changed = patch_file(path)
    return 0 if changed or MARKER in path.read_text() else 1


if __name__ == "__main__":
    sys.exit(main())
