#!/usr/bin/env python3
"""Corey's file-ops guard — pre_tool_call hook that blocks destructive
operations against user-sovereign paths that Hermes' own
DANGEROUS_PATTERNS layer doesn't catch.

Wired into ``~/.hermes/config.yaml`` as:

    hooks:
      pre_tool_call:
        - command: "~/.hermes/corey-guards/file-ops-guard.py"
          timeout: 30
    hooks_auto_accept: true

Hermes pipes JSON on stdin describing the about-to-fire tool call; we
emit ``{"decision":"block","reason":"..."}`` on stdout to veto, or
``{}`` to allow (see ``agent/shell_hooks.py`` wire-protocol doc).

Attack surfaces we gate (expanded after the 2026-05-11 test escape):

1. **Structured file-ops** (``delete_file`` / ``move_file`` /
   ``write_file`` / ``edit_file`` / Hermes's ``file`` tool) — these
   BYPASS the shell DANGEROUS_PATTERNS layer entirely. They take a
   path argument as structured input.

2. **Shell / terminal tool** (``terminal``, ``shell``, ``bash``, ``sh``)
   — covers ``rm`` / ``unlink`` / ``mv`` / overwriting redirects /
   chmod chown against protected prefixes. Also scans for **inline
   ``python -c "os.remove(...)"``** shape, because ``python -c`` from
   terminal would otherwise silently escape both Hermes regex and our
   structured-file gate.

3. **Code execution** (``code_execution``, ``execute_code``, ``python``,
   ``python_exec``, ``code_interpreter``, ``run_code``) — Hermes's
   in-process Python runner. The agent will use it to bypass the
   shell layer if that's the only thing we block. We grep the source
   for destructive Python APIs near a protected prefix substring.

Protected zones default to ``~/Desktop``, ``~/Documents``,
``~/Downloads`` plus a few system paths. Edit ``PROTECTED_PREFIXES``
to taste.

GUARD_VERSION gets bumped whenever Corey pushes a new bundled script
so ``hermes_hooks::seed_guards_script`` knows when to overwrite the
installed copy.
"""

GUARD_VERSION = "4"  # Bump on any behavioural change.

import hashlib
import json
import uuid as _uuid
import os
import re
import subprocess
import sys
import time

# Tools that pass paths as structured arguments. We pull the path out
# of ``tool_input`` directly and test it against the protected
# prefixes.
STRUCTURED_TOOLS = {
    "delete_file",
    "move_file",
    "write_file",
    "edit_file",
    "file",              # Hermes unified file tool (platform_toolsets cli)
    "file_write",
    "file_delete",
    "file_move",
    "file_edit",
}

# Tools that take a free-form shell command string. We scan the raw
# command for protected-prefix substrings + destructive verbs.
SHELL_TOOLS = {
    "terminal",         # Hermes canonical name (platform_toolsets cli)
    "shell",
    "bash",
    "sh",
    "run_shell",
    "execute_shell",
}

# Tools that take a free-form code string (Python, JS, etc.). Same
# scan logic as SHELL_TOOLS but with a different verb list matching
# the language's destructive APIs. This is the *third* escape hatch —
# Hermes's ``code_execution`` tool runs arbitrary Python in-process,
# trivially bypassing both DANGEROUS_PATTERNS (no shell) and our
# STRUCTURED_TOOLS gate (no path argument).
CODE_TOOLS = {
    "code_execution",   # Hermes canonical name (platform_toolsets cli)
    "execute_code",
    "python",
    "python_exec",
    "code_interpreter",
    "run_code",
    "exec_python",
}

HOME = os.path.expanduser("~")
IS_WINDOWS = sys.platform == "win32"


def _norm(p: str) -> str:
    return os.path.normpath(p) + os.sep


