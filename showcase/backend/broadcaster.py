"""进程内广播器：把感知结果直接推给订阅 /ws/face 的前端。

有了它，demo 不再必须经过 fusion/server.mjs —— 单进程即可驱动前端
（摄像头采集 -> 推理 -> 本广播器 -> 浏览器的皮套人页面）。
"""
from __future__ import annotations

import asyncio
import json


class FaceBroadcaster:
    """线程安全的订阅者集合。publish() 可从任意线程调用（采集线程），
    实际发送调度到事件循环里执行。"""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._clients: set = set()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def add(self, ws) -> None:
        self._clients.add(ws)

    def discard(self, ws) -> None:
        self._clients.discard(ws)

    def publish(self, msg: dict) -> None:
        """广播一帧。无客户端 / 事件循环未就绪时直接丢弃（采集不等人）。"""
        if not self._clients or self._loop is None:
            return
        data = json.dumps(msg, ensure_ascii=False)
        try:
            clients = list(self._clients)
        except RuntimeError:
            return  # 集合正被事件循环修改，丢一帧无妨
        for ws in clients:
            # run_coroutine_threadsafe 才是跨线程调度协程的正确 API：
            # call_soon_threadsafe 只会调用函数，不会 await 返回的协程
            asyncio.run_coroutine_threadsafe(self._send_safe(ws, data), self._loop)

    async def _send_safe(self, ws, data: str) -> None:
        try:
            await ws.send_str(data)
        except Exception:
            self.discard(ws)
