"""感知后端注册表。

新增一个模型后端只需要三步：
1. 在 perception/ 下新建文件，实现 base.PerceptionBackend 协议；
2. 写一个 info() 函数报告可用性（模型文件在不在等）；
3. 在下面的 _FACTORIES 里登记一行。

service / camera_stream / cli / 测试全部只依赖这张表，不感知具体后端。
"""
from __future__ import annotations

from . import mediapipe_backend, onnx_backend
from .base import BackendInfo, FaceResult, PerceptionBackend

__all__ = [
    "BackendInfo",
    "FaceResult",
    "PerceptionBackend",
    "list_backends",
    "backend_names",
    "create_backend",
]

# name -> (info 函数, 实现类)
_FACTORIES = {
    mediapipe_backend.MediaPipeTaskBackend.name: (
        mediapipe_backend.info,
        mediapipe_backend.MediaPipeTaskBackend,
    ),
    onnx_backend.OnnxDistilledBackend.name: (
        onnx_backend.info,
        onnx_backend.OnnxDistilledBackend,
    ),
}


def backend_names() -> list[str]:
    return sorted(_FACTORIES)


def list_backends() -> list[BackendInfo]:
    """所有已注册后端的实时可用性（每次调用重新检查文件系统）。"""
    return [info_fn() for info_fn, _ in _FACTORIES.values()]


def create_backend(name: str, **kwargs) -> PerceptionBackend:
    """按名字实例化后端。名字不存在抛 KeyError，不可用抛 RuntimeError。"""
    try:
        info_fn, cls = _FACTORIES[name]
    except KeyError:
        raise KeyError(
            f"unknown backend {name!r}; choices: {backend_names()}"
        ) from None
    st = info_fn()
    if not st.available:
        raise RuntimeError(f"backend {name!r} unavailable: {st.reason}")
    return cls(**kwargs)
