"""默认后端：MediaPipe FaceLandmarker（face_landmarker.task）。

复用 deploy/02_realtime.py 已跑通的链路（VIDEO 模式，单人脸，
478 关键点 + 52 BlendShape），在其上补两件事：
1. 输出归一到 contract 契约（camelCase、固定顺序）；
2. 用 solvePnP 从 6 个关键点估计头部欧拉角，补齐 miniface 契约里的 headEuler。
"""
from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np

from ..contract import blendshapes_to_array
from .base import BackendInfo, FaceResult

REPO_ROOT = Path(__file__).resolve().parents[3]  # showcase/backend/perception -> 仓库根
DEFAULT_MODEL_PATH = REPO_ROOT / "models" / "face_landmarker.task"
ENV_MODEL_PATH = "DASH_FACE_TASK"  # 环境变量可覆盖模型路径

# solvePnP 用的 6 个参考点：鼻尖 / 下巴 / 左右外眼角 / 左右嘴角，
# 3D 坐标是通用头部模型（毫米量级），只用于显示，不是精确测量。
_POSE_LANDMARK_IDS = (1, 152, 263, 33, 287, 57)
_POSE_MODEL_POINTS = np.array(
    [
        (0.0, 0.0, 0.0),          # 鼻尖
        (0.0, -330.0, -65.0),     # 下巴
        (-225.0, 170.0, -135.0),  # 左眼外眼角
        (225.0, 170.0, -135.0),   # 右眼外眼角
        (-150.0, -150.0, -125.0), # 左嘴角
        (150.0, -150.0, -125.0),  # 右嘴角
    ],
    dtype=np.float64,
)


def default_model_path() -> Path:
    return Path(os.environ.get(ENV_MODEL_PATH, str(DEFAULT_MODEL_PATH)))


def info() -> BackendInfo:
    path = default_model_path()
    ok = path.is_file()
    return BackendInfo(
        name=MediaPipeTaskBackend.name,
        description="MediaPipe FaceLandmarker (.task)，478 关键点 + 52 BlendShape",
        available=ok,
        reason="" if ok else f"model file not found: {path} (可用环境变量 {ENV_MODEL_PATH} 指定)",
    )


def estimate_head_euler(landmarks: np.ndarray, width: int, height: int) -> dict | None:
    """由 478 个归一化关键点估计头部欧拉角（度）。失败时返回 None。

    landmarks: (478, 3)，x/y 归一化到 [0,1]。返回 {"x","y","z"}，
    符号约定依赖通用 3D 模型，仅供皮套人头部跟随显示。
    """
    try:
        image_points = np.array(
            [[landmarks[i][0] * width, landmarks[i][1] * height] for i in _POSE_LANDMARK_IDS],
            dtype=np.float64,
        )
        focal = float(width)
        camera_matrix = np.array(
            [[focal, 0.0, width / 2.0], [0.0, focal, height / 2.0], [0.0, 0.0, 1.0]],
            dtype=np.float64,
        )
        ok, rvec, _tvec = cv2.solvePnP(
            _POSE_MODEL_POINTS, image_points, camera_matrix, None, flags=cv2.SOLVEPNP_ITERATIVE
        )
        if not ok:
            return None
        rmat, _ = cv2.Rodrigues(rvec)
        angles, *_ = cv2.RQDecomp3x3(rmat)
        return {"x": float(angles[0]), "y": float(angles[1]), "z": float(angles[2])}
    except Exception:
        return None


class MediaPipeTaskBackend:
    """FaceLandmarker VIDEO 模式封装。mediapipe 延迟到构造时导入，
    这样只查询注册表（/api/backends）时不必付出导入代价。"""

    name = "mediapipe-task"

    def __init__(self, model_path: str | os.PathLike | None = None, num_faces: int = 1):
        import mediapipe as mp

        path = Path(model_path) if model_path else default_model_path()
        if not path.is_file():
            raise RuntimeError(f"model file not found: {path}")
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(path)),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_faces=num_faces,
            output_face_blendshapes=True,
        )
        self._mp = mp
        self._landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        self._last_ts = -1

    def process_frame(self, rgb: np.ndarray, timestamp_ms: int) -> FaceResult | None:
        # VIDEO 模式要求时间戳严格递增；同一实例处理多个来源（照片/视频/摄像头）
        # 时外部时间戳可能回退，这里统一兜底。
        timestamp_ms = int(max(self._last_ts + 1, int(timestamp_ms)))
        self._last_ts = timestamp_ms
        image = self._mp.Image(
            image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)
        )
        result = self._landmarker.detect_for_video(image, timestamp_ms)
        if not result.face_landmarks:
            return None
        if result.face_blendshapes:
            blendshapes = blendshapes_to_array(result.face_blendshapes[0])
        else:
            blendshapes = np.zeros(52, dtype=np.float32)
        landmarks = np.array(
            [[p.x, p.y, p.z] for p in result.face_landmarks[0]], dtype=np.float32
        )
        h, w = rgb.shape[:2]
        return FaceResult(
            blendshapes=blendshapes,
            landmarks=landmarks,
            head_euler=estimate_head_euler(landmarks, w, h),
        )

    def close(self) -> None:
        self._landmarker.close()