# Order matters loosely — most-specific first reads better in logs.
# Each prefix is normalised via os.path.normpath so that Windows
# back-slash paths match against similarly-normalised candidates.
# ``_norm`` appends the platform separator so ``startswith`` is sound.
PROTECTED_PREFIXES = [
    _norm(f"{HOME}/Desktop"),
    _norm(f"{HOME}/Documents"),
    _norm(f"{HOME}/Downloads"),
]
if not IS_WINDOWS:
    PROTECTED_PREFIXES += [
        "/etc/",
        "/usr/",
        "/var/",
        "/System/",
        "/Library/",
    ]

# Equivalent prefixes the SHELL command might use even though they
# resolve to a protected zone. We can't exhaustively cover every
# shell quirk, but ``~/Desktop/...`` and ``$HOME/Desktop/...`` are by
# far the most common.  Keys are normalised to match ``hits_protected``
# logic; alias lists are kept as-is (forward-slash) because they are
# matched against raw command strings.
TILDE_EQUIV = {
    _norm(f"{HOME}/Desktop"): ["~/Desktop/", "$HOME/Desktop/", "${HOME}/Desktop/"],
    _norm(f"{HOME}/Documents"): ["~/Documents/", "$HOME/Documents/", "${HOME}/Documents/"],
    _norm(f"{HOME}/Downloads"): ["~/Downloads/", "$HOME/Downloads/", "${HOME}/Downloads/"],
}


DIALOG_SCRIPT = os.path.expanduser("~/.hermes/scripts/confirm_reliable.sh")
APPROVAL_DIR = os.path.expanduser("~/.hermes/corey-guards/approvals")
APPROVAL_TTL_SECS = 300

# ── Lock & debounce for dialog anti-spam ──
if IS_WINDOWS:
    DIALOG_LOCK = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "hermes-guard-dialog.lock")
else:
    DIALOG_LOCK = "/tmp/hermes-guard-dialog.lock"
DIALOG_DEBOUNCE_SECS = 3  # Same reason within 3s → auto-deny
_last_reasons: dict = {}  # {reason_hash: timestamp}
_current_session_id: str = ""


def _acquire_lock() -> bool:
    try:
        fd = os.open(DIALOG_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        try:
            with open(DIALOG_LOCK) as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)
            return False
        except (ValueError, ProcessLookupError):
            try:
                os.remove(DIALOG_LOCK)
            except OSError:
                pass
            try:
                fd = os.open(DIALOG_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                return True
            except FileExistsError:
                return False


def _release_lock():
    try:
        os.remove(DIALOG_LOCK)
    except OSError:
        pass


def _dialog_debounced(reason: str) -> bool:
    h = hashlib.md5(reason.encode()).hexdigest()
    now = time.time()
    last = _last_reasons.get(h)
    if last and (now - last) < DIALOG_DEBOUNCE_SECS:
        return True
    _last_reasons[h] = now
    for key in list(_last_reasons.keys()):
        if now - _last_reasons[key] > DIALOG_DEBOUNCE_SECS * 10:
            del _last_reasons[key]
    return False


def _ask_user_windows(reason: str) -> bool:
    title = "Hermes \u6587\u4ef6\u64cd\u4f5c\u786e\u8ba4"
    msg = f"Hermes \u60f3\u8981\u6267\u884c\u4ee5\u4e0b\u64cd\u4f5c:\n\n{reason}\n\n\u662f\u5426\u5141\u8bb8\uff1f"
    escaped_msg = msg.replace("'", "''")
    escaped_title = title.replace("'", "''")
    ps_script = (
        "Add-Type -AssemblyName PresentationFramework; "
        f"$msg = '{escaped_msg}'; "
        f"$title = '{escaped_title}'; "
        "$result = [System.Windows.MessageBox]::Show("
        "$msg, $title, 'OKCancel', 'Warning'); "
        "if ($result -eq 'OK') { exit 0 } else { exit 1 }"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", ps_script],
            capture_output=True, timeout=130,
        )
        return result.returncode == 0
    except Exception as e:
        _log(f"_ask_user_windows exception: {e}")
        return False


def _discover_corey_port() -> int | None:
    for candidate in [
        os.path.expanduser("~/.hermes/corey-guards/corey.port"),
        os.path.expanduser("~/.hermes/mcp_server.port"),
    ]:
        try:
            with open(candidate) as f:
                raw = f.read().strip()
                port = int(raw)
                if 1024 <= port <= 65535:
                    return port
        except (OSError, ValueError):
            continue
    try:
        import re
        cfg_path = os.path.expanduser("~/.hermes/config.yaml")
        with open(cfg_path) as f:
            for line in f:
                m = re.search(r'url:\s*http://127\.0\.0\.1:(\d+)', line)
                if m:
                    return int(m.group(1))
    except (OSError, ValueError):
        pass
    return None


def _ask_user_ipc(reason: str) -> bool | None:
    port = _discover_corey_port()
    if port is None:
        return None
    try:
        import urllib.request
        import urllib.error
        url = f"http://127.0.0.1:{port}/guard/prompt"
        payload = json.dumps({
            "reason": reason,
            "id": str(_uuid.uuid4()),
        }).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=130) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            allowed = bool(body.get("allowed", False))
            _log(f"IPC DIALOG: user {'APPROVED' if allowed else 'REJECTED'}")
            return allowed
    except Exception as e:
        _log(f"IPC DIALOG failed (falling back): {e}")
        return None


