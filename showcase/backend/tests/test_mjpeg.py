"""MJPEG 帧流（/api/camera/stream）的测试。"""
import asyncio

import numpy as np

from showcase.backend.holder import BackendHolder
from showcase.backend.perception.base import FaceResult
from showcase.backend.service import FrameStore, create_app

FAKE_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32 + b"\xff\xd9"  # JPEG SOI/EOI 标记


class FakeBackend:
    name = "fake"

    def process_frame(self, rgb, timestamp_ms):
        return FaceResult(blendshapes=np.zeros(52, dtype=np.float32))

    def close(self):
        pass


def run(coro):
    return asyncio.run(coro)


def test_frame_store_set_get():
    store = FrameStore()
    assert store.get() == (0, None)
    store.set(FAKE_JPEG)
    seq, jpeg = store.get()
    assert seq == 1 and jpeg == FAKE_JPEG


def test_mjpeg_endpoint_streams_latest_frame():
    async def main():
        from aiohttp.test_utils import TestClient, TestServer

        store = FrameStore()
        store.set(FAKE_JPEG)
        app = create_app(BackendHolder(FakeBackend()), frame_store=store)
        async with TestClient(TestServer(app)) as client:
            resp = await client.get("/api/camera/stream")
            assert resp.status == 200
            assert "multipart/x-mixed-replace" in resp.headers["Content-Type"]
            chunk = await resp.content.read(4096)
            assert b"--frame" in chunk
            assert b"image/jpeg" in chunk
            assert FAKE_JPEG in chunk
            resp.close()
    run(main())


def test_mjpeg_endpoint_503_without_camera():
    async def main():
        from aiohttp.test_utils import TestClient, TestServer

        app = create_app(BackendHolder(FakeBackend()))  # 不传 frame_store = 摄像头未启用
        async with TestClient(TestServer(app)) as client:
            resp = await client.get("/api/camera/stream")
            assert resp.status == 503
    run(main())
