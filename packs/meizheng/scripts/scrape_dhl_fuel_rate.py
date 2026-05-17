#!/usr/bin/env python3
import sys
import os
import json
import re

sys.path.append(os.path.dirname(__file__))
from date_utils import calculate_end_date, is_last_day_of_month
from datetime import datetime
from urllib.request import urlopen

try:
    import websocket
except ImportError:
    websocket = None

DHL_URL = "https://www.dhl.com/us-en/home/ecommerce/business-help-center/surcharge-policies.html"
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


def scrape_dhl_fuel_rate(validity_days=-1, cdp_port=CDP_PORT):
    if websocket is None:
        raise ImportError("websocket-client is required: pip install websocket-client")

    ws_url = get_ws_url(cdp_port)
    if not ws_url:
        raise RuntimeError(f"No browser tab found on CDP port {cdp_port}")

    ws = websocket.create_connection(ws_url, suppress_origin=True)
    try:
        ws.send(json.dumps({"id": 10, "method": "Page.navigate",
                            "params": {"url": DHL_URL}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == 10:
                break

        import time
        time.sleep(6)

        js_extract = """
        (() => {
            const text = document.body.innerText;
            const lines = text.split('\\n');
            let domesticRate = null;
            let effDate = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const m = line.match(/^May\\s+\\d{1,2}/i) ||
                          line.match(/^June\\s+\\d{1,2}/i) ||
                          line.match(/^April\\s+\\d{1,2}/i) ||
                          line.match(/^March\\s+\\d{1,2}/i) ||
                          line.match(/^January\\s+\\d{1,2}/i) ||
                          line.match(/^February\\s+\\d{1,2}/i) ||
                          line.match(/^July\\s+\\d{1,2}/i) ||
                          line.match(/^August\\s+\\d{1,2}/i) ||
                          line.match(/^September\\s+\\d{1,2}/i) ||
                          line.match(/^October\\s+\\d{1,2}/i) ||
                          line.match(/^November\\s+\\d{1,2}/i) ||
                          line.match(/^December\\s+\\d{1,2}/i);
                if (m && !effDate) {
                    const dateM = text.match(/(\\w+\\s+\\d{1,2}\\s*[-–]\\s*\\d{1,2},\\s*\\d{4})/);
                    if (dateM) effDate = dateM[1];
                }
            }

            const priceM = text.match(/\\$(\\d+\\.\\d+)\\s+USD per pound(?![^\\n]*\\*)/);
            if (priceM) {
                domesticRate = parseFloat(priceM[1]);
            }

            if (domesticRate === null) {
                const allPrices = text.match(/\\$([\\d.]+)\\s+USD per pound/g);
                if (allPrices && allPrices.length > 0) {
                    const first = allPrices[0].match(/\\$([\\d.]+)/);
                    if (first) domesticRate = parseFloat(first[1]);
                }
            }

            if (domesticRate === null) return JSON.stringify({error: 'no domestic rate found'});
            return JSON.stringify({rate: domesticRate, eff_date: effDate});
        })()
        """
        raw = cdp_eval(ws, js_extract, msg_id=20)
    finally:
        ws.close()

    if not raw:
        return []

    data = json.loads(raw)
    if "error" in data:
        print(f"DHL extraction error: {data['error']}", file=sys.stderr)
        return []

    eff_date_str = data.get("eff_date", "")
    rate = float(data.get("rate", 0))

    if eff_date_str:
        m = re.search(r'(\w+)\s+\d{1,2}', eff_date_str)
        if m:
            try:
                month_str = m.group(1)
                year_m = re.search(r'(\d{4})', eff_date_str)
                year = int(year_m.group(1)) if year_m else datetime.now().year
                eff_dt = datetime.strptime(f"{month_str} 1, {year}", "%B %d, %Y")
                effective_date = eff_dt.strftime("%Y-%m-%d")
            except ValueError:
                eff_dt = datetime.now()
                effective_date = eff_dt.strftime("%Y-%m-%d")
        else:
            eff_dt = datetime.now()
            effective_date = eff_dt.strftime("%Y-%m-%d")
    else:
        eff_dt = datetime.now()
        effective_date = eff_dt.strftime("%Y-%m-%d")

    end_dt = calculate_end_date(eff_dt, validity_days)
    valid_to = end_dt.strftime("%Y-%m-%d")

    return [{
        "carrier": "DHL",
        "source_name": "Domestic Products",
        "rate": rate,
        "effective_date": effective_date,
        "valid_to": valid_to,
    }]


if __name__ == "__main__":
    validity_days = int(sys.argv[1]) if len(sys.argv) > 1 else -1
    if not is_last_day_of_month():
        print("[]")
        sys.exit(0)
    results = scrape_dhl_fuel_rate(validity_days)
    print(json.dumps(results, indent=2, ensure_ascii=False))
