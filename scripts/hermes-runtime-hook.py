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
# Fix: strip inherited CA-related env vars so libraries fall back to
# `certifi.where()`, then re-point them at the *current* bundled
# cacert.pem. Applied at the earliest possible moment (before Hermes
# imports anything).

import os

_CA_ENV_VARS = (
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
)

for _var in _CA_ENV_VARS:
    os.environ.pop(_var, None)

try:
    import certifi

    _cacert = certifi.where()
    if _cacert and os.path.isfile(_cacert):
        os.environ["SSL_CERT_FILE"] = _cacert
        os.environ["REQUESTS_CA_BUNDLE"] = _cacert
        os.environ["CURL_CA_BUNDLE"] = _cacert
except Exception:
    pass
