"""mediapipe-full（B 版本）后端的真实模型冒烟测试。
三个 .task 任一缺失则整体跳过（它们被 .gitignore 挡在库外）。"""
from pathlib import Path

import cv2
import numpy as np
import pytest

from showcase.backend.perception.mediapipe_backend import DEFAULT_MODEL_PATH
from showcase.backend.perception.mediapipe_full import (
    DEFAULT_HAND_PATH,
    DEFAULT_POSE_PATH,
    MediaPipeFullBackend,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TEST_IMAGE = REPO_ROOT / "deploy" / "assets" / "test_single.jpg"

MODELS = [DEFAULT_MODEL_PATH, DEFAULT_POSE_PATH, DEFAULT_HAND_PATH]
pytestmark = pytest.mark.skipif(
    not (all(p.is_file() for p in MODELS) and TEST_IMAGE.is_file()),
    reason="face/pose/hand model files or test image not available",
)


def test_full_backend_single_image():
    backend = MediaPipeFullBackend()
    try:
        bgr = cv2.imread(str(TEST_IMAGE))
        assert bgr is not None
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        result = backend.process_frame(rgb, 0)
        assert result is not None, "test_single.jpg contains a face"
        assert result.blendshapes.shape == (52,)
        assert result.landmarks is not None and result.landmarks.shape == (478, 3)
        # 单人像照片里 pose/hand 可有可无，但若检出则形状必须正确
        if result.pose_image is not None:
            assert result.pose_image.shape == (33, 4)
        if result.pose_world is not None:
            assert result.pose_world.shape == (33, 4)
        if result.hand_left is not None:
            assert result.hand_left.shape == (21, 3)
        if result.hand_right is not None:
            assert result.hand_right.shape == (21, 3)
    finally:
        backend.close()


def test_full_backend_heavy_stride_reuses_last():
    backend = MediaPipeFullBackend(heavy_stride=2)
    try:
        bgr = cv2.imread(str(TEST_IMAGE))
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        r1 = backend.process_frame(rgb, 0)  # frame_no=1 % 2 != 0 → 只跑 face
        r2 = backend.process_frame(rgb, 0)  # frame_no=2 % 2 == 0 → 跑全部
        assert r1 is not None and r2 is not None
        # 隔帧时 pose 结果复用上一帧（同为 None 或同对象内容一致）
        if r1.pose_image is None and r2.pose_image is not None:
            pass  # 第一帧没跑 pose，第二帧跑了：允许从无到有
        elif r1.pose_image is not None and r2.pose_image is not None:
            np.testing.assert_allclose(r1.pose_image, r2.pose_image, atol=1e-5)
    finally:
        backend.close()
