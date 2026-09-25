# DASH 皮套人 demo —— showcase

面向游戏数字人的展示 demo：照片 / 视频 / 摄像头三种输入 → 52 维 BlendShape + 头部姿态 → 驱动 VRM 皮套人。

本目录当前只有**后端**（`backend/`，本 PR 交付）。前端页面（pollo.ai 式三步交互）后续 PR 加入。

## 后端在后端管线里的位置

```
摄像头 ─→ backend/camera_stream ─→ miniface-frame (ws :8765) ─┐
                                                              ├→ fusion/server.mjs ─→ ws :8766 ─→ viewer/index.html
SysMocap (身体, socket.io :8080) ────────────────────────────┘         （浏览器渲染 VRM）

照片   ─→ POST /api/photo ─┐
视频   ─→ POST /api/video ─┴→ backend/service.py (aiohttp :8770)
控制面 ─→ GET /api/backends / POST /api/backend（热切换底层模型，不锁死单一模型）
```

后端说与第三方 miniface 完全相同的 `miniface-frame` 协议，因此 fusion 与 viewer **零改动**，
但感知层换成了我们自己的 Python 代码，且底层模型可以在运行中热切换：

| 后端名 | 说明 | 依赖 |
|---|---|---|
| `mediapipe-task` | MediaPipe FaceLandmarker，478 关键点 + 52 BlendShape | `models/face_landmarker.task` |
| `onnx-distilled` | 自训蒸馏 MLP（1434 关键点 → 52 BlendShape，ONNX 推理，Task 6 产物） | 上述 + `models/blendshape_mlp.onnx` |

新增模型后端：在 `backend/perception/` 下实现 `base.PerceptionBackend` 协议 + 一个 `info()`，
然后在 `perception/__init__.py` 的 `_FACTORIES` 登记一行。service / cli / 推流全部自动获得。

## 运行

PowerShell（仓库根目录 `D:\DASH\V0FastTest`）：

```powershell
$py = "D:\Miniconda3\python.exe"

# 单进程模式（推荐）：感知后端 + HTTP/WS 服务 + 静态托管前端，一条命令
& $py -m showcase.backend serve
# 浏览器打开 http://127.0.0.1:8770/  （钉板风前端页面）
# 前端通过 ws://127.0.0.1:8770/ws/face 订阅实时表情帧（含 landmarks）
# 摄像头画面经 /api/camera/stream（MJPEG）显示在前端左卡

# 兼容模式：同时把摄像头帧推给旧的 fusion 链路
& $py -m showcase.backend serve --fusion ws://127.0.0.1:8765
# 此时可再开 node fusion\server.mjs + viewer\index.html（V0 融合 viewer）

# 只用 API 面、不开摄像头：& $py -m showcase.backend serve --no-camera
```

**本地资产**（按仓库政策不入库，克隆后需自行补齐）：

- `frontend/assets/three-vrm-girl.vrm`：从 `viewer/models/` 拷贝
- `frontend/assets/img/`（桌面纹理 / 拍立得 / 图标）：由 Figma 设计稿导出（溯源见 `doc/SHOWCASE_FRONTEND_DESIGN.md` §14）

单张照片 / 视频文件的离线处理：

```powershell
& $py -m showcase.backend image deploy\assets\test_single.jpg --pretty
& $py -m showcase.backend video input.mp4 -o blendshapes.jsonl --stride 1
```

模型路径覆盖：`DASH_FACE_TASK`（.task）、`DASH_BLENDSHAPE_ONNX`（.onnx）。

## HTTP API（默认 http://127.0.0.1:8770）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 存活、当前后端、累计推理统计 |
| GET | `/api/backends` | 所有已注册后端及可用性 |
| POST | `/api/backend` | `{"name": "onnx-distilled"}` 热切换；404=名字不存在，409=模型文件缺失 |
| POST | `/api/photo` | raw body 或 multipart 上传图片 → `{blendshapes, headEuler, landmarks, inferenceMs}`；422=没检测到人脸 |
| POST | `/api/video` | multipart 上传视频 → NDJSON 流，每帧一行 `{frame, timestampMs, ok, blendshapes?}`；`?stride=N` 隔帧 |

## miniface-frame 消息契约（摄像头链路）

```json
{"type": "miniface-frame",
 "pts": 1726900000.123,
 "blendshapes": [{"categoryName": "jawOpen", "score": 0.42}, "... 共 52 项，顺序固定"],
 "headEuler": {"x": 1.0, "y": 2.0, "z": 3.0}}
```

52 个名字与顺序见 `backend/contract.py` 的 `BLENDSHAPE_NAMES`（ARKit 兼容序，
所有后端对齐到同一顺序，下游不感知具体模型）。注意 viewer 读 camelCase 的
`categoryName`，MediaPipe Python 输出 `category_name`，转换集中在 `contract.py`。

## 测试

```powershell
& $py -m pytest showcase\backend\tests
# 或跑全仓（pytest.ini 已把本目录加入 testpaths）
& $py -m pytest
```

服务面测试注入 FakeBackend，不依赖模型文件；真实模型的冒烟测试在
`models/face_landmarker.task` 缺失时自动跳过。