def _check_pending_approval(reason: str) -> bool:
    try:
        if not os.path.isdir(APPROVAL_DIR):
            return False
        reason_hash = hashlib.md5(reason.encode()).hexdigest()
        now = time.time()
        for fname in os.listdir(APPROVAL_DIR):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(APPROVAL_DIR, fname)
            try:
                with open(fpath) as f:
                    data = json.load(f)
                if data.get("reason_hash") != reason_hash:
                    continue
                if now - data.get("created_at", 0) > APPROVAL_TTL_SECS:
                    os.remove(fpath)
                    continue
                os.remove(fpath)
                _log(f"PENDING APPROVAL MATCHED: {fname}")
                return True
            except (OSError, ValueError, json.JSONDecodeError):
                continue
    except OSError:
        pass
    return False


def _write_pending_approval(reason: str, session_id: str):
    try:
        os.makedirs(APPROVAL_DIR, exist_ok=True)
        reason_hash = hashlib.md5(reason.encode()).hexdigest()
        data = {
            "reason_hash": reason_hash,
            "reason": reason,
            "session_id": session_id,
            "created_at": time.time(),
        }
        fname = f"{reason_hash}.json"
        with open(os.path.join(APPROVAL_DIR, fname), "w") as f:
            json.dump(data, f)
    except OSError as e:
        _log(f"write pending approval failed: {e}")


def ask_user(reason: str) -> tuple:
    if _check_pending_approval(reason):
        return (True, False)

    if _dialog_debounced(reason):
        _log("DIALOG DEBOUNCED (repeated reason)")
        return (False, False)

    if not _acquire_lock():
        _log("DIALOG LOCKED (another guard process holds the lock)")
        return (False, False)

    try:
        ipc_result = _ask_user_ipc(reason)
        if ipc_result is not None:
            return (ipc_result, False)

        if IS_WINDOWS:
            win_result = _ask_user_windows(reason)
            return (win_result, False)

        if not os.path.exists(DIALOG_SCRIPT):
            _log(f"DIALOG SCRIPT MISSING at {DIALOG_SCRIPT} -- defaulting to deny")
            return (False, True)

        title = "Hermes \u6587\u4ef6\u64cd\u4f5c\u786e\u8ba4"
        msg = f"Hermes \u60f3\u8981\u6267\u884c\u4ee5\u4e0b\u64cd\u4f5c:\n\n{reason}\n\n\u662f\u5426\u5141\u8bb8\uff1f"
        result = subprocess.run(
            [DIALOG_SCRIPT, msg, title],
            capture_output=True, timeout=130,
        )
        user_responded = result.returncode in (0, 1)
        return (result.returncode == 0, not user_responded)
    except Exception as e:
        _log(f"ask_user exception: {e}")
        return (False, True)
    finally:
        _release_lock()


