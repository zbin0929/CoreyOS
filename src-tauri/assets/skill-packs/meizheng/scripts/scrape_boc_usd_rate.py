#!/usr/bin/env python3
import base64
import json
import os
import re
import sys
from datetime import datetime

import requests
import yaml


def load_config():
    hermes_dir = os.environ.get("HERMES_DIR", os.path.expanduser("~/.hermes"))
    config_path = os.path.join(hermes_dir, "pack-data", "meizheng", "config", "exchange-rate-config.yaml")
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://srh.bankofchina.com/search/whpj/search_cn.jsp",
    "Origin": "https://srh.bankofchina.com",
}

RATE_TYPE_MAP = {
    "现汇买入价": 1,
    "现钞买入价": 2,
    "现汇卖出价": 3,
    "现钞卖出价": 4,
    "中行折算价": 5,
}


def get_captcha_token(session, base_url):
    r = session.get(base_url + "CaptchaServlet.jsp", headers=HEADERS, timeout=15)
    r.raise_for_status()
    token = r.headers.get("Token")
    if not token:
        raise RuntimeError("No Token header in CaptchaServlet response")
    parts = token.split(".")
    if len(parts) < 2:
        raise RuntimeError(f"Invalid JWT token: {token[:50]}")
    payload = parts[1]
    padding = 4 - len(payload) % 4
    if padding != 4:
        payload += "=" * padding
    decoded = base64.urlsafe_b64decode(payload)
    data = json.loads(decoded)
    return token, data.get("code", "")


def search_rates(session, base_url, date_str, currency_name, token, captcha_code):
    data = {
        "searchDate": date_str,
        "pjname": currency_name,
        "head": "head_620.js",
        "bottom": "bottom_591.js",
        "first": "1",
        "token": token,
        "captcha": captcha_code,
    }
    r = session.post(base_url + "search_cn.jsp", data=data, headers=HEADERS, timeout=15)
    r.raise_for_status()
    if "<script>alert('" in r.text:
        alert = re.search(r"alert\('([^']+)'\)", r.text)
        raise RuntimeError(f"BOC alert: {alert.group(1) if alert else r.text[:200]}")
    return r.text


def parse_rates(html, currency_name, rate_type, earliest_time, divide_by):
    rate_type_index = RATE_TYPE_MAP.get(rate_type, 3)
    cells = re.findall(r"<td[^>]*>(.*?)</td>", html, re.DOTALL)
    cleaned = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]

    earliest_h = int(earliest_time.split(":")[0])
    earliest_m = int(earliest_time.split(":")[1])
    threshold = earliest_h * 60 + earliest_m

    last_match = None
    i = 0
    while i <= len(cleaned) - 7:
        if cleaned[i] == currency_name:
            row = cleaned[i : i + 7]
            if len(row) < 7:
                i += 1
                continue
            publish_time_str = row[6]
            if not publish_time_str:
                i += 7
                continue
            try:
                dt = datetime.strptime(publish_time_str, "%Y/%m/%d %H:%M:%S")
            except ValueError:
                i += 7
                continue
            pub_minutes = dt.hour * 60 + dt.minute
            if pub_minutes >= threshold:
                last_match = {
                    "currency": "USD",
                    "rate_raw": float(row[rate_type_index]),
                    "rate_converted": round(float(row[rate_type_index]) / divide_by, 4),
                    "rate_type": rate_type,
                    "publish_time": publish_time_str,
                    "source": "中国银行",
                }
            i += 7
        else:
            i += 1

    return last_match


def main():
    config = load_config()
    if not config.get("enabled", False):
        print(json.dumps({"error": "Exchange rate update disabled in config"}, ensure_ascii=False))
        sys.exit(0)

    source = config.get("source", {})
    conversion = config.get("conversion", {})
    page_url = source.get("url", "https://srh.bankofchina.com/search/whpj/search_cn.jsp")
    base_url = page_url.rsplit("/", 1)[0] + "/"
    currency_name = source.get("queryKeyword", "美元")
    rate_type = source.get("rateType", "现汇卖出价")
    earliest_time = source.get("earliestTime", "09:30")
    divide_by = conversion.get("divideBy", 100)

    date_str = datetime.now().strftime("%Y-%m-%d")

    s = requests.Session()
    s.headers.update(HEADERS)

    try:
        token, captcha_code = get_captcha_token(s, base_url)
        html = search_rates(s, base_url, date_str, currency_name, token, captcha_code)
        result = parse_rates(html, currency_name, rate_type, earliest_time, divide_by)

        if result is None:
            print(json.dumps({"error": f"No {currency_name} {rate_type} found after {earliest_time}"}, ensure_ascii=False))
            sys.exit(0)

        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
