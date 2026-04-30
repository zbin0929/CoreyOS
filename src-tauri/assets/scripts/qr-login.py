#!/usr/bin/env python3
import sys
import json
import os
import asyncio
import time

_session_dir = os.path.join(os.environ.get("TMPDIR", "/tmp"), "corey-qr-session")


def _session_file(channel_id):
    os.makedirs(_session_dir, exist_ok=True)
    return os.path.join(_session_dir, f"{channel_id}.json")


def _write_session(channel_id, data):
    with open(_session_file(channel_id), "w") as f:
        json.dump(data, f, ensure_ascii=False)


def _write_qr(channel_id, qr_data):
    _write_session(channel_id, {"status": "pending", "qr_data": qr_data})
    json.dump({"type": "qr", "data": qr_data}, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def _write_done(channel_id, env_vars):
    _write_session(channel_id, {"status": "done", "env": env_vars})


def _write_error(channel_id, message):
    _write_session(channel_id, {"status": "error", "message": message})


# ── Weixin ──────────────────────────────────────────────────────────────────

async def _weixin_qr_flow():
    import aiohttp

    BASE_URL = "https://ilinkai.weixin.qq.com"
    ILINK_HEADERS = {
        "iLink-App-Id": "bot",
        "iLink-App-ClientVersion": str((2 << 16) | (2 << 8) | 0),
    }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"{BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3",
                headers=ILINK_HEADERS,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                raw = await resp.text()
                qr_resp = json.loads(raw)
        except Exception as exc:
            _write_error("weixin", f"Failed to fetch QR: {exc}")
            return

        qrcode_value = str(qr_resp.get("qrcode") or "")
        qrcode_url = str(qr_resp.get("qrcode_img_content") or "")
        if not qrcode_value:
            _write_error("weixin", "QR response missing qrcode")
            return

        qr_scan_data = qrcode_url if qrcode_url else qrcode_value
        _write_qr("weixin", qr_scan_data)

        deadline = time.time() + 480
        current_base_url = BASE_URL

        while time.time() < deadline:
            try:
                async with session.get(
                    f"{current_base_url}/ilink/bot/get_qrcode_status?qrcode={qrcode_value}",
                    headers=ILINK_HEADERS,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    raw = await resp.text()
                    status_resp = json.loads(raw)
            except Exception:
                await asyncio.sleep(2)
                continue

            status = str(status_resp.get("status") or "wait")
            if status == "wait":
                await asyncio.sleep(2)
            elif status == "scaned":
                await asyncio.sleep(2)
            elif status == "scaned_but_redirect":
                redirect_host = str(status_resp.get("redirect_host") or "")
                if redirect_host:
                    current_base_url = f"https://{redirect_host}"
                await asyncio.sleep(2)
            elif status == "expired":
                _write_error("weixin", "二维码已过期")
                return
            elif status == "confirmed":
                account_id = str(status_resp.get("ilink_bot_id") or "")
                token = str(status_resp.get("bot_token") or "")
                if not account_id or not token:
                    _write_error("weixin", "QR confirmed but credentials incomplete")
                    return
                _write_done("weixin", {
                    "WEIXIN_ACCOUNT_ID": account_id,
                    "WEIXIN_TOKEN": token,
                })
                return

    _write_error("weixin", "QR login timed out")


def run_weixin():
    try:
        import aiohttp
    except ImportError:
        _write_error("weixin", "aiohttp not installed")
        return
    try:
        asyncio.run(_weixin_qr_flow())
    except Exception as exc:
        _write_error("weixin", f"QR login failed: {exc}")


# ── DingTalk ────────────────────────────────────────────────────────────────

def _dingtalk_api_post(path, payload):
    import requests
    base_url = os.environ.get("DINGTALK_REGISTRATION_BASE_URL", "https://oapi.dingtalk.com")
    url = f"{base_url}{path}"
    resp = requests.post(url, json=payload, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    errcode = data.get("errcode", -1)
    if errcode != 0:
        raise RuntimeError(f"API error [{path}]: {data.get('errmsg', 'unknown')} (errcode={errcode})")
    return data


def run_dingtalk():
    try:
        import requests
    except ImportError:
        _write_error("dingtalk", "requests not installed")
        return

    try:
        init_data = _dingtalk_api_post("/app/registration/init", {"source": "DING_DWS_CLAW"})
        nonce = str(init_data.get("nonce", "")).strip()
        if not nonce:
            _write_error("dingtalk", "init response missing nonce")
            return

        begin_data = _dingtalk_api_post("/app/registration/begin", {"nonce": nonce})
        device_code = str(begin_data.get("device_code", "")).strip()
        verification_url = str(begin_data.get("verification_uri_complete", "")).strip()
        if not device_code or not verification_url:
            _write_error("dingtalk", "begin response missing device_code or verification_uri")
            return

        _write_qr("dingtalk", verification_url)

        expires_in = int(begin_data.get("expires_in", 7200))
        interval = max(int(begin_data.get("interval", 3)), 2)
        deadline = time.monotonic() + expires_in

        while time.monotonic() < deadline:
            time.sleep(interval)
            try:
                result = _dingtalk_api_post("/app/registration/poll", {"device_code": device_code})
            except Exception:
                continue

            status = str(result.get("status", "")).strip().upper()
            if status == "WAITING":
                continue
            elif status == "SUCCESS":
                client_id = str(result.get("client_id", "")).strip()
                client_secret = str(result.get("client_secret", "")).strip()
                if not client_id or not client_secret:
                    _write_error("dingtalk", "SUCCESS but missing client_id or client_secret")
                    return
                _write_done("dingtalk", {
                    "DINGTALK_CLIENT_ID": client_id,
                    "DINGTALK_CLIENT_SECRET": client_secret,
                })
                return
            elif status in ("FAIL", "EXPIRED"):
                _write_error("dingtalk", f"Authorization {status.lower()}")
                return

        _write_error("dingtalk", "Authorization timed out")

    except Exception as exc:
        _write_error("dingtalk", f"QR auth failed: {exc}")


# ── QQ Bot ──────────────────────────────────────────────────────────────────


def _verify_qq_credentials(app_id, client_secret):
    """Exchange (appId, clientSecret) for an access token to confirm the
    credentials QQ just handed us actually work. The QQ bind API is known
    to occasionally return a secret that *decrypts cleanly* but is stale
    (developer rotated it on the portal) or mis-bound (sandbox vs prod,
    multi-bot account picked wrong bot). Without this check we happily
    commit the broken creds and the user eventually sees "该机器人的灵魂
    不在线" in QQ with zero diagnostic info.

    Returns None on success, or a human-readable error string on failure.
    """
    try:
        import httpx
    except ImportError as exc:
        return f"httpx not available: {exc}"
    try:
        resp = httpx.post(
            "https://bots.qq.com/app/getAppAccessToken",
            json={"appId": str(app_id), "clientSecret": str(client_secret)},
            timeout=10,
        )
        data = resp.json()
    except Exception as exc:
        return f"token endpoint unreachable: {exc}"
    if data.get("access_token"):
        return None
    code = data.get("code")
    msg = data.get("message") or data.get("msg") or "unknown"
    return f"QQ 拒绝凭据 (code={code}, msg={msg})"


def run_qqbot():
    try:
        from gateway.platforms.qqbot.onboard import (
            _create_bind_task,
            _poll_bind_result,
            build_connect_url,
            BindStatus,
        )
        from gateway.platforms.qqbot.crypto import decrypt_secret
    except ImportError as exc:
        _write_error("qq", f"QQ Bot onboard not available: {exc}")
        return

    try:
        task_id, aes_key = _create_bind_task()
        url = build_connect_url(task_id)

        _write_qr("qq", url)

        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            time.sleep(3)
            try:
                status, app_id, encrypted_secret, user_openid = _poll_bind_result(task_id)
            except Exception:
                continue

            if status == BindStatus.COMPLETED:
                client_secret = decrypt_secret(encrypted_secret, aes_key)
                if not app_id or not client_secret:
                    _write_error("qq", "COMPLETED but missing credentials")
                    return

                # End-to-end verify. Retry up to 3 times with 5s gap in
                # case QQ's provisioning is still propagating between
                # the bind API and the token API (rare, but seen).
                last_err = _verify_qq_credentials(app_id, client_secret)
                for _ in range(2):
                    if last_err is None:
                        break
                    time.sleep(5)
                    last_err = _verify_qq_credentials(app_id, client_secret)

                if last_err is not None:
                    _write_error(
                        "qq",
                        (
                            f"扫码已完成，但凭据换不到 access_token：{last_err}。\n"
                            f"AppID={app_id}。请去 https://q.qq.com 开发者后台确认：\n"
                            f"1) 机器人已『发布』（不是沙箱草稿）；\n"
                            f"2) App Secret 未被重置；\n"
                            f"3) 账号下的目标 Bot 与扫码时选中的一致。"
                        ),
                    )
                    return

                _write_done("qq", {
                    "QQ_BOT_APP_ID": str(app_id),
                    "QQ_BOT_APP_SECRET": str(client_secret),
                })
                return
            elif status == BindStatus.EXPIRED:
                _write_error("qq", "QR code expired")
                return

        _write_error("qq", "QR registration timed out")

    except Exception as exc:
        _write_error("qq", f"QR register failed: {exc}")


# ── WhatsApp ────────────────────────────────────────────────────────────────

def run_whatsapp():
    hermes_home = os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))
    bridge_dir = os.path.join(hermes_home, "hermes-agent", "scripts", "whatsapp-bridge")
    bridge_js = os.path.join(bridge_dir, "bridge.js")

    if not os.path.exists(bridge_js):
        _write_error("whatsapp", "WhatsApp bridge not found")
        return

    if not os.path.exists(os.path.join(bridge_dir, "node_modules")):
        import subprocess
        try:
            subprocess.run(
                ["npm", "install", "--production"],
                cwd=bridge_dir,
                capture_output=True,
                timeout=120,
                check=True,
            )
        except Exception as exc:
            _write_error("whatsapp", f"Failed to install bridge dependencies: {exc}")
            return

    session_dir = os.path.join(hermes_home, "whatsapp", "session")
    os.makedirs(session_dir, exist_ok=True)

    wrapper_path = os.path.join(bridge_dir, "whatsapp-qr-pair.mjs")
    if not os.path.exists(wrapper_path):
        _write_error("whatsapp", "WhatsApp QR wrapper not found")
        return

    import subprocess
    proc = subprocess.Popen(
        ["node", wrapper_path, "--session", session_dir],
        cwd=bridge_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    for line in proc.stderr:
        line = line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            evt = json.loads(line)
            if evt.get("type") == "qr":
                _write_qr("whatsapp", evt["data"])
            elif evt.get("type") in ("done", "connected"):
                _write_done("whatsapp", evt.get("env", {}))
                proc.terminate()
                return
            elif evt.get("type") == "error":
                _write_error("whatsapp", evt.get("message", "Unknown error"))
                proc.terminate()
                return
        except json.JSONDecodeError:
            pass

    proc.wait()
    _write_error("whatsapp", "Bridge exited without QR data")


# ── Dispatch ────────────────────────────────────────────────────────────────

DISPATCH = {
    "whatsapp": run_whatsapp,
    "weixin": run_weixin,
    "dingtalk": run_dingtalk,
    "qq": run_qqbot,
}


def main():
    global _session_dir
    if len(sys.argv) < 2:
        print(json.dumps({"type": "error", "message": "Usage: qr-login.py <channel_id> [session_dir]"}))
        sys.exit(1)

    channel_id = sys.argv[1]
    _session_dir = sys.argv[2] if len(sys.argv) > 2 else _session_dir
    handler = DISPATCH.get(channel_id)
    if handler is None:
        print(json.dumps({"type": "error", "message": f"QR login not supported for channel '{channel_id}'"}))
        sys.exit(1)

    handler()


if __name__ == "__main__":
    main()
