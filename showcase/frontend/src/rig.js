// 骨骼驱动层：Kalidokit（规则式 IK）landmarks → VRM 骨骼旋转。
// 骨骼映射表照搬自已验证的 viewer/index.html。
// 注意：kalidokit.es.js 的导出名是 Pose / Hand（不是 PoseSolver / HandSolver）。
import { Hand, Pose } from "../vendor/kalidokit.es.js";

const BONES = {
  Hips: "hips",
  Spine: "spine",
  Chest: "chest",
  Neck: "neck",
  Head: "head",
  LeftUpperArm: "leftUpperArm",
  LeftLowerArm: "leftLowerArm",
  LeftHand: "leftHand",
  RightUpperArm: "rightUpperArm",
  RightLowerArm: "rightLowerArm",
  RightHand: "rightHand",
  LeftUpperLeg: "leftUpperLeg",
  LeftLowerLeg: "leftLowerLeg",
  RightUpperLeg: "rightUpperLeg",
  RightLowerLeg: "rightLowerLeg",
};

const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"];

function handMap(side) {
  const m = { [side + "Wrist"]: side === "Left" ? "leftHand" : "rightHand" };
  for (const f of FINGERS) {
    for (const s of ["Proximal", "Intermediate", "Distal"]) {
      m[side + f + s] = (side === "Left" ? "left" : "right") + f + s;
    }
  }
  return m;
}
const HAND_LEFT = handMap("Left");
const HAND_RIGHT = handMap("Right");

// flat [x,y,z(,visibility)...] → Kalidokit 需要的 [{x,y,z,...}]
function toPoints(flat, stride) {
  if (!flat) return null;
  const out = [];
  for (let i = 0; i + stride <= flat.length; i += stride) {
    const p = { x: flat[i], y: flat[i + 1], z: flat[i + 2] };
    if (stride === 4) p.visibility = flat[i + 3];
    out.push(p);
  }
  return out;
}

function setBone(node, rot) {
  if (!node || !rot) return;
  node.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
  node.quaternion.setFromEuler(node.rotation);
}

export class Rig {
  constructor(vrm) {
    this.vrm = vrm;
  }

  _bone(name) {
    return this.vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  }

  // poseImage / poseWorld: flat 33×4（契约 v2）
  applyPose(poseImageFlat, poseWorldFlat) {
    const image = toPoints(poseImageFlat, 4);
    const world = toPoints(poseWorldFlat, 4);
    if (!image || !world || !this.vrm) return;
    // 低可见度的垃圾姿态会让网格炸成刺球：整帧丢弃，保持上一帧好姿态
    const meanVis =
      image.reduce((s, p) => s + (p.visibility ?? 1), 0) / image.length;
    if (meanVis < 0.4) return;
    const rigged = Pose.solve(world, image, { runtime: "mediapipe" });
    if (!rigged) return;
    if (rigged.Hips?.position) {
      const p = rigged.Hips.position;
      this.vrm.scene.position.set(-p.x, p.y + 0.05, -p.z);
    }
    for (const [key, boneName] of Object.entries(BONES)) {
      const part = rigged[key];
      if (part) setBone(this._bone(boneName), part.rotation || part);
    }
  }

  // hands: {left: flat 21×3 | null, right: flat 21×3 | null}
  applyHands(hands) {
    if (!hands || !this.vrm) return;
    for (const [side, map] of [["left", HAND_LEFT], ["right", HAND_RIGHT]]) {
      const pts = toPoints(hands[side], 3);
      if (!pts) continue;
      const kalidoSide = side === "left" ? "Left" : "Right";
      const rigged = Hand.solve(pts, kalidoSide);
      if (!rigged) continue;
      for (const [key, boneName] of Object.entries(map)) {
        const part = rigged[key];
        if (part) setBone(this._bone(boneName), part.rotation || part);
      }
    }
  }
}
