"""视频文件的逐帧处理：service 的 /api/video 与 cli 的 video 子命令共用。"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterator

import cv2
import numpy as np

from .contract import array_to_categories
from .perception.base import FaceResult


def iter_video_results(
    path: str | Path,
    infer: Callable[[np.ndarray, int], FaceResult | None],
    stride: int = 1,
    max_frames: int | None = None,
) -> Iterator[dict]:
    """逐帧产出结果字典（NDJSON 的一行）。

    path: 视频文件路径（cv2 需要真实文件，调用方负责临时文件）。
    infer: (rgb, timestamp_ms) -> FaceResult | None。
    stride: 每隔几帧处理一帧，未处理帧不产生输出。
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
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
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
                yield item
                produced += 1
                if max_frames is not None and produced >= max_frames:
                    break
            index += 1
    finally:
        cap.release()
