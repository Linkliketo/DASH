"""CDP 截图工具：打开指定 URL，等待渲染后截图并抓取 console 错误"""
import json, base64, sys, time, urllib.request
from websocket import create_connection

sys.stdout.reconfigure(encoding='utf-8')

URL = sys.argv[1]
OUTPUT = sys.argv[2]
WAIT = float(sys.argv[3]) if len(sys.argv) > 3 else 8
EVAL_JS = sys.argv[4] if len(sys.argv) > 4 else ""

targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read())
page_ws = None
for t in targets:
    if t["type"] == "page" and "about:blank" in t.get("url", ""):
        page_ws = t["webSocketDebuggerUrl"]; break
if not page_ws:
    for t in targets:
        if t["type"] == "page" and not t.get("url", "").startswith(("chrome://", "devtools://")):
            page_ws = t["webSocketDebuggerUrl"]; break
if not page_ws:
    print("No page target"); sys.exit(1)

ws = create_connection(page_ws, timeout=15)
ws.settimeout(15)
_cid = [0]
logs = []

def cmd(method, params=None, timeout=15):
    _cid[0] += 1
    ws.send(json.dumps({"id": _cid[0], "method": method, "params": params or {}}))
    end = time.time() + timeout
    while time.time() < end:
        msg = json.loads(ws.recv())
        if msg.get("method") in ("Runtime.consoleAPICalled", "Log.entryAdded"):
            logs.append(json.dumps(msg)[:300])
        if msg.get("id") == _cid[0]:
            return msg
    raise TimeoutError(method)

cmd("Page.enable")
cmd("Runtime.enable")
cmd("Log.enable")
cmd("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
cmd("Page.navigate", {"url": URL})
time.sleep(WAIT)

if EVAL_JS:
    r = cmd("Runtime.evaluate", {"expression": EVAL_JS, "returnByValue": True})
    print("EVAL:", json.dumps(r.get("result", {}).get("result", {}), ensure_ascii=False)[:2000])

r = cmd("Page.captureScreenshot", {"format": "png"}, timeout=30)
open(OUTPUT, "wb").write(base64.b64decode(r["result"]["data"]))
print("Saved:", OUTPUT)
errs = [l for l in logs if "error" in l.lower() or "exception" in l.lower()]
print("Console errors:", len(errs))
for e in errs[:5]: print(" ", e[:250])
ws.close()
