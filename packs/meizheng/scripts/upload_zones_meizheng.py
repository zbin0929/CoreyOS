#!/usr/bin/env python3
import base64
import json
import os
import sys
import time
import argparse
import urllib.request
import urllib.error

try:
    import requests
except ImportError:
    requests = None

try:
    import yaml
except ImportError:
    yaml = None

HERMES_DIR = os.environ.get("HERMES_DIR", os.path.expanduser("~/.hermes"))
CONFIG_PATH = os.path.join(HERMES_DIR, "pack-data", "meizheng", "config", "fuel-rate-config.yaml")
TOKEN_CACHE_PATH = os.path.join(HERMES_DIR, "pack-data", "meizheng", "config", ".token_cache.json")
DEFAULT_PREFIX = "UPS-GROUND"
MAX_RETRIES = 3
RETRY_DELAYS = [2, 4, 8]


def load_config():
    with open(CONFIG_PATH, "r") as f:
        if yaml:
            return yaml.safe_load(f)
        return json.load(f)


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
    cache = {"token": token, "expires_at": time.time() + ttl_seconds}
    tmp = TOKEN_CACHE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f)
    os.replace(tmp, TOKEN_CACHE_PATH)


def login(api_base, username, password):
    auth = base64.b64encode(f"{username}:{password}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "X-client": "web", "Content-Length": "0"}
    if requests:
        r = requests.post(f"{api_base}/login/token", headers=headers, timeout=15)
        r.raise_for_status()
        body = r.json()
    else:
        req = urllib.request.Request(f"{api_base}/login/token", data=b"", headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode())
    if body.get("code") != 0:
        raise RuntimeError(f"Login failed: {body.get('message', 'unknown')}")
    token = body.get("data")
    if isinstance(token, dict):
        token = token.get("token")
    save_cached_token(token)
    return token


class TokenManager:
    def __init__(self, api_base, username, password):
        self.api_base = api_base
        self.username = username
        self.password = password
        self._token = load_cached_token()
        if not self._token:
            self._refresh()

    def _refresh(self):
        self._token = login(self.api_base, self.username, self.password)

    def get(self):
        return self._token

    def refresh_if_401(self, func):
        try:
            return func(self._token)
        except Exception as e:
            err_str = str(e).lower()
            if "401" in err_str or "unauthorized" in err_str:
                print("Token expired, re-login...", file=sys.stderr)
                self._refresh()
                return func(self._token)
            raise


def _api_post_json(api_base, token, path, body):
    headers = {"Content-Type": "application/json", "X-Mazon-Token": token, "X-client": "web"}
    if requests:
        r = requests.post(f"{api_base}{path}", json=body, headers=headers, timeout=30)
        r.raise_for_status()
        return r.json()
    else:
        req = urllib.request.Request(f"{api_base}{path}", data=json.dumps(body).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())


def find_zone_schema(api_base, token, zip3, prefix=DEFAULT_PREFIX):
    name = f"{prefix} {zip3}"
    data = _api_post_json(api_base, token, "/quote/zoneschema/zoneSchema/admin/page",
        {"pageNo": 1, "pageSize": 20, "name": name})
    records = data.get("data", {}).get("records", data.get("data", []))
    if isinstance(records, list):
        for rec in records:
            if rec.get("name") == name:
                return rec
    return None


def parse_xlsx(api_base, token, xlsx_path):
    filename = os.path.basename(xlsx_path)
    url = f"{api_base}/quote/zoneschema/zoneSchema/admin/importPostCode"
    if requests:
        with open(xlsx_path, "rb") as f:
            r = requests.post(url,
                files={"file": (filename, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                headers={"X-Mazon-Token": token, "X-client": "web"}, timeout=60)
        r.raise_for_status()
        return r.json()
    else:
        import uuid
        boundary = uuid.uuid4().hex
        with open(xlsx_path, "rb") as f:
            file_data = f.read()
        body = b"".join([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
            b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n",
            b"\r\n", file_data, f"\r\n--{boundary}--\r\n".encode(),
        ])
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-Mazon-Token": token, "X-client": "web",
        }, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())


def save_zone(api_base, token, zone_detail, parsed_items):
    body = {
        "id": zone_detail["id"],
        "name": zone_detail["name"],
        "carrierId": zone_detail["carrierId"],
        "countryCode": zone_detail["countryCode"],
        "senderPostcodeStart": zone_detail["senderPostcodeStart"],
        "senderPostcodeEnd": zone_detail["senderPostcodeEnd"],
        "pcdProduct": zone_detail.get("pcdProduct", False),
        "zoneSchemaItemPostcodes": parsed_items,
    }
    return _api_post_json(api_base, token, "/quote/zoneschema/zoneSchema/admin/update", body)


def upload_single(api_base, token_mgr, zip3, xlsx_path, prefix=DEFAULT_PREFIX):
    token = token_mgr.get()
    zone_rec = token_mgr.refresh_if_401(lambda t: find_zone_schema(api_base, t, zip3, prefix))
    if not zone_rec:
        raise RuntimeError(f"Zone not found: {prefix} {zip3}")

    parse_result = token_mgr.refresh_if_401(lambda t: parse_xlsx(api_base, t, xlsx_path))
    if parse_result.get("code") != 0:
        raise RuntimeError(f"Parse failed: {parse_result.get('message')}")

    parsed_items = parse_result.get("data", [])
    for item in parsed_items:
        if "zoneSchemaItemPostcodeVOList" in item:
            item["postcodeList"] = item.pop("zoneSchemaItemPostcodeVOList")

    save_result = token_mgr.refresh_if_401(lambda t: save_zone(api_base, t, zone_rec, parsed_items))
    if save_result.get("code") != 0:
        raise RuntimeError(f"Save failed: {save_result.get('message')}")
    return save_result


def load_checkpoint(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"completed": [], "failed": []}


def save_checkpoint(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def batch_upload(zone_dir, prefix=DEFAULT_PREFIX, checkpoint_path=None):
    if checkpoint_path is None:
        checkpoint_path = os.path.join(zone_dir, "upload_checkpoint.json")

    cp = load_checkpoint(checkpoint_path)
    completed = set(cp.get("completed", []))

    config = load_config()
    mz = config["meizheng_os"]
    api_base = mz["api_base_url"].rstrip("/")
    creds = mz["credentials"]
    token_mgr = TokenManager(api_base, creds["username"], creds["password"])

    file_prefix = f"{prefix}-"
    xlsx_files = sorted(f for f in os.listdir(zone_dir) if f.startswith(file_prefix) and f.endswith(".xlsx"))
    total = len(xlsx_files)
    print(f"Found {total} xlsx files ({prefix}), {len(completed)} already done", file=sys.stderr)

    new_failed = []
    for i, fname in enumerate(xlsx_files):
        zip3 = fname.replace(file_prefix, "").replace(".xlsx", "")
        if zip3 in completed:
            continue

        xlsx_path = os.path.join(zone_dir, fname)
        done = len(completed) + len(new_failed) + 1
        print(f"[{done}/{total}] {zip3}...", end=" ", file=sys.stderr)

        ok = False
        for attempt in range(MAX_RETRIES):
            try:
                upload_single(api_base, token_mgr, zip3, xlsx_path, prefix)
                ok = True
                break
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAYS[attempt]
                    print(f"retry({attempt+1}) {delay}s: {e} ", end=" ", file=sys.stderr)
                    time.sleep(delay)
                else:
                    new_failed.append({"zip3": zip3, "error": str(e)})
                    print(f"FAIL: {e}", file=sys.stderr)

        if ok:
            completed.add(zip3)
            cp["completed"] = sorted(completed)
            save_checkpoint(checkpoint_path, cp)
            print(f"OK", file=sys.stderr)

        time.sleep(1)

    if new_failed:
        cp["failed"] = cp.get("failed", []) + new_failed
        save_checkpoint(checkpoint_path, cp)

    print(f"\nDone: {len(completed)} OK, {len(new_failed)} failed", file=sys.stderr)
    return {"total": total, "completed": len(completed), "failed": len(new_failed)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload zone Excel to meizheng OS")
    parser.add_argument("--zip3", default="", help="Single ZIP3 to upload (e.g. 910)")
    parser.add_argument("--xlsx", default="", help="Path to xlsx file (single mode)")
    parser.add_argument("--dir", default="", help="Directory of xlsx files (batch mode)")
    parser.add_argument("--carrier", default="UPS-GROUND", help="Zone name prefix (default: UPS-GROUND)")
    parser.add_argument("--all", action="store_true", help="Upload all xlsx in default zone-charts dir")
    args = parser.parse_args()

    prefix = args.carrier

    if not args.zip3 and not args.all and not args.dir:
        parser.error("Specify --zip3 <code>, --dir <path>, or --all")

    try:
        if args.zip3:
            config = load_config()
            mz = config["meizheng_os"]
            api_base = mz["api_base_url"].rstrip("/")
            creds = mz["credentials"]
            token_mgr = TokenManager(api_base, creds["username"], creds["password"])

            xlsx_path = args.xlsx or os.path.join(HERMES_DIR, "pack-data", "meizheng", "zone-charts", f"{prefix}-{args.zip3}.xlsx")
            if not os.path.exists(xlsx_path):
                print(json.dumps({"status": "failed", "reason": f"File not found: {xlsx_path}"}))
                sys.exit(1)

            print(f"Token OK", file=sys.stderr)
            result = upload_single(api_base, token_mgr, args.zip3, xlsx_path, prefix)
            print(json.dumps(result, ensure_ascii=False))
        elif args.all:
            zone_dir = os.path.join(HERMES_DIR, "pack-data", "meizheng", "zone-charts")
            result = batch_upload(zone_dir, prefix)
            print(json.dumps(result, ensure_ascii=False))
        elif args.dir:
            result = batch_upload(args.dir, prefix)
            print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "failed", "reason": str(e)}, ensure_ascii=False))
        sys.exit(1)
