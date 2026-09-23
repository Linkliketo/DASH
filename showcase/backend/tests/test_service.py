"""HTTP 服务面的单元测试。

注入 FakeBackend，因此不需要真实模型文件，也不开摄像头；
只有 test_switch_to_mediapipe 依赖真实 .task，本地有模型时才跑。
"""
import asyncio
import json

import cv2
import numpy as np
import pytest
from aiohttp import FormData
from aiohttp.test_utils import TestClient, TestServer

from showcase.backend.contract import BLENDSHAPE_NAMES, NUM_BLENDSHAPES
from showcase.backend.holder import BackendHolder
from showcase.backend.perception.base import FaceResult
from showcase.backend.perception.mediapipe_backend import DEFAULT_MODEL_PATH
from showcase.backend.service import create_app

JAW_OPEN = BLENDSHAPE_NAMES.index("jawOpen")


class FakeBackend:
    def __init__(self, name="fake"):
        self.name = name
        self.closed = False
        self.calls = 0

    def process_frame(self, rgb, timestamp_ms):
        self.calls += 1
        arr = np.zeros(NUM_BLENDSHAPES, dtype=np.float32)
        arr[JAW_OPEN] = 0.5
        return FaceResult(blendshapes=arr, landmarks=None, head_euler={"x": 1.0, "y": 2.0, "z": 3.0})

    def close(self):
        self.closed = True


def fake_factory(name, **kwargs):
    if name == "fake-next":
        return FakeBackend(name="fake-next")
    if name == "broken":
        raise RuntimeError("backend 'broken' unavailable: missing model file")
    raise KeyError(f"unknown backend {name!r}")


def make_holder():
    return BackendHolder(FakeBackend(), factory=fake_factory)


def run(coro):
    return asyncio.run(coro)


async def make_client(holder):
    client = TestClient(TestServer(create_app(holder)))
    await client.start_server()
    return client


def encode_jpeg():
    rng = np.random.default_rng(1)
    img = (rng.random((64, 64, 3)) * 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def test_health():
    async def main():
        holder = make_holder()
        client = await make_client(holder)
        try:
            resp = await client.get("/api/health")
            assert resp.status == 200
            data = await resp.json()
            assert data["ok"] is True
            assert data["activeBackend"] == "fake"
        finally:
            await client.close()
    run(main())


def test_list_backends():
    async def main():
        client = await make_client(make_holder())
        try:
            resp = await client.get("/api/backends")
            assert resp.status == 200
            data = await resp.json()
            assert data["active"] == "fake"
            names = [b["name"] for b in data["backends"]]
            assert "mediapipe-task" in names and "onnx-distilled" in names
            for b in data["backends"]:
                assert {"name", "description", "available", "reason"} <= set(b)
        finally:
            await client.close()
    run(main())


def test_switch_success_closes_old_backend():
    async def main():
        holder = make_holder()
        old = holder._backend
        client = await make_client(holder)
        try:
            resp = await client.post("/api/backend", json={"name": "fake-next"})
            assert resp.status == 200
            data = await resp.json()
            assert data["active"] == "fake-next"
            assert old.closed, "old backend must be closed after a successful switch"
        finally:
            await client.close()
    run(main())


def test_switch_unknown_is_404_unavailable_is_409_missing_name_is_400():
    async def main():
        holder = make_holder()
        client = await make_client(holder)
        try:
            assert (await client.post("/api/backend", json={"name": "nope"})).status == 404
            assert (await client.post("/api/backend", json={"name": "broken"})).status == 409
            assert (await client.post("/api/backend", json={})).status == 400
            assert holder.name == "fake", "failed switches must keep the old backend alive"
        finally:
            await client.close()
    run(main())


def test_photo_raw_body():
    async def main():
        client = await make_client(make_holder())
        try:
            resp = await client.post("/api/photo", data=encode_jpeg(),
                                     headers={"Content-Type": "image/jpeg"})
            assert resp.status == 200
            data = await resp.json()
            assert data["ok"] is True
            assert len(data["blendshapes"]) == NUM_BLENDSHAPES
            assert data["blendshapes"][JAW_OPEN] == {"categoryName": "jawOpen", "score": 0.5}
            assert data["headEuler"] == {"x": 1.0, "y": 2.0, "z": 3.0}
            assert "inferenceMs" in data
        finally:
            await client.close()
    run(main())


def test_photo_multipart_and_garbage():
    async def main():
        client = await make_client(make_holder())
        try:
            form = FormData()
            form.add_field("file", encode_jpeg(), filename="x.jpg", content_type="image/jpeg")
            assert (await client.post("/api/photo", data=form)).status == 200
            bad = await client.post("/api/photo", data=b"this is not an image",
                                    headers={"Content-Type": "image/jpeg"})
            assert bad.status == 400
        finally:
            await client.close()
    run(main())


def write_test_video(path, n_frames=5):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (64, 64))
    if not writer.isOpened():
        writer.release()
        pytest.skip("cv2.VideoWriter(mp4v) not available on this machine")
    for i in range(n_frames):
        writer.write(np.full((64, 64, 3), i * 40, dtype=np.uint8))
    writer.release()


def test_video_ndjson(tmp_path):
    video_path = tmp_path / "t.mp4"
    write_test_video(video_path, n_frames=5)

    async def main():
        client = await make_client(make_holder())
        try:
            form = FormData()
            form.add_field("file", video_path.read_bytes(), filename="t.mp4",
                           content_type="video/mp4")
            resp = await client.post("/api/video", data=form)
            assert resp.status == 200
            text = await resp.text()
        finally:
            await client.close()
        lines = [json.loads(l) for l in text.strip().splitlines()]
        assert len(lines) == 5, "one NDJSON line per processed frame"
        for i, line in enumerate(lines):
            assert line["frame"] == i and line["ok"] is True
            assert len(line["blendshapes"]) == NUM_BLENDSHAPES
            assert line["timestampMs"] == pytest.approx(i * 100.0)
    run(main())


@pytest.mark.skipif(not DEFAULT_MODEL_PATH.is_file(), reason="face_landmarker.task not present")
def test_switch_to_real_mediapipe_backend():
    async def main():
        holder = BackendHolder(FakeBackend())  # factory 用真实注册表
        client = await make_client(holder)
        try:
            resp = await client.post("/api/backend", json={"name": "mediapipe-task"})
            assert resp.status == 200
            assert (await resp.json())["active"] == "mediapipe-task"
        finally:
            await client.close()
        holder.close()
    run(main())