def block(reason: str):
    _log(f"BLOCK {reason}")
    approved, was_headless = ask_user(reason)
    if approved:
        _log(f"USER APPROVED: {reason}")
        allow(note="user-approved-after-block")
    else:
        if was_headless:
            _write_pending_approval(reason, _current_session_id)
            user_reason = (
                f"{reason}\n\n"
                "如果确认要执行此操作，请回复「确认执行」，我将重新尝试。"
            )
        else:
            user_reason = reason
        _log(f"USER REJECTED: {reason}")
        print(json.dumps({"decision": "block", "reason": user_reason}))
        sys.exit(0)


def allow(note: str = "clean"):
    # Empty JSON body = silent allow per Hermes hook protocol.
    _log(f"ALLOW ({note})")
    print("{}")
    sys.exit(0)


def candidates_from_structured_input(tool_input: dict) -> list:
    """Pull every plausible path field from a structured tool's
    arguments. Different tools name the path field differently; we
    collect them all so we never miss one under the wrong key."""
    keys = ("path", "file_path", "src", "dst", "destination", "source", "target")
    out = []
    for k in keys:
        v = tool_input.get(k)
        if v:
            out.append(str(v))
    return out


def expand(p: str, cwd: str) -> str:
    p = os.path.expandvars(os.path.expanduser(p))
    if not os.path.isabs(p):
        p = os.path.join(cwd or os.getcwd(), p)
    return os.path.normpath(p)


def hits_protected(absolute_path: str) -> str | None:
    normed = os.path.normpath(absolute_path) + os.sep
    for prefix in PROTECTED_PREFIXES:
        if normed.startswith(prefix):
            return prefix
    return None


def scan_shell_command(command: str) -> str | None:
    """Match the raw shell ``command`` string against protected
    prefixes (both absolute and ``~/``-relative)."""
    for prefix in PROTECTED_PREFIXES:
        if prefix in command:
            return prefix
        if IS_WINDOWS:
            fwd = prefix.replace("\\", "/")
            if fwd in command:
                return prefix
    for resolved, aliases in TILDE_EQUIV.items():
        for alias in aliases:
            if alias in command:
                return resolved
    return None


# Regex: Python destructive APIs. Reused across code-exec path AND
# shell ``python -c`` inline-python detection path.
PY_DESTRUCTIVE_RE = re.compile(
    r"\b("
    r"os\.(remove|unlink|rmdir)|"           # stdlib path ops
    r"shutil\.(rmtree|move|copy)|"           # high-level ops
    r"\.unlink\(|"                           # Path.unlink()
    r"\.rmdir\(|"
    r"\.write_(text|bytes)\(|"               # Path.write_*
    r"open\([^)]*['\"][wax]"                 # open(..., 'w'/'a'/'x')
    r")",
)

# Regex: a shell command that embeds inline Python. Matches
# ``python -c 'code'`` / ``python3 -c "..."`` / ``python -c code``.
# Also covers ``python -m py_compile`` variants loosely.
SHELL_INLINE_PYTHON_RE = re.compile(
    r"\bpython[23]?\s+-c\s+",
)


