"""自训蒸馏网络后端：MediaPipe 提 478 关键点 -> 自产 ONNX 网络回归 52 BlendShape。

这是给 Task 6 蒸馏 MLP（1434 -> 256 -> 256 -> 52）预留的后端插槽：
.face_landmarker.task 仍然使用，但只作为关键点提取器（关闭 BlendShape 子图），
真正产生 BlendShape 的是我们自己的 ONNX 模型 —— 这正是"替换 face_blendshapes.tflite"
的技术路线在 demo 层的落点。

按 Task 6 的设计决策，标准化（按轴变换）已通过 register_buffer 烘进 ONNX 图，
所以这里直接喂原始关键点，不做任何预处理。
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from .base import BackendInfo, FaceResult
from .mediapipe_backend import (
    REPO_ROOT,
    default_model_path,
    estimate_head_euler,
)

DEFAULT_ONNX_PATH = REPO_ROOT / "models" / "blendshape_mlp.onnx"
ENV_ONNX_PATH = "DASH_BLENDSHAPE_ONNX"  # 环境变量可覆盖 ONNX 路径

EXPECTED_INPUT_DIM = 478 * 3  # 1434，与设计文档的数据契约 X(1500,1434) 一致


def default_onnx_path() -> Path:
    return Path(os.environ.get(ENV_ONNX_PATH, str(DEFAULT_ONNX_PATH)))


def info() -> BackendInfo:
    task_ok = default_model_path().is_file()
    onnx_path = default_onnx_path()
    onnx_ok = onnx_path.is_file()
    missing = []
    if not task_ok:
        missing.append(f"landmark 提取器 {default_model_path()}")
    if not onnx_ok:
        missing.append(f"ONNX 模型 {onnx_path} (可用环境变量 {ENV_ONNX_PATH} 指定)")
    return BackendInfo(
        name=OnnxDistilledBackend.name,
        description="自训蒸馏 MLP（1434 关键点 -> 52 BlendShape，ONNX 推理）",
        available=task_ok and onnx_ok,
        reason="" if (task_ok and onnx_ok) else "missing: " + "; ".join(missing),
    )


class OnnxDistilledBackend:
    name = "onnx-distilled"

    def __init__(
        self,
        task_path: str | os.PathLike | None = None,
        onnx_path: str | os.PathLike | None = None,
        num_faces: int = 1,
    ):
        import mediapipe as mp
        import onnxruntime as ort

        task = Path(task_path) if task_path else default_model_path()
        onnx = Path(onnx_path) if onnx_path else default_onnx_path()
        for p in (task, onnx):
            if not p.is_file():
                raise RuntimeError(f"model file not found: {p}")
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(task)),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_faces=num_faces,
            output_face_blendshapes=False,  # 只提关键点，BlendShape 由 ONNX 网络回归
        )
        self._mp = mp
        self._landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        self._session = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name
        self._last_ts = -1

    def process_frame(self, rgb: np.ndarray, timestamp_ms: int) -> FaceResult | None:
        timestamp_ms = int(max(self._last_ts + 1, int(timestamp_ms)))
        self._last_ts = timestamp_ms
        image = self._mp.Image(
            image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)
        )
        result = self._landmarker.detect_for_video(image, timestamp_ms)
        if not result.face_landmarks:
            return None
        landmarks = np.array(
            [[p.x, p.y, p.z] for p in result.face_landmarks[0]], dtype=np.float32
        )
        features = landmarks.reshape(1, -1)
        if features.shape[1] != EXPECTED_INPUT_DIM:
            raise RuntimeError(
                f"landmark dim mismatch: expected {EXPECTED_INPUT_DIM}, got {features.shape[1]}"
            )
        scores = self._session.run(None, {self._input_name: features})[0]
        # 网络无输出激活（Task 6 决策），数值可能略出界，裁剪到契约范围
        blendshapes = np.clip(np.asarray(scores, dtype=np.float32).reshape(-1), 0.0, 1.0)
        h, w = rgb.shape[:2]
        return FaceResult(
            blendshapes=blendshapes,
            landmarks=landmarks,
            head_euler=estimate_head_euler(landmarks, w, h),
        )

    def close(self) -> None:
        self._landmarker.close()
