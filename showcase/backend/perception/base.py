"""感知后端的抽象接口。

一个后端 = 一帧 RGB 进，一个 FaceResult 出。
新增模型（例如阶段 4 的剪枝 MLP）只需再写一个实现并登记进
perception/__init__.py 的注册表，service / camera_stream / cli 全部不用改。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass
class FaceResult:
    """单帧感知结果。blendshapes 顺序固定为 contract.BLENDSHAPE_NAMES。"""

    blendshapes: np.ndarray            # (52,) float32，取值 [0, 1]
    landmarks: np.ndarray | None = None  # (478, 3) 归一化坐标，供 3D 网格叠加层用
    head_euler: dict | None = None       # {"x", "y", "z"} 头部欧拉角，单位度


@dataclass
class BackendInfo:
    """注册表里每个后端的自述，用于 /api/backends 展示与可用性检查。"""

    name: str
    description: str
    available: bool
    reason: str = ""  # 不可用时说明原因（如模型文件缺失）


class PerceptionBackend(Protocol):
    """感知后端协议。实现类必须是线程外可序列化使用的——
    并发保护由 holder.BackendHolder 统一负责，实现类自己不用加锁。"""

    name: str

    def process_frame(self, rgb: np.ndarray, timestamp_ms: int) -> FaceResult | None:
        """rgb: (H, W, 3) uint8，RGB 通道序。检测不到人脸时返回 None。"""
        ...

    def close(self) -> None:
        """释放模型资源。进程退出或热切换时被调用。"""
        ...
