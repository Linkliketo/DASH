"""命令行入口，三个子命令对应三种输入：

    python -m showcase.backend serve                     # 摄像头实时 + HTTP 服务面
    python -m showcase.backend image photo.jpg           # 单张照片 -> JSON
    python -m showcase.backend video in.mp4 -o out.jsonl # 视频 -> NDJSON

所有子命令都接受 --backend 选择底层模型（默认 mediapipe-task）。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

from .broadcaster import FaceBroadcaster
from .camera_stream import CameraStreamer
from .contract import array_to_categories
from .holder import BackendHolder
from .perception import create_backend, list_backends
from .service import DEFAULT_FRONTEND_DIR, DEFAULT_HOST, DEFAULT_PORT, FrameStore, run_server
from .video_io import iter_video_results


def _print_backend_table(file=sys.stderr) -> None:
    print("available backends:", file=file)
    for i in list_backends():
        mark = "ok" if i.available else f"unavailable ({i.reason})"
        print(f"  {i.name:16s} {mark}  {i.description}", file=file)


def _make_holder_or_exit(name: str) -> BackendHolder:
    try:
        return BackendHolder(create_backend(name))
    except (KeyError, RuntimeError) as e:
        print(f"error: {e}", file=sys.stderr)
        _print_backend_table()
        sys.exit(2)


def _cmd_serve(args) -> int:
    holder = _make_holder_or_exit(args.backend)
    broadcaster = FaceBroadcaster()
    frame_store = None
    streamer = None
    if not args.no_camera:
        frame_store = FrameStore()
        streamer = CameraStreamer(
            holder,
            fusion_url=args.fusion,  # None = 不推 fusion，只走进程内广播
            sink=broadcaster.publish,
            frame_sink=frame_store.set,
            camera_index=args.camera,
            width=args.width,
            height=args.height,
        )
        streamer.start_in_thread()
    static_dir = Path(args.static_dir) if args.static_dir else DEFAULT_FRONTEND_DIR
    serve_static = static_dir.is_dir() and not args.no_static
    print(f"[serve] backend={holder.name}  frontend+api=http://{args.host}:{args.port}  "
          f"static={'off' if not serve_static else static_dir}  "
          f"fusion={'off' if args.fusion is None else args.fusion}")
    try:
        run_server(
            holder,
            host=args.host,
            port=args.port,
            broadcaster=broadcaster,
            static_dir=static_dir if serve_static else None,
            frame_store=frame_store,
        )
    finally:
        if streamer is not None:
            streamer.stop()
        holder.close()
    return 0


def _cmd_image(args) -> int:
    holder = _make_holder_or_exit(args.backend)
    try:
        bgr = cv2.imread(args.path)
        if bgr is None:
            print(f"error: cannot read image {args.path}", file=sys.stderr)
            return 2
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        result = holder.infer(rgb, 0)
        if result is None:
            print(json.dumps({"ok": False, "error": "no face detected"}))
            return 1
        payload = {
            "ok": True,
            "file": args.path,
            "backend": holder.name,
            "blendshapes": array_to_categories(result.blendshapes),
            "headEuler": result.head_euler,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
        return 0
    finally:
        holder.close()


def _cmd_video(args) -> int:
    holder = _make_holder_or_exit(args.backend)
    out = open(args.output, "w", encoding="utf-8") if args.output else sys.stdout
    try:
        for item in iter_video_results(args.path, holder.infer, stride=args.stride,
                                       max_frames=args.max_frames):
            out.write(json.dumps(item, ensure_ascii=False) + "\n")
        return 0
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    finally:
        if out is not sys.stdout:
            out.close()
        holder.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m showcase.backend",
        description="DASH showcase 面部感知后端：照片 / 视频 / 摄像头 -> 52 BlendShape",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("serve", help="启动 HTTP/WS 服务 + 静态托管 + 摄像头实时推流")
    p.add_argument("--host", default=DEFAULT_HOST)
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--backend", default="mediapipe-task", help="底层模型后端名")
    p.add_argument("--fusion", default=None,
                   help="可选：fusion 服务器 ws 地址（如 ws://127.0.0.1:8765），兼容旧链路")
    p.add_argument("--camera", type=int, default=0, help="摄像头编号")
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--no-camera", action="store_true", help="只开服务面，不采摄像头")
    p.add_argument("--static-dir", default=None, help=f"前端目录，默认 {DEFAULT_FRONTEND_DIR}")
    p.add_argument("--no-static", action="store_true", help="不托管前端静态文件")
    p.set_defaults(func=_cmd_serve)

    p = sub.add_parser("image", help="单张照片 -> BlendShape JSON")
    p.add_argument("path")
    p.add_argument("--backend", default="mediapipe-task")
    p.add_argument("--pretty", action="store_true", help="缩进输出，便于肉眼检查")
    p.set_defaults(func=_cmd_image)

    p = sub.add_parser("video", help="视频文件 -> 逐帧 BlendShape NDJSON")
    p.add_argument("path")
    p.add_argument("--backend", default="mediapipe-task")
    p.add_argument("--stride", type=int, default=1, help="每隔几帧处理一帧")
    p.add_argument("--max-frames", type=int, default=None, help="最多处理多少帧（调试用）")
    p.add_argument("-o", "--output", default=None, help="输出文件，默认 stdout")
    p.set_defaults(func=_cmd_video)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
