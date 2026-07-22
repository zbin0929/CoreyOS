# PyInstaller runtime hook for hermes-standalone.
#
# Runs before any Hermes business code imports. PyInstaller onefile
# binaries extract their resources to a per-process `_MEIxxxxxx` temp
# dir; `certifi.where()` resolves against that dir at runtime.
#
# Problem: if the parent process (Corey/Tauri, a prior Hermes run, a
# user's shell) leaves `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` /
# `CURL_CA_BUNDLE` pointing at an ALREADY-DELETED `_MEI*` path, OpenAI
# SDK + httpx read those env vars verbatim and fail at init with:
#
#   Upstream error 500: Failed to initialize OpenAI client:
#   SSL_CERT_FILE points to a missing CA bundle:
#   /var/folders/.../T/_MEIVOXEuW/certifi/cacert.pem
#
# Fix: strip inherited CA-related env vars, then re-point them at a
# *persistent* copy of the bundled cacert.pem under HERMES_HOME — NOT at
# `certifi.where()` directly. `certifi.where()` lives inside the current
# `_MEI*` temp dir, which the OS can delete out from under a long-running
# gateway (macOS cleans stale /var/folders items; Windows temp cleaners
# do the same), re-introducing the exact "missing CA bundle" 500. Copying
# the bundle to HERMES_HOME/ca/cacert.pem makes the path immune to temp-dir
# cleanup and safe to inherit by child processes that outlive this _MEI.
# Applied at the earliest possible moment (before Hermes imports anything).

import os
import shutil
from pathlib import Path

_CA_ENV_VARS = (
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
)

for _var in _CA_ENV_VARS:
    os.environ.pop(_var, None)


def _persistent_ca_bundle(src):
    """Copy the freshly-extracted cacert.pem to a stable HERMES_HOME path.

    Returns the persistent path on success, or the original temp `src` if
    persisting fails. Never raises.
    """
    home = os.environ.get("HERMES_HOME")
    base = Path(home) if home else (Path.home() / ".hermes")
    dst = base / "ca" / "cacert.pem"
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        # Refresh when missing or when the bundled version changed size
        # (cheap proxy for "new binary shipped a newer certifi"). Write via
        # a per-pid temp file + atomic replace so a concurrently-starting
        # process never reads a half-written bundle.
        if (not dst.is_file()) or dst.stat().st_size != os.stat(src).st_size:
            tmp = dst.with_suffix(".pem.%d.tmp" % os.getpid())
            shutil.copyfile(src, tmp)
            os.replace(tmp, dst)
        if dst.is_file():
            return str(dst)
    except Exception:
        pass
    return src


try:
    import certifi

    _cacert = certifi.where()
    if _cacert and os.path.isfile(_cacert):
        _cacert = _persistent_ca_bundle(_cacert)
        os.environ["SSL_CERT_FILE"] = _cacert
        os.environ["REQUESTS_CA_BUNDLE"] = _cacert
        os.environ["CURL_CA_BUNDLE"] = _cacert
except Exception:
    pass
