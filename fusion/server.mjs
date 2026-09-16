/**
 * DASH V0 融合服务器
 * 输入1: SysMocap 转发（socket.io, 默认 :8080, 事件 "message",
 *         数据 { type:"xf-sysmocap-data", riggedPose, riggedLeftHand, riggedRightHand, riggedFace }）
 * 输入2: miniface WebSocket 推送（:8765, { type:"miniface-frame", pts, blendshapes, headEuler }）
 * 输出:  融合流 WebSocket :8766，广播 { type:"dash-v0-fused", pts, syncErrorMs, body, face }
 * 每 2 秒打印两路 FPS 与同步误差统计。
 */
import { io } from "socket.io-client";
import { WebSocketServer } from "ws";

const SYSMOCAP_URL = process.env.SYSMOCAP_URL || "http://127.0.0.1:8080";
const MINIFACE_PORT = 8765;
const OUT_PORT = 8766;

let lastBody = null;   // SysMocap 最新一帧
let lastFace = null;   // miniface 最新一帧
let bodyCount = 0, faceCount = 0, fusedCount = 0;

// ---- 输入1: SysMocap (socket.io client) ----
const sock = io(SYSMOCAP_URL, { reconnectionDelayMax: 3000 });
sock.on("connect", () => console.log("[fusion] SysMocap connected:", SYSMOCAP_URL));
sock.on("connect_error", () => {}); // 等待 SysMocap 开启转发
sock.on("message", (data) => {
  try {
    const d = typeof data === "string" ? JSON.parse(data) : data;
    if (d && d.type === "xf-sysmocap-data") {
      lastBody = { ...d, _recvAt: Date.now() };
      bodyCount++;
    }
  } catch {}
});

// ---- 输入1b: 合成测试 body (ws :8764，用于无摄像头验证渲染链路) ----
const fakeWss = new WebSocketServer({ port: 8764 });
fakeWss.on("connection", (ws) => ws.on("message", (buf) => {
  try {
    const d = JSON.parse(buf.toString());
    if (d.type === "sysmocap-body") { lastBody = { ...d, _recvAt: Date.now() }; bodyCount++; }
  } catch {}
}));

// ---- 输入2: miniface (WebSocket server) ----
const wssIn = new WebSocketServer({ port: MINIFACE_PORT });
wssIn.on("connection", (ws) => {
  console.log("[fusion] miniface connected on", MINIFACE_PORT);
  ws.on("message", (buf) => {
    try {
      const d = JSON.parse(buf.toString());
      if (d.type === "miniface-frame") {
        lastFace = { ...d, _recvAt: Date.now() };
        faceCount++;
      }
    } catch {}
  });
});

// ---- 输出: 融合广播 ----
const wssOut = new WebSocketServer({ port: OUT_PORT });
wssOut.on("connection", (ws) => console.log("[fusion] downstream client connected on", OUT_PORT));

function broadcastFused() {
  if (!lastBody && !lastFace) return;
  const syncErrorMs =
    lastBody && lastFace ? Math.abs(lastBody._recvAt - lastFace._recvAt) : null;
  const freshFace = lastFace && (Date.now() - lastFace._recvAt < 2000) ? lastFace : null;
  const pkt = JSON.stringify({
    type: "dash-v0-fused",
    pts: Date.now() / 1000,
    syncErrorMs,
    body: lastBody
      ? { riggedPose: lastBody.riggedPose, riggedLeftHand: lastBody.riggedLeftHand, riggedRightHand: lastBody.riggedRightHand }
      : null,
    face: freshFace
      ? { blendshapes: freshFace.blendshapes, headEuler: freshFace.headEuler }
      : (lastBody?.riggedFace ? { riggedFace: lastBody.riggedFace } : null),
  });
  for (const c of wssOut.clients) if (c.readyState === 1) c.send(pkt);
  fusedCount++;
}
setInterval(broadcastFused, 33); // ~30Hz 融合输出

// ---- 统计 ----
setInterval(() => {
  console.log(
    `[stats] body ${bodyCount / 2} FPS | face ${faceCount / 2} FPS | fused ${fusedCount / 2} FPS | syncErr ${
      lastBody && lastFace ? Math.abs(lastBody._recvAt - lastFace._recvAt) + "ms" : "n/a"
    }`
  );
  bodyCount = faceCount = fusedCount = 0;
}, 2000);

console.log(`[fusion] listening: miniface ws://0.0.0.0:${MINIFACE_PORT}, out ws://0.0.0.0:${OUT_PORT}, sysmocap ${SYSMOCAP_URL}, fake-body ws://0.0.0.0:8764`);
