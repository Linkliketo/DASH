// 派生指标：pose/hand landmarks → 少量可读数值（读数条的骨骼组与手部组）。
// 全部归一到 [0,1]，纯前端计算，后端保持纯感知层。

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function p2(flat, i, stride) {
  return { x: flat[i * stride], y: flat[i * stride + 1] };
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 向量 (dx,dy) 与目标方向 (tx,ty) 的夹角（度）
function angleDeg(dx, dy, tx, ty) {
  const n = Math.hypot(dx, dy) * Math.hypot(tx, ty);
  if (!n) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (dx * tx + dy * ty) / n))) * 180) / Math.PI;
}

// pose image landmarks（MediaPipe 33 点，图像归一化坐标，y 向下）
// 11/13/15 = 左肩/肘/腕，12/14/16 = 右肩/肘/腕，23/24 = 左右髋
export function poseMetrics(poseImage) {
  if (!poseImage) return null;
  const lS = p2(poseImage, 11, 4), rS = p2(poseImage, 12, 4);
  const lE = p2(poseImage, 13, 4), rE = p2(poseImage, 14, 4);
  const lW = p2(poseImage, 15, 4), rW = p2(poseImage, 16, 4);
  const lH = p2(poseImage, 23, 4), rH = p2(poseImage, 24, 4);

  // 肩抬：上臂与「垂下」方向 (0,1) 的夹角，0=垂下 90=平举 180=举过头顶
  const shoulderLiftL = clamp01(angleDeg(lE.x - lS.x, lE.y - lS.y, 0, 1) / 180);
  const shoulderLiftR = clamp01(angleDeg(rE.x - rS.x, rE.y - rS.y, 0, 1) / 180);
  // 肘弯：上臂与前臂夹角，180=伸直 → curl 0，90=直角 → curl 0.5
  const elbowCurlL = clamp01(1 - angleDeg(lE.x - lS.x, lE.y - lS.y, lW.x - lE.x, lW.y - lE.y) / 180);
  const elbowCurlR = clamp01(1 - angleDeg(rE.x - rS.x, rE.y - rS.y, rW.x - rE.x, rW.y - rE.y) / 180);
  // 躯干倾角：髋中点→肩中点 与竖直向上 (0,-1) 的夹角
  const spineLean = clamp01(
    angleDeg((lS.x + rS.x) / 2 - (lH.x + rH.x) / 2, (lS.y + rS.y) / 2 - (lH.y + rH.y) / 2, 0, -1) / 90
  );
  return { shoulderLiftL, shoulderLiftR, elbowCurlL, elbowCurlR, spineLean };
}

// hand landmarks（21 点）：0=腕，5/9/13/17=四指根，8/12/16/20=四指尖
function fingerCurl(hand, tip, mcp, stride) {
  const w = p2(hand, 0, stride);
  const t = p2(hand, tip, stride);
  const m = p2(hand, mcp, stride);
  const palm = dist2(m, w);
  if (!palm) return 0;
  const ratio = dist2(t, w) / palm; // 伸直约 1.9，蜷曲约 0.9
  return clamp01(1.9 - ratio);
}

export function handMetrics(hand /* flat 21×3 */) {
  if (!hand) return null;
  const index = fingerCurl(hand, 8, 5, 3);
  const fist =
    (fingerCurl(hand, 8, 5, 3) +
      fingerCurl(hand, 12, 9, 3) +
      fingerCurl(hand, 16, 13, 3) +
      fingerCurl(hand, 20, 17, 3)) /
    4;
  return { indexCurl: index, fist };
}
