"""对 9223 端口（SysMocap Electron）截图"""
import json, base64, sys, time, urllib.request
from websocket import create_connection

sys.stdout.reconfigure(encoding='utf-8')
OUTPUT = sys.argv[1]
EVAL_JS = sys.argv[2] if len(sys.argv) > 2 else ""

targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9223/json").read())
page_ws = next(t["webSocketDebuggerUrl"] for t in targets if t["type"] == "page")
ws = create_connection(page_ws, timeout=15, suppress_origin=True)
ws.settimeout(15)
_cid = [0]

def cmd(method, params=None, timeout=15):
    _cid[0] += 1
    ws.send(json.dumps({"id": _cid[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _cid[0]:
            return msg

cmd("Page.enable")
if EVAL_JS:
    r = cmd("Runtime.evaluate", {"expression": EVAL_JS, "returnByValue": True})
    print("EVAL:", json.dumps(r.get("result", {}).get("result", {}), ensure_ascii=False)[:2000])
r = cmd("Page.captureScreenshot", {"format": "png"}, timeout=30)
open(OUTPUT, "wb").write(base64.b64decode(r["result"]["data"]))
print("Saved:", OUTPUT)
ws.close()
