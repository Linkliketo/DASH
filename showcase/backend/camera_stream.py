"""摄像头采集 -> 当前后端推理 -> miniface-frame 推给 fusion 服务器（ws :8765）。

对应 miniface 的角色：fusion/server.mjs 在 :8765 上等这个消息。
fusion 没启动也没关系 —— 本模块会每 1 秒重试连接，连上后自动开始推流。
"""
from __future__ import annotations

import json
import threading
import time

import cv2
import websocket  # websocket-client

from .contract import build_face_frame
from .holder import BackendHolder

DEFAULT_FUSION_URL = "ws://127.0.0.1:8765"


class CameraStreamer:
    def __init__(
        self,
        holder: BackendHolder,
        fusion_url: str = DEFAULT_FUSION_URL,
        camera_index: int = 0,
        width: int = 640,
        height: int = 480,
    ):
        self._holder = holder
        self._fusion_url = fusion_url
        self._camera_index = camera_index
        self._width = width
        self._height = height
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def _open_camera(self) -> cv2.VideoCapture | None:
        cap = cv2.VideoCapture(self._camera_index)
        if not cap.isOpened():
            print(f"[camera] cannot open camera {self._camera_index}, retry in 2s")
            cap.release()
            return None
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        return cap

    def _connect(self):
        try:
            ws = websocket.create_connection(self._fusion_url, timeout=1)
            print(f"[camera] fusion connected: {self._fusion_url}")
            return ws
        except Exception:
            return None

    def run_forever(self) -> None:
        """阻塞循环，直到 stop()。采集 / 推理始终进行，只有发送依赖 fusion 在线。"""
        cap = None
        while cap is None and not self._stop.is_set():
            cap = self._open_camera()
            if cap is None:
                self._stop.wait(2.0)
        ws = None
        t0 = time.perf_counter()
        frames = 0
        sent = 0
        stat_at = t0
        last_connect_try = 0.0
        try:
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    print("[camera] read failed, reopening")
                    cap.release()
                    cap = None
                    while cap is None and not self._stop.is_set():
                        self._stop.wait(2.0)
                        cap = self._open_camera()
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                timestamp_ms = int((time.perf_counter() - t0) * 1000)
                result = self._holder.infer(rgb, timestamp_ms)
                frames += 1
                now = time.perf_counter()
                if result is not None:
                    if ws is None and now - last_connect_try >= 1.0:
                        last_connect_try = now
                        ws = self._connect()
                    if ws is not None:
                        try:
                            ws.send(
                                json.dumps(
                                    build_face_frame(
                                        result.blendshapes,
                                        pts=time.time(),
                                        head_euler=result.head_euler,
                                    )
                                )
                            )
                            sent += 1
                        except Exception:
                            print("[camera] fusion connection lost")
                            try:
                                ws.close()
                            except Exception:
                                pass
                            ws = None
                if now - stat_at >= 2.0:
                    dt = now - stat_at
                    stats = self._holder.stats()
                    print(
                        f"[camera] {frames / dt:.1f} FPS | sent {sent / dt:.1f} FPS | "
                        f"backend {self._holder.name} | infer avg {stats['avgMs']} ms"
                    )
                    frames = 0
                    sent = 0
                    stat_at = now
        finally:
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass
            if cap is not None:
                cap.release()

    def start_in_thread(self, daemon: bool = True) -> threading.Thread:
        thread = threading.Thread(target=self.run_forever, name="camera-streamer", daemon=daemon)
        thread.start()
        return thread
