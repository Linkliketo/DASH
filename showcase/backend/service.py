"""HTTP 服务面（aiohttp，默认 :8770）。

两类接口：
- 控制面：/api/health、/api/backends、/api/backend —— 查看与热切换底层模型；
- 数据面：/api/photo、/api/video —— 照片 / 视频两种输入的 BlendShape 提取。
  （摄像头输入不走 HTTP，由 camera_stream 直接推给 fusion。）

响应里的键沿用 viewer 的 camelCase 约定。
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import threading
import time
from dataclasses import asdict
from pathlib import Path

import cv2
import numpy as np
from aiohttp import web

from .contract import array_to_categories
from .holder import BackendHolder
from .perception import list_backends
from .video_io import iter_video_results

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8770

_JSON = {"Content-Type": "application/json; charset=utf-8"}


def _json(data: dict, status: int = 200) -> web.Response:
    return web.Response(text=json.dumps(data, ensure_ascii=False), status=status, headers=_JSON)


@web.middleware
async def _cors(request: web.Request, handler):
    # demo 只允许本地用途，前端静态页可能开在任何端口，故放开跨域
    if request.method == "OPTIONS":
        response = web.Response()
    else:
        response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


async def _health(request: web.Request) -> web.Response:
    holder: BackendHolder = request.app["holder"]
    return _json(
        {
            "ok": True,
            "activeBackend": holder.name,
            "uptimeS": round(time.time() - request.app["started_at"], 1),
            "inference": holder.stats(),
        }
    )


async def _backends(request: web.Request) -> web.Response:
    holder: BackendHolder = request.app["holder"]
    return _json(
        {
            "active": holder.name,
            "backends": [asdict(i) for i in list_backends()],
        }
    )


async def _switch_backend(request: web.Request) -> web.Response:
    holder: BackendHolder = request.app["holder"]
    try:
        body = await request.json()
    except Exception:
        return _json({"error": "request body must be JSON"}, status=400)
    name = body.get("name")
    if not name:
        return _json({"error": "missing field: name"}, status=400)
    try:
        active = await asyncio.to_thread(holder.switch, name)
    except KeyError as e:
        return _json({"error": str(e)}, status=404)
    except RuntimeError as e:
        return _json({"error": str(e)}, status=409)
    return _json({"active": active, "backends": [asdict(i) for i in list_backends()]})


async def _read_image_bytes(request: web.Request) -> bytes | None:
    """同时支持两种上传：raw body（Content-Type: image/*）与 multipart 表单。"""
    if request.content_type == "multipart/form-data":
        async for part in await request.multipart():
            if part.filename:
                return await part.read()
        return None
    return await request.read()


async def _photo(request: web.Request) -> web.Response:
    holder: BackendHolder = request.app["holder"]
    data = await _read_image_bytes(request)
    if not data:
        return _json({"error": "empty image body"}, status=400)
    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        return _json({"error": "cannot decode image (expect jpeg/png)"}, status=400)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    t0 = time.perf_counter()
    result = await asyncio.to_thread(holder.infer, rgb, 0)
    inference_ms = (time.perf_counter() - t0) * 1000.0
    if result is None:
        return _json({"ok": False, "error": "no face detected"}, status=422)
    return _json(
        {
            "ok": True,
            "backend": holder.name,
            "inferenceMs": round(inference_ms, 2),
            "blendshapes": array_to_categories(result.blendshapes),
            "headEuler": result.head_euler,
            "landmarks": result.landmarks.tolist() if result.landmarks is not None else None,
        }
    )


def _video_producer(path: Path, holder: BackendHolder, stride: int, loop, queue) -> None:
    """在普通线程里跑，把每帧结果桥接进事件循环的队列。"""
    try:
        for item in iter_video_results(path, holder.infer, stride=stride):
            loop.call_soon_threadsafe(queue.put_nowait, item)
    except Exception as e:
        loop.call_soon_threadsafe(queue.put_nowait, {"ok": False, "error": str(e)})
    finally:
        loop.call_soon_threadsafe(queue.put_nowait, None)  # 结束哨兵


async def _video(request: web.Request) -> web.StreamResponse:
    holder: BackendHolder = request.app["holder"]
    try:
        stride = max(1, int(request.query.get("stride", "1")))
    except ValueError:
        return _json({"error": "stride must be a positive integer"}, status=400)
    if request.content_type != "multipart/form-data":
        return _json({"error": "expect multipart/form-data with a file field"}, status=400)

    # cv2.VideoCapture 需要真实文件路径，先把上传流存到临时文件
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    received = 0
    try:
        async for part in await request.multipart():
            if not part.filename:
                continue
            while True:
                chunk = await part.read_chunk(1 << 20)
                if not chunk:
                    break
                tmp.write(chunk)
                received += len(chunk)
            break
    finally:
        tmp.close()
    if received == 0:
        Path(tmp.name).unlink(missing_ok=True)
        return _json({"error": "no file uploaded"}, status=400)

    response = web.StreamResponse(
        headers={"Content-Type": "application/x-ndjson; charset=utf-8"}
    )
    await response.prepare(request)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    thread = threading.Thread(
        target=_video_producer,
        args=(Path(tmp.name), holder, stride, loop, queue),
        name="video-producer",
        daemon=True,
    )
    thread.start()
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            await response.write(json.dumps(item, ensure_ascii=False).encode() + b"\n")
        await response.write_eof()
    finally:
        thread.join(timeout=5)
        Path(tmp.name).unlink(missing_ok=True)
    return response


def create_app(holder: BackendHolder) -> web.Application:
    app = web.Application(middlewares=[_cors], client_max_size=512 * 1024 * 1024)
    app["holder"] = holder
    app["started_at"] = time.time()
    app.router.add_get("/api/health", _health)
    app.router.add_get("/api/backends", _backends)
    app.router.add_post("/api/backend", _switch_backend)
    app.router.add_post("/api/photo", _photo)
    app.router.add_post("/api/video", _video)
    return app


def run_server(holder: BackendHolder, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    web.run_app(create_app(holder), host=host, port=port, print=None)
