#!/usr/bin/env python3
import sys
import os
import json
import base64

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


def load_config():
    if yaml is None:
        raise ImportError("pyyaml is required")
    if not os.path.exists(CONFIG_PATH):
        raise FileNotFoundError(f"Config not found: {CONFIG_PATH}")
    with open(CONFIG_PATH, "r") as f:
        return yaml.safe_load(f)


def login(api_base, username, password):
    auth = base64.b64encode(f"{username}:{password}".encode()).decode()
    resp = requests.post(
        f"{api_base}/login/token",
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
        json={},
        timeout=15,
    )
    data = resp.json()
    token = data.get("data") or data.get("token") or data.get("access_token", "")
    if not token:
        raise RuntimeError(f"Login failed: {data}")
    return token


def get_carrier_list(api_base, token):
    resp = requests.get(
        f"{api_base}/supplier/carriers/list",
        headers={"X-Mazon-Token": token},
        timeout=15,
    )
    return resp.json().get("data", [])


def create_fuel_rate(api_base, token, payload):
    resp = requests.post(
        f"{api_base}/quote/feetype/fuelRate",
        headers={"X-Mazon-Token": token, "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    data = resp.json()
    record_id = data.get("data")
    if not record_id:
        print(f"  Create failed: {data}", file=sys.stderr)
    return record_id


def audit_fuel_rate(api_base, token, record_id):
    resp = requests.put(
        f"{api_base}/quote/feetype/fuelRate/admin/audit/{record_id}",
        headers={"X-Mazon-Token": token, "Content-Type": "application/json"},
        json={"auditStatus": 1},
        timeout=15,
    )
    data = resp.json()
    success = data.get("code") == 0 or data.get("data") is not None
    if not success:
        print(f"  Audit failed for {record_id}: {data}", file=sys.stderr)
    return success


def process_rates(rates, config):
    mz = config.get("meizheng_os", {})
    api_base = mz.get("api_base_url", mz.get("base_url", "")).rstrip("/")
    username = mz.get("credentials", {}).get("username", "")
    password = mz.get("credentials", {}).get("password", "")

    token = login(api_base, username, password)

    carriers_config = config.get("carriers", {})

    carrier_list = get_carrier_list(api_base, token)
    carrier_map = {c.get("name", "").lower(): c.get("carrierId") for c in carrier_list}

    results = {"created": 0, "audited": 0, "skipped": 0, "errors": 0}

    for entry in rates:
        carrier_name = entry.get("carrier", "")
        carrier_key = carrier_name.lower()
        carrier_id = carrier_map.get(carrier_key)

        if not carrier_id:
            print(f"  Carrier '{carrier_name}' not found in meizheng OS (available: {list(carrier_map.keys())})", file=sys.stderr)
            results["errors"] += 1
            continue

        c_cfg = carriers_config.get(carrier_key, {})
        services = c_cfg.get("services", [])

        source_name = entry.get("source_name", "")
        apply_to = "default"
        for svc in services:
            if svc.get("source_name") == source_name:
                apply_to = svc.get("apply_to", "default")
                break

        payload = {
            "carrierId": carrier_id,
            "effectiveDate": entry.get("effective_date", ""),
            "validTo": entry.get("valid_to", ""),
            "rate": float(entry.get("rate", 0)),
        }

        print(f"  Creating: {carrier_name} rate={entry.get('rate')}% {entry.get('effective_date')}~{entry.get('valid_to')}", file=sys.stderr)

        record_id = create_fuel_rate(api_base, token, payload)
        if not record_id:
            results["errors"] += 1
            continue

        results["created"] += 1

        if audit_fuel_rate(api_base, token, record_id):
            results["audited"] += 1
            print(f"  Audited: {carrier_name} id={record_id}", file=sys.stderr)
        else:
            results["errors"] += 1

    print(f"\nResults: {results['created']} created, {results['audited']} audited, {results['skipped']} skipped, {results['errors']} errors", file=sys.stderr)
    return results["errors"] == 0


if __name__ == "__main__":
    if requests is None:
        print("requests is required: pip install requests", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: update_fuel_rates_via_api.py <rates.json>", file=sys.stderr)
        sys.exit(1)

    rates_path = sys.argv[1]
    with open(rates_path, "r") as f:
        rates = json.load(f)

    config = load_config()
    ok = process_rates(rates, config)
    sys.exit(0 if ok else 1)
