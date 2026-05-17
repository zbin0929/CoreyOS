#!/usr/bin/env python3
import base64
import json
import os
import sys
import time
from datetime import datetime

import requests
import yaml


def load_fuel_config():
    hermes_dir = os.environ.get("HERMES_DIR", os.path.expanduser("~/.hermes"))
    config_path = os.path.join(hermes_dir, "pack-data", "meizheng", "config", "fuel-rate-config.yaml")
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def load_exchange_rate_config():
    hermes_dir = os.environ.get("HERMES_DIR", os.path.expanduser("~/.hermes"))
    config_path = os.path.join(hermes_dir, "pack-data", "meizheng", "config", "exchange-rate-config.yaml")
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


TOKEN_CACHE_PATH = os.path.join(
    os.environ.get("HERMES_DIR", os.path.expanduser("~/.hermes")),
    "pack-data", "meizheng", "config", ".token_cache.json",
)


def load_cached_token():
    try:
        with open(TOKEN_CACHE_PATH, "r") as f:
            cache = json.load(f)
        if cache.get("expires_at", 0) > time.time():
            return cache.get("token")
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass
    return None


def save_cached_token(token, ttl_seconds=3600):
    os.makedirs(os.path.dirname(TOKEN_CACHE_PATH), exist_ok=True)
    cache = {
        "token": token,
        "expires_at": time.time() + ttl_seconds,
    }
    tmp = TOKEN_CACHE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f)
    os.replace(tmp, TOKEN_CACHE_PATH)


def decode_jwt_username(token):
    parts = token.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1]
    padding = 4 - len(payload) % 4
    if padding != 4:
        payload += "=" * padding
    try:
        data = json.loads(base64.urlsafe_b64decode(payload))
        return data.get("username")
    except Exception:
        return None


def login(api_base, username, password):
    auth = base64.b64encode(f"{username}:{password}".encode()).decode()
    r = requests.post(
        f"{api_base}/login/token",
        headers={
            "Authorization": f"Basic {auth}",
            "X-client": "web",
            "Content-Length": "0",
        },
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    if body.get("code") != 0:
        raise RuntimeError(f"Login failed: {body.get('message', body.get('msg', 'unknown error'))}")
    token = body["data"]
    save_cached_token(token)
    login_user = decode_jwt_username(token) or username
    return token, login_user


def get_token(api_base, username, password):
    token = load_cached_token()
    if token:
        return token, username
    return login(api_base, username, password)


def find_currency(api_base, token, currency_code="USD"):
    r = requests.post(
        f"{api_base}/account/currency/list",
        headers={"X-Mazon-Token": token, "Content-Type": "application/json"},
        json={"pageNo": 1, "pageSize": 20},
        timeout=15,
    )
    body = r.json()
    if body.get("code") != 0:
        raise RuntimeError(f"currency/list failed: {body.get('msg')}")
    for record in body.get("data", {}).get("records", []):
        if record.get("currencyCode") == currency_code:
            return record
    return None


def update_currency(api_base, token, record, new_rate, remark, update_by="zidonghua"):
    payload = {**record, "exchangeRate": new_rate, "remark": remark, "updateBy": update_by}
    r = requests.post(
        f"{api_base}/account/currency/update",
        headers={"X-Mazon-Token": token, "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    body = r.json()
    return body.get("code") == 0 and body.get("data") is True


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "failed", "reason": "Usage: update_exchange_rate_via_api.py <scraped.json>"}))
        sys.exit(1)

    with open(sys.argv[1]) as f:
        scraped = json.load(f)

    if "error" in scraped:
        print(json.dumps({"status": "skipped", "reason": scraped["error"]}))
        sys.exit(0)

    try:
        fuel_config = load_fuel_config()
    except Exception as e:
        print(json.dumps({"status": "failed", "reason": f"Fuel config load error: {e}"}))
        sys.exit(1)

    meizheng = fuel_config.get("meizheng_os", {})
    api_base = meizheng.get("api_base_url") or meizheng.get("base_url", "")
    creds = meizheng.get("credentials", {})
    username = creds.get("username", "")
    password = creds.get("password", "")

    if not api_base or not username or not password:
        print(json.dumps({"status": "failed", "reason": "Missing api_base_url or credentials in config"}))
        sys.exit(1)

    try:
        er_config = load_exchange_rate_config()
    except Exception as e:
        print(json.dumps({"status": "failed", "reason": f"Exchange rate config load error: {e}"}))
        sys.exit(1)

    try:
        token, login_user = get_token(api_base, username, password)

        target = er_config.get("target", {})
        currency_code = target.get("currencyCode", "USD")
        remark_template = er_config.get("remarkTemplate", "更新汇率{datetime}  {rate}")

        record = find_currency(api_base, token, currency_code)
        if not record:
            token, login_user = login(api_base, username, password)
            record = find_currency(api_base, token, currency_code)
        if not record:
            raise RuntimeError(f"{currency_code} currency record not found")

        new_rate = scraped["rate_converted"]
        publish_time = scraped["publish_time"]
        dt_formatted = datetime.strptime(publish_time, "%Y/%m/%d %H:%M:%S").strftime("%Y/%m/%d %H:%M:%S")
        remark = remark_template.replace("{datetime}", dt_formatted).replace("{rate}", str(new_rate))

        old_rate = record.get("exchangeRate")
        ok = update_currency(api_base, token, record, new_rate, remark, login_user)

        if not ok:
            token, login_user = login(api_base, username, password)
            ok = update_currency(api_base, token, record, new_rate, remark, login_user)

        print(json.dumps({
            "status": "success" if ok else "failed",
            "old_rate": old_rate,
            "new_rate": new_rate,
            "remark": remark,
        }, ensure_ascii=False))
        sys.exit(0 if ok else 1)
    except Exception as e:
        print(json.dumps({"status": "failed", "reason": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
