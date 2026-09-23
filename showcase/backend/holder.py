"""当前生效后端的线程安全容器，支持热切换。

设计要点：
- 所有推理都必须经过 infer()，锁集中在这里 —— MediaPipe 的
  FaceLandmarker 不是线程安全的，摄像头线程和 HTTP 线程会同时用到它。
- switch() 先在锁外构造新后端（加载模型要秒级），构造期间旧后端
  继续服务，直播画面不中断；构造失败则旧后端原样保留。
"""
from __future__ import annotations

import threading
import time

import numpy as np

from .perception import create_backend
from .perception.base import FaceResult, PerceptionBackend


class BackendHolder:
    def __init__(self, backend: PerceptionBackend, factory=create_backend):
        self._backend = backend
        self._factory = factory
        self._lock = threading.Lock()        # 保护推理与换入
        self._switch_lock = threading.Lock()  # 串行化整个切换过程
        self._infer_count = 0
        self._infer_ms_total = 0.0

    @property
    def name(self) -> str:
        return self._backend.name

    def infer(self, rgb: np.ndarray, timestamp_ms: int) -> FaceResult | None:
        t0 = time.perf_counter()
        with self._lock:
            result = self._backend.process_frame(rgb, timestamp_ms)
        self._infer_count += 1
        self._infer_ms_total += (time.perf_counter() - t0) * 1000.0
        return result

    def switch(self, name: str, **kwargs) -> str:
        """切换到指定后端，返回新后端名。KeyError=名字不存在，RuntimeError=不可用。"""
        with self._switch_lock:
            new_backend = self._factory(name, **kwargs)  # 慢，故意不拿推理锁
            with self._lock:
                old, self._backend = self._backend, new_backend
            old.close()
            return new_backend.name

    def stats(self) -> dict:
        return {
            "count": self._infer_count,
            "avgMs": round(self._infer_ms_total / self._infer_count, 3)
            if self._infer_count
            else None,
        }

    def close(self) -> None:
        with self._lock:
            self._backend.close()
