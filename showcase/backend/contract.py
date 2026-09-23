"""后端与 fusion 服务器 / viewer 之间的消息契约。

fusion/server.mjs 与 viewer/index.html 原本对接第三方 miniface，
本后端说完全相同的协议，因此可以无缝替换 miniface：

    {"type": "miniface-frame",
     "pts": 1726900000.123,                                  # 秒，epoch 时间
     "blendshapes": [{"categoryName": "jawOpen", "score": 0.42}, ...],  # 固定 52 项
     "headEuler": {"x": 1.0, "y": 2.0, "z": 3.0}}            # 可选，单位度

注意 viewer 侧读的是 camelCase 的 categoryName（miniface 是 JS 实现），
而 MediaPipe Python 输出的是 category_name —— 统一在本模块转换。
"""
from __future__ import annotations

import time
from typing import Mapping

import numpy as np

FRAME_TYPE = "miniface-frame"

# MediaPipe FaceLandmarker 的 52 个 ARKit 兼容 BlendShape，按输出顺序排列。
# 所有后端（MediaPipe / 自训 ONNX）都必须对齐到这个固定顺序，
# 这样下游（fusion、viewer、录制文件）不需要知道用的是哪个后端。
BLENDSHAPE_NAMES = [
    "_neutral",
    "browDownLeft", "browDownRight", "browInnerUp",
    "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight",
    "eyeLookDownLeft", "eyeLookDownRight",
    "eyeLookInLeft", "eyeLookInRight",
    "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight",
    "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight",
    "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthLeft",
    "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
    "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthSmileLeft", "mouthSmileRight",
    "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight",
]

NUM_BLENDSHAPES = len(BLENDSHAPE_NAMES)
_NAME_TO_INDEX = {name: i for i, name in enumerate(BLENDSHAPE_NAMES)}


def blendshapes_to_array(items) -> np.ndarray:
    """把任意来源的 BlendShape 表示归一成 (52,) float32 数组（顺序 = BLENDSHAPE_NAMES）。

    支持的输入：
    - MediaPipe 的 Category 对象列表（.category_name / .score）
    - dict 列表（"categoryName" / "category_name" / "name" + "score"）
    - {name: score} 映射
    未出现的名字补 0。
    """
    arr = np.zeros(NUM_BLENDSHAPES, dtype=np.float32)
    if isinstance(items, Mapping):
        pairs = list(items.items())
    else:
        pairs = []
        for it in items:
            if isinstance(it, Mapping):
                name = it.get("categoryName") or it.get("category_name") or it.get("name")
                pairs.append((name, it["score"]))
            else:  # MediaPipe Category
                pairs.append((it.category_name, it.score))
    for name, score in pairs:
        idx = _NAME_TO_INDEX.get(name)
        if idx is not None:
            arr[idx] = float(score)
    return arr


def array_to_categories(scores) -> list[dict]:
    """(52,) 数组 -> viewer 期望的 [{"categoryName", "score"}, ...] 列表。"""
    arr = np.asarray(scores, dtype=np.float32).reshape(-1)
    if arr.size != NUM_BLENDSHAPES:
        raise ValueError(f"expected {NUM_BLENDSHAPES} scores, got {arr.size}")
    return [
        {"categoryName": name, "score": float(arr[i])}
        for i, name in enumerate(BLENDSHAPE_NAMES)
    ]


def build_face_frame(scores, pts: float | None = None, head_euler: dict | None = None) -> dict:
    """组装一条 miniface-frame 消息（可直接 json.dumps 后发给 fusion）。"""
    msg = {
        "type": FRAME_TYPE,
        "pts": time.time() if pts is None else float(pts),
        "blendshapes": array_to_categories(scores),
    }
    if head_euler is not None:
        msg["headEuler"] = {k: float(v) for k, v in head_euler.items()}
    return msg
