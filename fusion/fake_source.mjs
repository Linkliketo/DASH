/**
 * 合成数据源：不接摄像头，直接向融合服务器注入 body(:8764) + face(:8765)，
 * 用于 10 秒验证 viewer 渲染链路是否正常（隔离"采集"与"渲染"问题）。
 */
import { WebSocket } from "ws";

const bodyWs = new WebSocket("ws://127.0.0.1:8764");
const faceWs = new WebSocket("ws://127.0.0.1:8765");

const bones = (name, x, y, z) => ({ [name]: { rotation: { x, y, z } } });
let t = 0;

function frame() {
  const arm = Math.sin(t * 2) * 0.8;      // 挥手
  const leg = Math.sin(t * 1.5) * 0.35;   // 迈腿
  const riggedPose = {
    Hips: { position: { x: 0, y: 0.05 + Math.abs(Math.sin(t)) * 0.03, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ...bones("Spine", 0, 0, 0), ...bones("Chest", 0, 0, 0),
    ...bones("Neck", 0, Math.sin(t) * 0.2, 0), ...bones("Head", 0, Math.sin(t) * 0.25, 0),
    ...bones("LeftUpperArm", 0, 0, arm), ...bones("LeftLowerArm", 0, 0, 0.3), ...bones("LeftHand", 0, 0, 0),
    ...bones("RightUpperArm", 0, 0, -arm), ...bones("RightLowerArm", 0, 0, -0.3), ...bones("RightHand", 0, 0, 0),
    ...bones("LeftUpperLeg", leg, 0, 0), ...bones("LeftLowerLeg", 0.3, 0, 0),
    ...bones("RightUpperLeg", -leg, 0, 0), ...bones("RightLowerLeg", 0.3, 0, 0),
  };
  const blink = Math.abs(Math.sin(t * 1.5)) > 0.98 ? 1 : 0;
  const face = {
    type: "miniface-frame", pts: t,
    blendshapes: [
      { categoryName: "eyeBlinkLeft", score: blink }, { categoryName: "eyeBlinkRight", score: blink },
      { categoryName: "jawOpen", score: 0.5 + 0.5 * Math.sin(t * 3) },
      { categoryName: "mouthSmileLeft", score: 0.6 }, { categoryName: "mouthSmileRight", score: 0.6 },
    ],
    headEuler: [0, 0, 0],
  };
  if (bodyWs.readyState === 1) bodyWs.send(JSON.stringify({ type: "sysmocap-body", riggedPose, riggedLeftHand: {}, riggedRightHand: {} }));
  if (faceWs.readyState === 1) faceWs.send(JSON.stringify(face));
  t += 1 / 30;
}
bodyWs.on("open", () => console.log("[fake] body -> 8764"));
faceWs.on("open", () => console.log("[fake] face -> 8765"));
setInterval(frame, 33);
console.log("[fake] synthetic source running (挥手+眨眼+张嘴). Ctrl+C to stop.");
