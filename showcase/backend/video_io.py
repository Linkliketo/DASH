"""视频文件的逐帧处理：service 的 /api/video 与 cli 的 video 子命令共用。"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterator

import cv2
import numpy as np

from .contract import array_to_categories, _flat
from .perception.base import FaceResult

DEFAULT_MAX_SIDE = 720  # 超长边降采样到的像素数：4K/1080p 视频全分辨率推理没有意义


def _downscale(frame: np.ndarray, max_side: int) -> np.ndarray:
    """超长边等比降到 max_side（不放大）。手机竖拍 4K 时能有 3-4 倍提速。"""
    h, w = frame.shape[:2]
    side = max(h, w)
    if side <= max_side:
        return frame
    scale = max_side / side
    return cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def iter_video_results(
    path: str | Path,
    infer: Callable[[np.ndarray, int], FaceResult | None],
    stride: int = 1,
    max_frames: int | None = None,
    max_side: int = DEFAULT_MAX_SIDE,
) -> Iterator[dict]:
    """逐帧产出结果字典（NDJSON 的一行）。

    path: 视频文件路径（cv2 需要真实文件，调用方负责临时文件）。
    infer: (rgb, timestamp_ms) -> FaceResult | None。
    stride: 每隔几帧处理一帧，未处理帧不产生输出。
    max_side: 推理前超长边降采样（0 = 不降）。
    """
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot decode video: {path}")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        index = 0
        produced = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if index % stride == 0:
                timestamp_ms = index * 1000.0 / fps
                rgb = cv2.cvtColor(_downscale(frame, max_side), cv2.COLOR_BGR2RGB)
                result = infer(rgb, int(timestamp_ms))
                item = {
                    "frame": index,
                    "timestampMs": round(timestamp_ms, 3),
                    "ok": result is not None,
                }
                if result is not None:
                    item["blendshapes"] = array_to_categories(result.blendshapes)
                    if result.head_euler is not None:
                        item["headEuler"] = result.head_euler
                    if result.landmarks is not None:
                        item["landmarks"] = _flat(result.landmarks, 478 * 3, "landmarks")
                    # B 版本后端（mediapipe-full）的骨骼与手部数据一并输出
                    if result.pose_image is not None or result.pose_world is not None:
                        pose = {}
                        if result.pose_image is not None:
                            pose["image"] = _flat(result.pose_image, 33 * 4, "pose_image")
                        if result.pose_world is not None:
                            pose["world"] = _flat(result.pose_world, 33 * 4, "pose_world")
                        item["pose"] = pose
                    if result.hand_left is not None or result.hand_right is not None:
                        item["hands"] = {
                            "left": _flat(result.hand_left, 21 * 3, "hand_left")
                            if result.hand_left is not None
                            else None,
                            "right": _flat(result.hand_right, 21 * 3, "hand_right")
                            if result.hand_right is not None
                            else None,
                        }
                yield item
                produced += 1
                if max_frames is not None and produced >= max_frames:
                    break
            index += 1
    finally:
        cap.release()
