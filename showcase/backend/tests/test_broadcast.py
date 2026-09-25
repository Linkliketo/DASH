"""广播器与 /ws/face、静态托管的测试。"""
import asyncio

import numpy as np
import pytest

from showcase.backend.broadcaster import FaceBroadcaster
from showcase.backend.contract import build_face_frame
from showcase.backend.holder import BackendHolder
from showcase.backend.perception.base import FaceResult
from showcase.backend.service import DEFAULT_FRONTEND_DIR, create_app

STATIC_INDEX = DEFAULT_FRONTEND_DIR / "index.html"


class FakeBackend:
    name = "fake"

    def process_frame(self, rgb, timestamp_ms):
        return FaceResult(blendshapes=np.zeros(52, dtype=np.float32))

    def close(self):
        pass


def run(coro):
    return asyncio.run(coro)


def test_ws_face_receives_broadcast():
    async def main():
        from aiohttp.test_utils import TestClient, TestServer

        broadcaster = FaceBroadcaster()
        app = create_app(BackendHolder(FakeBackend()), broadcaster=broadcaster)
        async with TestClient(TestServer(app)) as client:
            ws = await client.ws_connect("/ws/face")
            assert broadcaster.client_count == 1
            msg = build_face_frame(np.zeros(52, dtype=np.float32), pts=1.0)
            broadcaster.publish(msg)  # 测试里从事件循环线程调用，与采集线程同路径
            received = await ws.receive_json(timeout=3)
            assert received["type"] == "miniface-frame"
            assert len(received["blendshapes"]) == 52
            await ws.close()
            await asyncio.sleep(0)  # 让服务端 finally 跑完
            assert broadcaster.client_count == 0
    run(main())


def test_publish_without_clients_is_noop():
    bc = FaceBroadcaster()  # 未 bind loop、无客户端：publish 必须静默返回
    bc.publish({"type": "x"})


def test_face_frame_with_landmarks():
    landmarks = np.random.default_rng(0).random((478, 3), dtype=np.float32)
    msg = build_face_frame(np.zeros(52, dtype=np.float32), landmarks=landmarks)
    assert len(msg["landmarks"]) == 1434
    assert msg["landmarks"][0] == pytest.approx(float(landmarks.reshape(-1)[0]), abs=1e-4)
    with pytest.raises(ValueError):
        build_face_frame(np.zeros(52, dtype=np.float32), landmarks=np.zeros((10, 3)))


@pytest.mark.skipif(not STATIC_INDEX.is_file(), reason="frontend not built yet")
def test_static_index_served():
    async def main():
        from aiohttp.test_utils import TestClient, TestServer

        app = create_app(BackendHolder(FakeBackend()), static_dir=DEFAULT_FRONTEND_DIR)
        async with TestClient(TestServer(app)) as client:
            resp = await client.get("/")
            assert resp.status == 200
            assert "text/html" in resp.headers["Content-Type"]
            # API 路由不能被静态托管抢走
            assert (await client.get("/api/health")).status == 200
    run(main())
