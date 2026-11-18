// 浏览器内感知层：MediaPipe Tasks JS FaceLandmarker。
// 与 Python 后端是同一模型（face_landmarker.task），输出对齐现有 applyFrame 契约：
//   { blendshapes: [{categoryName, score}], landmarks: [{x,y,z}×478], headEuler: {x,y,z} }
// headEuler 来自 Tasks JS 的 facialTransformationMatrixes（4x4 变换矩阵），
// 比服务端的 solvePnP 近似更准。
import { FaceLandmarker, FilesetResolver } from "../vendor/vision/vision_bundle.mjs?v=26";
import { BLENDSHAPE_NAMES } from "./blendshapes.js?v=26";

let _fileset = null;
let _ortPromise = null;

async function fileset() {
  if (!_fileset) {
    _fileset = await FilesetResolver.forVisionTasks("vendor/vision/wasm");
  }
  return _fileset;
}

// modelBuffer: Uint8Array（modelstore 下载/缓存的 .task 内容）
export async function createFaceLandmarker(modelBuffer, runningMode, options = {}) {
  const fs = await fileset();
  return FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetBuffer: modelBuffer, delegate: "CPU" },
    runningMode, // "VIDEO" | "IMAGE"
    numFaces: 1,
    outputFaceBlendshapes: options.outputBlendshapes !== false,
    outputFacialTransformationMatrixes: true,
  });
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("浏览器不支持 SHA-256 校验");
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getOrt() {
  if (globalThis.ort) return globalThis.ort;
  if (!_ortPromise) {
    _ortPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("../vendor/ort/ort.wasm.min.js", import.meta.url).href;
      script.onload = () => {
        const ort = globalThis.ort;
        if (!ort) return reject(new Error("onnxruntime-web 加载失败"));
        ort.env.wasm.wasmPaths = new URL("../vendor/ort/", import.meta.url).href;
        ort.env.wasm.numThreads = 1;
        resolve(ort);
      };
      script.onerror = () => reject(new Error("onnxruntime-web 脚本加载失败"));
      document.head.appendChild(script);
    });
  }
  return _ortPromise;
}

// 只会加载 52 维回归头的 ONNX。landmarks 仍由 MediaPipe 提供。
export async function loadOnnxVariant(variant) {
  if (!variant?.modelUrl) return null;
  const t0 = performance.now();
  const ort = await getOrt();
  const resp = await fetch(variant.modelUrl, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`ONNX 模型加载失败：HTTP ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength !== variant.modelBytes) {
    throw new Error(`ONNX 模型大小不匹配：${buffer.byteLength} != ${variant.modelBytes}`);
  }
  const sha256 = await sha256Hex(buffer);
  if (sha256 !== variant.modelSha256) {
    throw new Error(`ONNX 模型 SHA-256 不匹配：${sha256}`);
  }
  const session = await ort.InferenceSession.create(new Uint8Array(buffer), {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return {
    session,
    ort,
    provider: "wasm",
    sha256,
    modelLoadMs: Math.round((performance.now() - t0) * 10) / 10,
  };
}

function flattenLandmarks(landmarks) {
  if (!landmarks || landmarks.length !== 478) {
    throw new Error(`ONNX 输入需要 478 个 landmarks，实际 ${landmarks?.length ?? 0}`);
  }
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    const p = landmarks[i];
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}

// 异步感知：MediaPipe 负责 landmarks/头姿；变体用 ONNX 替换 52 维回归头。
export async function detectFrame({ landmarker, runtime, variant, media, mode = "video", ts = performance.now() }) {
  const t0 = performance.now();
  const result = mode === "image"
    ? landmarker.detect(media)
    : landmarker.detectForVideo(media, ts);
  const perceptionMs = performance.now() - t0;
  const base = toFrame(result);
  if (!base) return { frame: null, perceptionMs, onnxMs: 0 };
  if (!runtime || variant?.blendshapeSource === "mediapipe") {
    return { frame: base, perceptionMs, onnxMs: 0 };
  }
  const input = flattenLandmarks(base.landmarks);
  const tensor = new runtime.ort.Tensor("float32", input, [1, 1434]);
  const t1 = performance.now();
  const output = await runtime.session.run({ landmarks: tensor });
  const t2 = performance.now();
  const data = output.blendshapes?.data;
  if (!data || data.length !== 52) {
    throw new Error(`ONNX 输出维度错误：${data?.length ?? 0}`);
  }
  const blendshapes = BLENDSHAPE_NAMES.map((name, i) => ({
    categoryName: name,
    score: Math.max(0, Math.min(1, Number(data[i]) || 0)),
  }));
  return {
    frame: { ...base, blendshapes },
    perceptionMs,
    onnxMs: t2 - t1,
  };
}

// 4x4 列主序变换矩阵 → 头部欧拉角（度）
function eulerFromMatrix(data) {
  if (!data || data.length < 16) return null;
  const deg = 180 / Math.PI;
  return {
    x: Math.atan2(data[6], data[10]) * deg,
    y: Math.atan2(-data[2], Math.hypot(data[0], data[1])) * deg,
    z: Math.atan2(data[1], data[0]) * deg,
  };
}

// Tasks JS 结果 → 前端通用帧格式；无人脸返回 null
export function toFrame(result) {
  const face = result?.faceLandmarks?.[0];
  if (!face) return null;
  return {
    blendshapes: result.faceBlendshapes?.[0]?.categories ?? null,
    landmarks: face,
    headEuler: eulerFromMatrix(result.facialTransformationMatrixes?.[0]?.data),
  };
}

// 视频逐帧批处理：拖动 playhead 逐点采样。stride 为采样间隔毫秒（默认 15 FPS）。
export async function processVideo(video, landmarker, onProgress, strideMs = 66, options = {}) {
  const frames = [];
  const durationMs = video.duration * 1000;
  const total = Math.ceil(durationMs / strideMs);
  video.pause();
  const seeked = () => new Promise((r) => video.addEventListener("seeked", r, { once: true }));
  for (let t = 0, i = 0; t < durationMs; t += strideMs, i++) {
    video.currentTime = t / 1000;
    await seeked();
    const got = options.detectFrame
      ? await options.detectFrame(video, "video", Math.round(t))
      : { frame: toFrame(landmarker.detectForVideo(video, Math.round(t))), perceptionMs: 0, onnxMs: 0 };
    const frame = got.frame;
    const item = {
      frame: i,
      timestampMs: Math.round(t),
      ok: !!frame,
      perceptionMs: got.perceptionMs || 0,
      onnxMs: got.onnxMs || 0,
    };
    if (frame) {
      item.blendshapes = frame.blendshapes;
      item.landmarks = frame.landmarks;
      item.headEuler = frame.headEuler;
    }
    frames.push(item);
    if (onProgress) onProgress(frames.length, total);
  }
  return frames;
}
