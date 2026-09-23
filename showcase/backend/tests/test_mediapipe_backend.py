"""真实模型的冒烟测试：deploy/assets/test_single.jpg 已入库，
models/face_landmarker.task 只在本地存在（.gitignore），缺失时整体跳过。"""
from pathlib import Path

import cv2
import numpy as np
import pytest

from showcase.backend.perception.mediapipe_backend import (
    DEFAULT_MODEL_PATH,
    MediaPipeTaskBackend,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TEST_IMAGE = REPO_ROOT / "deploy" / "assets" / "test_single.jpg"

pytestmark = pytest.mark.skipif(
    not (DEFAULT_MODEL_PATH.is_file() and TEST_IMAGE.is_file()),
    reason="model file or test image not available",
)


def test_single_image_detection():
    backend = MediaPipeTaskBackend()
    try:
        bgr = cv2.imread(str(TEST_IMAGE))
        assert bgr is not None
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

        r1 = backend.process_frame(rgb, 0)
        assert r1 is not None, "test_single.jpg contains a face"
        assert r1.blendshapes.shape == (52,)
        assert r1.blendshapes.min() >= 0.0 and r1.blendshapes.max() <= 1.0
        assert r1.landmarks.shape == (478, 3)
        assert r1.head_euler is None or {"x", "y", "z"} <= set(r1.head_euler)

        # 同一时间戳再来一帧：VIDEO 模式的单调时间戳兜底必须生效，不能抛异常
        r2 = backend.process_frame(rgb, 0)
        assert r2 is not None

        # VIDEO 模式带时序滤波，同实例重复推理不必一致；
        # 但全新实例对同一输入必须确定（这是回归测试能成立的前提）
        fresh = MediaPipeTaskBackend()
        try:
            r3 = fresh.process_frame(rgb, 0)
            np.testing.assert_allclose(r1.blendshapes, r3.blendshapes, atol=1e-5)
        finally:
            fresh.close()
    finally:
        backend.close()