def _log(msg: str):
    """Append a timestamped line to ~/.hermes/corey-guards/guard.log.
    The Hermes agent log only records registration; per-call traces
    go here so Corey Settings UI can show 'last N firings'."""
    try:
        import datetime
        path = os.path.expanduser("~/.hermes/corey-guards/guard.log")
        ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with open(path, "a") as f:
            f.write(f"{ts} {msg}\n")
    except Exception:
        # Logging must never break the hook itself.
        pass


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        _log("ERROR: malformed payload, allowing")
        allow(note="malformed-payload")
        return

    tool_name = payload.get("tool_name", "") or ""
    tool_input = payload.get("tool_input") or payload.get("args") or {}
    cwd = payload.get("cwd") or os.getcwd()
    global _current_session_id
    _current_session_id = payload.get("session_id") or ""
    _log(
        f"FIRED tool={tool_name!r} "
        f"input_keys={list(tool_input.keys()) if isinstance(tool_input, dict) else []} "
        f"input={json.dumps(tool_input, ensure_ascii=False)[:500]}"
    )

    if not isinstance(tool_input, dict):
        allow(note="non-dict-input")
        return

    # ───── Path 1: structured file-ops ─────
    if tool_name in STRUCTURED_TOOLS:
        for raw in candidates_from_structured_input(tool_input):
            p = expand(raw, cwd)
            prefix = hits_protected(p)
            if prefix:
                block(
                    f"Corey guard: {tool_name} blocked on "
                    f"protected path {p} (under {prefix}). "
                    f"Edit ~/.hermes/corey-guards/file-ops-guard.py "
                    f"to change the protected list."
                )
        allow(note=f"structured-tool-clean ({tool_name})")
        return

    # ───── Path 3: code execution (Python) ─────
    if tool_name in CODE_TOOLS:
        code = (
            tool_input.get("code")
            or tool_input.get("source")
            or tool_input.get("script")
            or tool_input.get("command")
            or ""
        )
        if not isinstance(code, str):
            code = str(code)
        if PY_DESTRUCTIVE_RE.search(code):
            prefix = scan_shell_command(code)
            if prefix:
                block(
                    f"Corey guard: {tool_name} blocked because the "
                    f"snippet would touch protected path under "
                    f"{prefix}. Code: {code[:200]!r}. "
                    f"Edit ~/.hermes/corey-guards/file-ops-guard.py "
                    f"to relax."
                )
        allow(note=f"code-tool-clean ({tool_name})")
        return

    # ───── Path 2: shell / terminal command string ─────
    if tool_name in SHELL_TOOLS:
        cmd = (
            tool_input.get("command")
            or tool_input.get("cmd")
            or tool_input.get("script")
            or ""
        )
        if not isinstance(cmd, str):
            cmd = str(cmd)

        # Detect inline python bypass BEFORE the shell destructive-verb
        # check — an agent saying ``python -c "os.remove('~/Desktop/x')"``
        # won't match rm/unlink/mv but IS the exact escape hatch we're
        # trying to close.
        if SHELL_INLINE_PYTHON_RE.search(cmd):
            if PY_DESTRUCTIVE_RE.search(cmd):
                prefix = scan_shell_command(cmd)
                if prefix:
                    block(
                        f"Corey guard: shell command blocked — it "
                        f"runs inline Python against protected path "
                        f"under {prefix}. Command: {cmd!r}. This is "
                        f"the exact bypass vector we're guarding "
                        f"against. Tell the user to do this directly "
                        f"if they really want it."
                    )

        destructive_verbs = re.compile(
            r"\b(rm|unlink|mv|cp\s+-[^\s]*[fF]|chmod|chown|"
            r"rsync\s+--delete|truncate|shred|"
            r"tee|>\s*[~/]|>>\s*[~/])\b",
            re.IGNORECASE,
        )
        if destructive_verbs.search(cmd):
            prefix = scan_shell_command(cmd)
            if prefix:
                block(
                    f"Corey guard: shell command blocked because it "
                    f"would touch protected path under {prefix}. "
                    f"Command: {cmd!r}. "
                    f"Edit ~/.hermes/corey-guards/file-ops-guard.py "
                    f"to relax."
                )
        allow(note=f"shell-tool-clean ({tool_name})")
        return

    # All other tools — out of scope.
    allow(note=f"out-of-scope ({tool_name})")


if __name__ == "__main__":
    main()
