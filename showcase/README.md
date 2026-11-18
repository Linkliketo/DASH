# DASH 数字虚拟人 demo —— showcase

面向游戏数字人的展示 demo：照片 / 视频 / 摄像头三种输入 → 52 维 BlendShape + 头部姿态 → 驱动 VRM 数字虚拟人。

**架构现状（2026-10-14 起）**：感知层已全部搬到浏览器（MediaPipe Tasks JS，vendored），
**服务器只做静态托管 + 模型分发**——前端零后端依赖，任何静态服务器都能跑；
摄像头实时需要 secure context（localhost 或 HTTPS，裸 HTTP 的公网 IP 被浏览器禁用摄像头 API）。
Python 后端（`backend/`）保留为开发调试工具与旧 fusion 链路，前端不再调用其推理 API。

## 模型分发（更新模型 = 换文件 + 版本号 +1）

- `frontend/models/manifest.json`：模型清单，入库；每条包含 `name / kind / url / version / sizeBytes`。
  `kind` 取 `perception`（感知模型）或 `avatar`（VRM 数字虚拟人）；旧条目没有 `kind` 时按 `perception` 处理。
- 感知模型与数字虚拟人共用同一套 manifest + IndexedDB 缓存，但两个下拉严格按 `kind` 过滤，语义不混用。
- 浏览器每次打开页面拉 manifest 比对版本 → 变了才下载 → IndexedDB 缓存。
- 数字虚拟人**懒加载**：页面启动只加载感知模型；第一次开始演示、开始性能测试或手动切换数字虚拟人时才下载/解析 VRM，
  预览区显示下载百分比与解析状态，第二次切换命中 IndexedDB。
- 模型本体（`face_landmarker.task`、`*.vrm`）按仓库政策不入库，需上传到部署目录；
  `assets/vrm/sample-a.vrm`、`assets/vrm/sample-b.vrm` 是本地登记的两个 VRoid 样例，部署时需另行上传。
- 发布新模型/数字虚拟人：文件放进对应目录 + manifest 版本号 +1，访客下次打开自动更新。

## 摄像头镜像

摄像头预览是镜像的（自拍习惯），但 MediaPipe 输入是未镜像的原始帧。驱动 VRM 时对 head yaw / roll 取反、
左右眼视线交换；head pitch 统一取反（facialTransformationMatrix 的 pitch 方向与 VRM head 骨骼相反）。
照片 / 视频预览不镜像，只做 pitch 修正。规则集中在 `src/mirror.js`。

## 面部映射（P0-1）

- `src/vrm_face/facemap.mjs` 是从 `tools/vrm_face/facemap.mjs` vendored 的纯 ES module（P0-1），
  `avatar.js` 直接引用；同步时保持文件内容一致。
- 按运行时 `expressionMap` 解析实际名称：`happy` / `sad` / `Surprised` / `relaxed` / `aa/ih/ou/ee/oh`，
  不再硬编码 `joy/sorrow/surprise`。
- 摄像头连续帧使用 `FaceMapper`：30 帧中性校准 + 非对称平滑；照片 / 视频使用无校准、无平滑的
  `snapMapper`，避免单帧被当成中性样本。
- 视线优先写入骨骼 `vrm.lookAt.yaw/pitch`，并设置 `autoUpdate = false`；没有骨骼 lookAt 时回退到 look expression。
  注意 three-vrm 3.5 的 `applier.type` 是**静态属性**，接入层读的是 `applier.constructor.type`。
- P0-2 custom expression 已接入（默认仍走 preset）：vendored `src/vrm_face/morphscan.mjs`，加载时注入
  `arkit_*` expression；卡脚「面部映射」可在 `preset` / `custom` 间切换，选择写入 localStorage。
- 注意 VRM 0.x 的 `targetNames` 在 `primitive.extras`，three.js GLTFLoader 只读 `mesh.extras.targetNames`，
  所以加载后会按 `parser.associations` 把名称补进 `morphTargetDictionary`；否则 custom 扫描会得到 0 个通道。
- 实测 custom 数量：`sample-a` 20，`sample-b` / `three-vrm-girl` 21。custom 模式不写 `happy/sad/...` preset，
  切换时统一 `resetValues()`，避免双重计数。

## 性能测试（ZONE 03）

页面在数字虚拟人预览与「了解更多」之间提供一键性能测试：

| 项 | 说明 |
|---|---|
| 信号源 | 内置头像（隐藏输入，不渲染到页面）、本地图片、本地视频、摄像头 |
| 配置 | 按时长（5–600 s，默认 30 s）或按帧数（30–3000 帧，默认 300 帧） |
| 采集 | 端到端 FPS、感知推理耗时、rig+渲染耗时、帧间隔、超预算帧、人脸检出率 |
| 媒体信息 | 原始分辨率、处理分辨率、加载/启动耗时（ms）、视频/摄像头实测帧率、标称帧率 |
| 判定 | 平均 FPS ≥ 30；平均工作量 ≤ 33.3 ms；P95 工作量 ≤ 40 ms（1.2× 长尾容忍）。P95 工作量 > 33.3 ms 或工作量超预算帧 > 10% 时标记「通过（有告警）」 |
| 隐私 | 明确标注本次是否调用摄像头；所有来源的画面都只在本机处理，不上传 |
| 导出 | 复制 Markdown 表格；下载 JSON（`dash.benchmark.v1`）或 CSV |

