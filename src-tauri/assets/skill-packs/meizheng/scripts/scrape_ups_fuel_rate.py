#!/usr/bin/env python3
import sys
import os
import json
import re

sys.path.append(os.path.dirname(__file__))
from date_utils import calculate_end_date
from datetime import datetime
from urllib.request import urlopen

try:
    import websocket
except ImportError:
    websocket = None

UPS_URL = "https://www.ups.com/us/en/support/shipping-support/shipping-costs-rates/fuel-surcharges"
CDP_PORT = 9222


def get_ws_url(cdp_port):
    import json as _json
    tabs = _json.loads(urlopen(f"http://localhost:{cdp_port}/json/list").read())
    for t in tabs:
        if t.get("type") == "page":
            return t["webSocketDebuggerUrl"]
    return None


def cdp_eval(ws, expr, msg_id=1):
    import json as _json
    ws.send(_json.dumps({"id": msg_id, "method": "Runtime.evaluate",
                         "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    while True:
        r = _json.loads(ws.recv())
        if r.get("id") == msg_id:
            return r.get("result", {}).get("result", {}).get("value")


def scrape_ups_fuel_rate(validity_days=7, cdp_port=CDP_PORT):
    if websocket is None:
        raise ImportError("websocket-client is required: pip install websocket-client")

    ws_url = get_ws_url(cdp_port)
    if not ws_url:
        raise RuntimeError(f"No browser tab found on CDP port {cdp_port}")

    ws = websocket.create_connection(ws_url, suppress_origin=True)
    try:
        ws.send(json.dumps({"id": 10, "method": "Page.navigate",
                            "params": {"url": UPS_URL}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == 10:
                break

        import time
        time.sleep(6)

        js_extract = """
        (() => {
            const tables = document.querySelectorAll('table.table-content');
            if (tables.length === 0) return JSON.stringify({error: 'no table found'});
            for (const table of tables) {
                const allRows = Array.from(table.querySelectorAll('tr'));
                for (const row of allRows) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length >= 3) {
                        const text = cells[0].innerText.trim();
                        if (text.match(/\\d{2}\\/\\d{2}\\/\\d{4}/)) {
                            return JSON.stringify({cells: cells.map(c => c.innerText.trim())});
                        }
                    }
                }
            }
            return JSON.stringify({error: 'no data rows', tableCount: tables.length});
        })()
        """
        raw = cdp_eval(ws, js_extract, msg_id=20)
    finally:
        ws.close()

    if not raw:
        return []

    data = json.loads(raw)
    if "error" in data:
        print(f"UPS table extraction error: {data['error']}", file=sys.stderr)
        return []

    cells = data.get("cells", [])
    if len(cells) < 3:
        return []

    eff_date_str = cells[0]
    try:
        eff_dt = datetime.strptime(eff_date_str, "%m/%d/%Y")
        effective_date = eff_dt.strftime("%Y-%m-%d")
    except ValueError:
        effective_date = datetime.now().strftime("%Y-%m-%d")
        eff_dt = datetime.now()

    ground_rate = float(cells[1].replace("%", ""))
    air_rate = float(cells[2].replace("%", ""))

    end_dt = calculate_end_date(eff_dt, validity_days)
    valid_to = end_dt.strftime("%Y-%m-%d")

    return [
        {
            "carrier": "UPS",
            "source_name": "Domestic Ground Surcharge",
            "rate": ground_rate,
            "effective_date": effective_date,
            "valid_to": valid_to,
        },
        {
            "carrier": "UPS",
            "source_name": "Domestic Air Surcharge",
            "rate": air_rate,
            "effective_date": effective_date,
            "valid_to": valid_to,
        },
    ]


if __name__ == "__main__":
    validity_days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    results = scrape_ups_fuel_rate(validity_days)
    print(json.dumps(results, indent=2, ensure_ascii=False))
