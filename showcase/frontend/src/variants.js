// 感知变体配置：mp_full 为现有 MediaPipe 基线；dash_* 仅替换 52 维回归头。
export const VARIANTS = {
  mp_full: {
    key: "mp_full",
    label: "MediaPipe Full",
    blendshapeSource: "mediapipe",
    mediapipeBlendshapes: true,
    modelUrl: null,
    modelSha256: "",
    modelBytes: 0,
    ortProvider: "",
  },
  mp_partial: {
    key: "mp_partial",
    label: "MediaPipe 478 (no blendshapes)",
    blendshapeSource: "mediapipe_landmarks",
    mediapipeBlendshapes: false,
    modelUrl: null,
    modelSha256: "",
    modelBytes: 0,
    ortProvider: "",
  },
  dash_ridge_mp478: {
    key: "dash_ridge_mp478",
    label: "DASH Ridge + MediaPipe 478",
    blendshapeSource: "ridge_onnx",
    mediapipeBlendshapes: false,
    modelUrl: "models/ridge_fp32.onnx",
    modelSha256: "9631a68b41ad2be5434fd4aeb0227aff918299351a5ba8b7f3e0d45125ca8cc8",
    modelBytes: 310451,
    ortProvider: "wasm",
  },
  dash_mlp_mp478: {
    key: "dash_mlp_mp478",
    label: "DASH MLP + MediaPipe 478",
    blendshapeSource: "mlp_onnx",
    mediapipeBlendshapes: false,
    modelUrl: "models/mlp_fp32.onnx",
    modelSha256: "91eb9aa093d302ef3d300c6f76a779bef5773793521cea5de29b0f9cd0d7b958",
    modelBytes: 1798523,
    ortProvider: "wasm",
  },
};

export const DEFAULT_VARIANT = "mp_full";

export function resolveVariant(search = (typeof location !== "undefined" ? location.search : "")) {
  const requested = new URLSearchParams(search).get("variant");
  return requested && Object.prototype.hasOwnProperty.call(VARIANTS, requested)
    ? requested
    : DEFAULT_VARIANT;
}

export function getVariant(key) {
  return VARIANTS[key] || VARIANTS[DEFAULT_VARIANT];
}
