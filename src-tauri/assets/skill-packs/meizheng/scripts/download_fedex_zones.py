#!/usr/bin/env python3
import sys, os, time, subprocess

def run_js(js_code, timeout=10):
    script = f'''
    tell application "Google Chrome"
        tell active tab of front window
            execute javascript "{js_code}"
        end tell
    end tell
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    return result.stdout.strip(), result.stderr.strip()

def run_apple_script(script, timeout=30):
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    return result.stdout.strip(), result.stderr.strip(), result.returncode

def download_fedex_zone(zip3, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    zip5 = f"{zip3}01"

    print("Opening FedEx...", file=sys.stderr)
    run_apple_script("""
        tell application "Google Chrome"
            if (count of windows) = 0 then
                make new window
            end if
            tell front window
                make new tab with properties {URL:"https://www.fedex.com/ratetools/RateToolsMain.do"}
            end tell
            activate
        end tell
    """)

    print("Waiting for page...", file=sys.stderr)
    time.sleep(20)

    title, _, _ = run_apple_script("""
        tell application "Google Chrome"
            return title of active tab of front window
        end tell
    """)
    print(f"Title: {title}", file=sys.stderr)

    if "System Down" in title or "Denied" in title:
        print("BLOCKED!", file=sys.stderr)
        return None

    # Debug: check page state
    state, _ = run_js("document.getElementById('maincontent') ? document.getElementById('maincontent').className : 'NO_MAINCONTENT'")
    print(f"maincontent class: {state}", file=sys.stderr)

    state2, _ = run_js("document.getElementById('yes') ? document.getElementById('yes').checked : 'NO_YES'")
    print(f"yes checked: {state2}", file=sys.stderr)

    state3, _ = run_js("document.getElementById('domesticradio') ? document.getElementById('domesticradio').checked : 'NO_DOM'")
    print(f"domestic checked: {state3}", file=sys.stderr)

    state4, _ = run_js("document.getElementById('zipFromAdd') ? document.getElementById('zipFromAdd').value : 'NO_ZIP'")
    print(f"zip value: {state4}", file=sys.stderr)

    # Try clicking Yes label instead of radio (triggers jQuery)
    print("Clicking Yes label...", file=sys.stderr)
    run_js("var lbl = document.querySelector('label.radio'); if(lbl && lbl.textContent.indexOf('Yes')>-1) lbl.click();")
    time.sleep(3)

    state2b, _ = run_js("document.getElementById('yes') ? document.getElementById('yes').checked : 'NO'")
    print(f"yes checked after click: {state2b}", file=sys.stderr)

    # If still not checked, try the input directly with focus
    if state2b != "true":
        print("Forcing yes via input click...", file=sys.stderr)
        run_js("var r=document.getElementById('yes'); r.focus(); r.click();")
        time.sleep(2)

    # Click Domestic label
    print("Clicking Domestic label...", file=sys.stderr)
    run_js("var labels=document.querySelectorAll('label.radio'); for(var i=0;i<labels.length;i++){if(labels[i].textContent.indexOf('Domestic')>-1) labels[i].click();}")
    time.sleep(3)

    state3b, _ = run_js("document.getElementById('domesticradio') ? document.getElementById('domesticradio').checked : 'NO'")
    print(f"domestic checked after click: {state3b}", file=sys.stderr)

    # Check if ZIP input is visible now
    state5, _ = run_js("var z=document.getElementById('zipFromAdd'); return z ? (z.offsetParent !== null ? 'VISIBLE' : 'HIDDEN') : 'NOT_FOUND';")
    print(f"zip visibility: {state5}", file=sys.stderr)

    if "HIDDEN" in state5:
        print("ZIP still hidden, unblocking all...", file=sys.stderr)
        run_js("document.querySelectorAll('.fx-hidden').forEach(function(el){el.classList.remove('fx-hidden');});")
        time.sleep(1)

    # Fill ZIP via keyboard simulation
    print(f"Typing ZIP {zip5} via keyboard...", file=sys.stderr)
    run_js("document.getElementById('zipFromAdd').focus();")
    time.sleep(0.5)
    run_apple_script(f"""
        tell application "Google Chrome"
            activate
            delay 0.5
        end tell
        tell application "System Events"
            keystroke "{zip5}"
        end tell
    """)
    time.sleep(2)

    state6, _ = run_js("document.getElementById('zipFromAdd') ? document.getElementById('zipFromAdd').value : 'NO'")
    print(f"zip value after typing: {state6}", file=sys.stderr)

    # Set format and enable button
    run_js("var h=document.querySelector('input[name=\\\"zoneLocatorFormat\\\"]');if(h)h.value='excel';")
    run_js("var b=document.getElementById('domesticbtn');if(b){b.classList.remove('fx-disabled');b.classList.add('fx-btn-primary');}")

    btn_state, _ = run_js("document.getElementById('domesticbtn') ? document.getElementById('domesticbtn').className : 'NO'")
    print(f"button class: {btn_state}", file=sys.stderr)

    # Submit
    print("Submitting form...", file=sys.stderr)
    run_js("document.rateToolsMainForm.method.value='GetZoneLocators';document.rateToolsMainForm.action='/ratetools/RateToolsMain.do';document.rateToolsMainForm.target='_self';document.rateToolsMainForm.submit();")

    print("Waiting 40s for file generation...", file=sys.stderr)
    time.sleep(40)

    fname, _ = run_js("var f=document.querySelector('input[name=\\\"downloadFileName\\\"]');return f?f.value:'';")
    print(f"downloadFileName: [{fname}]", file=sys.stderr)

    if fname:
        print(f"File ready! Triggering download...", file=sys.stderr)
        run_js("document.rateToolsMainForm.action='/ratetools/DownloadRates.do';document.rateToolsMainForm.target='_self';document.rateToolsMainForm.submit();")
        time.sleep(15)
        print("Check ~/Downloads/ for the file.", file=sys.stderr)
        return "CHECK_DOWNLOADS"
    else:
        print("File not generated. Checking page state...", file=sys.stderr)
        page_text, _ = run_js("document.body ? document.body.innerText.substring(0,500) : 'NO BODY'")
        print(f"Page text: {page_text[:300]}", file=sys.stderr)
        return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip3", default="910")
    parser.add_argument("--output-dir", default=os.path.expanduser("~/Desktop"))
    args = parser.parse_args()
    result = download_fedex_zone(args.zip3, args.output_dir)
    if result:
        print(f"RESULT: {result}")
    else:
        print("FAILED")
        sys.exit(1)
