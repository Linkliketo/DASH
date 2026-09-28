"""B 版本后端：FaceLandmarker + PoseLandmarker + HandLandmarker 三模型串联。

只输出原始 landmarks（图像坐标 + 世界坐标）与 BlendShape——骨骼 IK（Kalidokit）
在前端做，后端保持纯感知层。

性能：face ~12ms + pose(lite) ~5ms + hand ~8ms 串行约 25ms/帧。heavy_stride > 1 时
pose/hands 隔帧推理并复用上次结果，face 保持每帧（流畅度优先）。
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

DEFAULT_POSE_PATH = REPO_ROOT / "models" / "pose_landmarker_lite.task"
DEFAULT_HAND_PATH = REPO_ROOT / "models" / "hand_landmarker.task"
ENV_POSE_PATH = "DASH_POSE_TASK"
ENV_HAND_PATH = "DASH_HAND_TASK"


def default_pose_path() -> Path:
    return Path(os.environ.get(ENV_POSE_PATH, str(DEFAULT_POSE_PATH)))


def default_hand_path() -> Path:
    return Path(os.environ.get(ENV_HAND_PATH, str(DEFAULT_HAND_PATH)))


def info() -> BackendInfo:
    missing = [
        f"{p} (可用环境变量 {env} 指定)"
        for p, env in [
            (default_model_path(), "DASH_FACE_TASK"),
            (default_pose_path(), ENV_POSE_PATH),
            (default_hand_path(), ENV_HAND_PATH),
        ]
        if not p.is_file()
    ]
    return BackendInfo(
        name=MediaPipeFullBackend.name,
        description="B 版本：面部 + 全身骨骼 + 手部（Face/Pose/Hand 三模型串联）",
        available=not missing,
        reason="" if not missing else "missing: " + "; ".join(missing),
    )


class MediaPipeFullBackend:
    name = "mediapipe-full"

    def __init__(
        self,
        face_task: str | os.PathLike | None = None,
        pose_task: str | os.PathLike | None = None,
        hand_task: str | os.PathLike | None = None,
        num_faces: int = 1,
        heavy_stride: int = 1,
    ):
        import mediapipe as mp

        paths = {
            "face": Path(face_task) if face_task else default_model_path(),
            "pose": Path(pose_task) if pose_task else default_pose_path(),
            "hand": Path(hand_task) if hand_task else default_hand_path(),
        }
        for kind, p in paths.items():
            if not p.is_file():
                raise RuntimeError(f"model file not found ({kind}): {p}")
        vision = mp.tasks.vision
        base = mp.tasks.BaseOptions
        mode = vision.RunningMode.VIDEO
        self._mp = mp
        self._face_task_path = paths["face"]
        self._num_faces = num_faces
        self._face = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=base(model_asset_path=str(paths["face"])),
                running_mode=mode,
                num_faces=num_faces,
                output_face_blendshapes=True,
            )
        )
        self._pose = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(
                base_options=base(model_asset_path=str(paths["pose"])),
                running_mode=mode,
                num_poses=1,
            )
        )
        self._hand = vision.HandLandmarker.create_from_options(
            vision.HandLandmarkerOptions(
                base_options=base(model_asset_path=str(paths["hand"])),
                running_mode=mode,
                num_hands=2,
            )
        )
        self._last_ts = -1
        self._image_landmarker = None  # process_image 懒加载（IMAGE 模式）
        self._heavy_stride = max(1, heavy_stride)
        self._frame_no = 0
        self._last_pose: tuple[np.ndarray | None, np.ndarray | None] = (None, None)
        self._last_hands: tuple[np.ndarray | None, np.ndarray | None] = (None, None)

    def _next_ts(self, timestamp_ms: int) -> int:
        ts = int(max(self._last_ts + 1, int(timestamp_ms)))
        self._last_ts = ts
        return ts

    @staticmethod
    def _lm_array(lms, with_visibility: bool) -> np.ndarray:
        if with_visibility:
            return np.array(
                [[p.x, p.y, p.z, getattr(p, "visibility", 0.0)] for p in lms],
                dtype=np.float32,
            )
        return np.array([[p.x, p.y, p.z] for p in lms], dtype=np.float32)

    def process_frame(self, rgb: np.ndarray, timestamp_ms: int) -> FaceResult | None:
        ts = self._next_ts(timestamp_ms)
        self._frame_no += 1
        image = self._mp.Image(
            image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)
        )

        face = self._face.detect_for_video(image, ts)
        blendshapes = np.zeros(52, dtype=np.float32)
        landmarks = None
        head_euler = None
        if face.face_landmarks:
            from ..contract import blendshapes_to_array

            if face.face_blendshapes:
                blendshapes = blendshapes_to_array(face.face_blendshapes[0])
            landmarks = self._lm_array(face.face_landmarks[0], with_visibility=False)
            h, w = rgb.shape[:2]
            head_euler = estimate_head_euler(landmarks, w, h)

        if self._frame_no % self._heavy_stride == 0:
            pose = self._pose.detect_for_video(image, ts)
            hand = self._hand.detect_for_video(image, ts)
            pose_image = pose_world = None
            if pose.pose_landmarks:
                pose_image = self._lm_array(pose.pose_landmarks[0], with_visibility=True)
            if pose.pose_world_landmarks:
                pose_world = self._lm_array(pose.pose_world_landmarks[0], with_visibility=True)
            hand_left = hand_right = None
            for lms, handed in zip(hand.hand_landmarks or [], hand.handedness or []):
                arr = self._lm_array(lms, with_visibility=False)
                # MediaPipe 按「自拍镜像」约定报告左右手，镜像校正在前端做
                if handed[0].category_name == "Left":
                    hand_left = arr
                else:
                    hand_right = arr
            self._last_pose = (pose_image, pose_world)
            self._last_hands = (hand_left, hand_right)

        pose_image, pose_world = self._last_pose
        hand_left, hand_right = self._last_hands
        if landmarks is None and pose_image is None and hand_left is None and hand_right is None:
            return None  # 什么都没有才丢帧；只有身体没有脸也照常发布
        return FaceResult(
            blendshapes=blendshapes,
            landmarks=landmarks,
            head_euler=head_euler,
            pose_image=pose_image,
            pose_world=pose_world,
            hand_left=hand_left,
            hand_right=hand_right,
        )

    def close(self) -> None:
        self._face.close()
        self._pose.close()
        self._hand.close()
        if self._image_landmarker is not None:
            self._image_landmarker.close()

    def process_image(self, rgb: np.ndarray) -> FaceResult | None:
        """单张静态照片专用：IMAGE 模式，无时序状态（见 mediapipe_backend 同名方法）。"""
        if self._image_landmarker is None:
            options = self._mp.tasks.vision.FaceLandmarkerOptions(
                base_options=self._mp.tasks.BaseOptions(
                    model_asset_path=str(self._face_task_path)
                ),
                running_mode=self._mp.tasks.vision.RunningMode.IMAGE,
                num_faces=self._num_faces,
                output_face_blendshapes=True,
            )
            self._image_landmarker = self._mp.tasks.vision.FaceLandmarker.create_from_options(options)
        from ..contract import blendshapes_to_array

        image = self._mp.Image(
            image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)
        )
        result = self._image_landmarker.detect(image)
        if not result.face_landmarks:
            return None
        blendshapes = (
            blendshapes_to_array(result.face_blendshapes[0])
            if result.face_blendshapes
            else np.zeros(52, dtype=np.float32)
        )
        landmarks = self._lm_array(result.face_landmarks[0], with_visibility=False)
        h, w = rgb.shape[:2]
        return FaceResult(
            blendshapes=blendshapes,
            landmarks=landmarks,
            head_euler=estimate_head_euler(landmarks, w, h),
        )