口径：预热 1 s 不计入；端到端 FPS 取测量窗口内 VRM 渲染帧数；感知耗时只统计 `detectForVideo`；
rig+渲染来自渲染循环埋点；工作量 = 感知 + 表情映射 + rig + 渲染。帧间隔取 rAF 时间戳，
但只作调度诊断：显示刷新率会把间隔量化为刷新周期的整数倍（例如 40 Hz 屏幕上的 25 / 50 ms），
28 ms 的帧在 33.3 ms 预算内却可能表现为 50 ms 间隔，因此不能单独用帧间隔判定算力不足。
后台标签页会中止测试并标注结果无效。

内置头像仅作为测试输入，通过 `Image` 对象在内存中解码，**不会插入 DOM、也不会在页面上显示**；
报告里只记录它的分辨率、加载耗时与人脸检出率。软件渲染（如无 GPU 的 headless 浏览器）会显著拉低 FPS，
正式数据请在本机 Chrome 上复测。

## 运行（前端，纯静态即可）

```powershell
# 方式一：用 Python 后端托管（顺带提供旧 API）
cd D:\DASH\V0FastTest
& D:\Miniconda3\python.exe -m showcase.backend serve --no-camera

# 方式二：任意静态服务器（云端 Nginx 同款）
cd D:\DASH\V0FastTest\showcase\frontend
& D:\Miniconda3\python.exe -m http.server 8770
```

浏览器打开 `http://127.0.0.1:8770/`（或 localhost——摄像头模式必须 secure context）。

## 后端在后端管线里的位置（开发/调试用，保留）

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



## 感知变体（mp_full / dash_ridge_mp478 / dash_mlp_mp478）

- `mp_full`：现有 MediaPipe Full，MediaPipe 输出 478 landmarks、52 blendshapes、头部矩阵。
- `dash_ridge_mp478`：MediaPipe 只提供 478 landmarks 与头部矩阵，Ridge ONNX 输出 52；不是替换 MediaPipe。
- `dash_mlp_mp478`：同上，52 维来自 MLP ONNX。
- `mp_partial`：MediaPipe 只跑 landmarks/头姿、关闭 52 维 blendshape，无 ONNX；仅作为性能对照。
- 入口：`?variant=mp_full|mp_partial|dash_ridge_mp478|dash_mlp_mp478`；标准测试可叠加 `?bench=collect&seconds=30&variant=...`。
- 同帧 parity：`/shadow.html?seconds=10`，输出 JSONL；MediaPipe 保持 blendshapes=true，同一组 landmarks 同时跑 Ridge/MLP。
- 三个变体独立 run、独立 CSV/meta；52 维 ONNX 输出先 clamp 到 `[0,1]`。
- `model_sha256`、`mediapipe_blendshapes_enabled`、`ort_provider`、`model_load_ms` 写入 meta；逐帧 CSV 增加 `onnx_ms` 与变体字段。
- `mapping_ms` 仍是 VRM 映射耗时，不是 ONNX 延迟；`work_ms` 已包含 `onnx_ms`。
- 当前只是把 ONNX 旁路/变体接入；是否关闭 MediaPipe blendshape 头后真正省时、是否达到 MediaPipe 质量，仍未验证。
- ONNX Runtime Web 与 ONNX 文件是静态资源；默认 `mp_full` 不加载 ORT/WASM。

## 持续负载采集（标准测试）

用于论文补充数据；原 ZONE 03 保留为“快速测试”，两者在同一张性能测试卡内切换。

- 入口：主页 ZONE 03 点击“标准测试”；或 `/?bench=collect&seconds=30&label=i5-8250U`。短测用 `&seconds=2`。
- “快速测试”是原有 ZONE 03；“标准测试”固定本地视频，隐藏视频画面，只显示总进度与结果。
- 标准测试可直接开始；“终止 Benchmark”会保留已完成数据，可下载后重新开始。
- “下载数据包 ZIP”只在已有数据时出现；未跑过或正在跑时不显示。
- 固定本地视频 `assets/bench/single-face-30fps.mp4`（1280×720，30 FPS，9.47 s，SHA-256 `587d6a16…14ad9`）；
  固定 `vrm-girl 1.0.0`；不调用摄像头、不上传。
- 10 轮连续运行；第 1 轮按 cold 标记，2–10 轮 warm；每轮 30 s，无 60 s 冷却；每轮视频回到 0 s。
- 页面不要求勾选冷启动；如需真 cold 首轮，请用全新 profile 或清除站点数据；`cold_start_confirmed` 记为 false。
- 原始逐帧 CSV 保留前 1 s，汇总时剔除 `timestamp_ms < 1000`（`seconds<=3` 时窗口为 0）。
- 输出一个 ZIP 数据包，内含 22 列合并 CSV（原 17 列 + `onnx_ms`、`perception_variant`、`blendshape_source`、`model_sha256`、`mediapipe_blendshapes_enabled`）与 `run_meta.json`；UI 只显示 Benchmark 状态、预计剩余时间与最终平均 FPS，逐轮明细在数据包中。
- 30 s ×10 约 5 分钟；2 s 短测约 30 秒（含加载准备）。
- 采集模式建议在正常（有显示）的 Chrome/Edge 中运行；headless/软件渲染可能无法初始化视频尺寸。
- 视频文件按 `.gitignore`（`*.mp4`）不入库，部署采集环境时需单独上传；授权与 hash 见 `assets/bench/README.md`。
