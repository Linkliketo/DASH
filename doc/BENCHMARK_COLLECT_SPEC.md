# DASH Web Benchmark 持续负载采集模式：实现说明

> 给 DASH-web 的编码交接单。
> 目标：在 ZONE 03 增加一个隐藏的“持续负载采集”模式，用固定本地视频连续跑 10 次 30 s，导出逐帧 CSV 与运行元数据，供论文补充分析。
> 本文只描述实现，不改现有默认 Benchmark 行为。

---

## 1. 结论与边界

这个模式只回答一个问题：

> 同一台设备、同一段视频、同一个 VRM，连续运行 10 次 30 s，每次真实 FPS 是多少，10 次平均是多少。

它**不是**：

- 不是独立重复实验，不计算方差、P95、IQR、置信区间。
- 不是 PASS/FAIL 判定，不替代现有 v2 判定。
- 不做设备排名，不做刷新率分层。
- 不读取温度、功耗、降频、其他后台应用负载；这些字段写“未测”或 `null`。
- 不调用摄像头，不上传图像，不自动上传 CSV。
- 不改默认 ZONE 03 的现有测试流程。

论文主表继续使用已有的 10 台设备 v2 数据；本模式只作为“持续负载采集”的补充数据。

---

## 2. 用户流程

1. 用户打开 `?bench=collect`（可选 `&seconds=30&label=...`）。
2. 页面显示采集说明：本地视频、不调用摄像头、不上传、约 5 分钟。
3. 页面不再要求手动确认冷启动；如需第 1 轮为真正的 cold，请使用全新 profile 或清除站点数据。meta 的 `cold_start_confirmed` 固定记录 `false`，分析时按 `repeat_index` 处理。
4. 加载固定 `vrm-girl 1.0.0`、固定感知模型、固定视频；全部 ready 后才开始计时。
5. 自动连续跑 10 轮，每轮：
   - 第 1 轮 `cache_state=cold`，第 2–10 轮 `cache_state=warm`。
   - 视频 `currentTime=0`，等待 `seeked` 与 `playing`/首帧回调。
   - 计时 30 s（短测用 `seconds=2`）。
   - 记录逐帧数据。
6. 10 轮结束后停止，页面显示总进度、最终平均 FPS 与“下载数据包 ZIP”按钮；逐轮明细写入 CSV/meta。
   - `dash-collect-<device>-<time>.zip`
     - `dash-collect-<device>-<time>.csv`
     - `dash-collect-<device>-<time>-meta.json`

没有 60 s 间隔；每轮复位视频后立即开始。原始数据保留前 1 s，汇总时剔除前 1000 ms（短测 `seconds<=3` 时 `analysis_window_ms=0`）。

---

## 3. 文件与职责

只改展示线，不动后端、不改 quant：

| 文件 | 改动 |
|---|---|
| `showcase/frontend/src/benchmark.js` | 新增采集模式、10 轮循环、17 列 CSV、meta、下载、汇总 |
| `showcase/frontend/src/avatar.js` | 暴露 `mappingMs`；确保不与 `rigMs`/`renderMs` 重复计时 |
| `showcase/frontend/src/main.js` | 解析 `?bench=collect`，强制 `vrm-girl`，隐藏摄像头入口，挂载采集 UI |
| `showcase/frontend/index.html` | 可选：采集面板容器；也可由 JS 动态创建 |
| `showcase/frontend/assets/bench/` | 放固定视频，例如 `single-face-30fps.mp4` |
| `showcase/README.md` | 补一段采集模式说明（可选） |

不要改 `benchmark-rules.js` 的 v2 判定；采集模式不调用 `evaluateVerdict`。

注意项目缓存规则：改前端 JS 后要统一 bump 模块版本（当前 `?v=13`，建议 bump 到 `?v=14`），并在 meta 记录 bump 后的版本。

---

## 4. 固定输入与资产

- 视频：`deploy/imgage_test/single_face_vedio_every_position.mp4`，1280×720，30 FPS，9.47 s，701 KB，SHA-256 前缀 `587d6a16…14ad9`。
- 复制到 `showcase/frontend/assets/bench/single-face-30fps.mp4`；源文件不改。
- 视频设置 `loop=true`、`muted=true`、`playsinline=true`、`preload="auto"`。
- 固定角色：`vrm-girl` 1.0.0；采集模式禁用 avatar/model 下拉，避免中途切换。
- 固定感知模型：`face_landmarker` 1.0.0。
- 视频循环到 30 s 会有 2–3 个接缝；代码不做特殊处理，但必须记录 `video_time_ms`，分析时可自行标记接缝。

---

## 5. CSV：17 列基线 + 变体字段

> 2026-10-27 模型接入后升级为 `COLLECT_SCHEMA=dash.benchmark.collect.v2`，CSV 为 22 列：
> 原 17 列 + `onnx_ms`、`perception_variant`、`blendshape_source`、`model_sha256`、`mediapipe_blendshapes_enabled`。
> 下表是原始 17 列基线；`work_ms` 现在包含 `onnx_ms`。

表头必须完全一致，顺序不能变：

```text
run_id,device_id,repeat_index,cache_state,timestamp_ms,video_time_ms,frame_index,perception_ms,mapping_ms,rig_ms,render_ms,work_ms,frame_interval_ms,face_detected,over_budget_work,over_budget_interval,visibility_state
```

字段约定：

| 字段 | 类型 | 说明 |
|---|---|---|
| `run_id` | string | 每轮唯一，例如 `<device_id>-<YYYYMMDDHHMMSS>` |
| `device_id` | string | 本机随机 UUID，存 localStorage；不含个人信息 |
| `repeat_index` | int | 1–10 |
| `cache_state` | string | `cold` / `warm` |
| `timestamp_ms` | int | 相对本轮开始的毫秒 |
| `video_time_ms` | int | `video.currentTime * 1000`；循环时回绕 |
| `frame_index` | int | 每轮从 0 开始 |
| `perception_ms` | float | 只包 `detectForVideo` |
| `mapping_ms` | float | 只包表情映射/写入，不含 rig/render |
| `rig_ms` | float | `vrm.update` |
| `render_ms` | float | `renderer.render` |
| `work_ms` | float | `perception + mapping + rig + render` |
| `frame_interval_ms` | float | 当前与上一 rAF 时间戳差；首帧写 0 |
| `face_detected` | 1/0 | 本帧是否检出人脸 |
| `over_budget_work` | 1/0 | `work_ms > 33.3` |
| `over_budget_interval` | 1/0 | `frame_interval_ms > 33.3`；首帧为 0 |
| `visibility_state` | 1/0 | 1=visible，0=hidden |

数值保留 3 位小数；布尔值必须是 `1`/`0`，不要写 `true/false`。CSV 用 UTF-8 BOM，Excel 可直接打开。首帧 `frame_interval_ms=0`、`over_budget_interval=0`。

工作量的口径与现有 Benchmark 保持一致：不含测试页 canvas 重采样/绘制视频到 640×480 的时间；`perception_ms` 只统计 `detectForVideo`。

---

## 6. `run_meta.json`

每个 device/批次一个 JSON，至少包含：

```json
{
  "schema": "dash.benchmark.collect.v1",
  "collected_at": "2026-10-21T19:30:00+08:00",
  "device_id": "uuid",
  "device_label": "用户填写或空字符串",
  "ua": "...",
  "platform": "...",
  "hardware_concurrency": 8,
  "device_memory_gb": null,
  "gpu_renderer": "...",
  "wasm_simd": true,
  "screen": "1440x900",
  "viewport": "1432x768",
  "dpr": 2,
  "refresh_hz": 40,
  "input": {
    "path": "assets/bench/single-face-30fps.mp4",
    "sha256": "587d6a16...14ad9",
    "duration_s": 9.47,
    "width": 1280,
    "height": 720,
    "fps": 30
  },
  "avatar": {"name": "vrm-girl", "version": "1.0.0"},
  "perception_model": "face_landmarker 1.0.0",
  "frontend_version": "v14",
  "run_seconds": 30,
  "analysis_window_ms": 1000,
  "cold_start_confirmed": false,
  "unobserved": ["temperature", "power", "thermal_throttling", "background_apps"],
  "runs": [
    {
      "repeat_index": 1,
      "run_id": "...",
      "cache_state": "cold",
      "load_ms": null,
      "startup_ms": null,
      "valid": true,
      "invalid_reason": null,
      "face_detection_ratio": 1.0,
      "fps": 33.9,
      "frame_count": 1019
    }
  ],
  "valid_runs": 10,
  "invalid_runs": 0,
  "average_fps": 33.9
}
```

浏览器拿不到的字段写 `null` 或放入 `unobserved`，不要估算。`device_label` 可由用户填写（例如 `i5-8250U / RTX 4060`），不填就用 UA + WebGL renderer。`load_ms`/`startup_ms` 能取就取，不能取写 `null`。

---

## 7. 计时与有效性规则

### 7.1 每轮开始

1. `video.currentTime = 0`。
2. 等待 `seeked` 事件；再等待 `playing` 与 `requestVideoFrameCallback` 首帧。
3. 记录 `t0 = performance.now()`，开始本轮 30 s 计时。
4. 不额外做 1 s 预热；原始 CSV 保留前 1 s，汇总时剔除 `timestamp_ms < 1000` 的帧（短测 `seconds<=3` 时分析窗为 0）。

### 7.2 每帧

- 用 `performance.now()` 分别包 `detectForVideo`、映射、`vrm.update`、`renderer.render`。
- `work_ms` 直接相加，不要再加 `frame_interval_ms`。
- `face_detected` 来自 `toFrame()` 是否返回非空；无人脸时 `mapping_ms=0`，其余照常计时。
- `frame_interval_ms` 用 rAF 时间戳差，不用 `performance.now()` 差，保持与现有 benchmark 一致。

### 7.3 无效运行

- 运行中 `document.hidden === true`：立即停止本轮，标记 `valid=false`、`invalid_reason="hidden"`；该轮不计入平均。
- 人脸检出率低于 50%：标记 `valid=false`、`invalid_reason="low_face_detection"`；不计入平均。
- 其他异常（视频 seek 失败、模型未 ready）：本轮无效，记录原因。
- 无效轮不自动重跑；UI 在结束时提示“部分数据无效”，用户可重新打开采集模式。为保持简单，不做“重跑本轮”按钮。

### 7.4 汇总

- 每轮 FPS：在有效分析窗内，`measured_frames / (elapsed_ms / 1000)`，其中 `elapsed_ms = 最后一个有效帧 timestamp - 第一个有效帧 timestamp`；若不足 2 帧，记 0 并标无效。
- 10 次平均：只对 `valid=true` 的轮次取算术平均；`valid_runs/10` 写入 CSV/meta，UI 只在结束时显示最终平均或“部分数据无效”。
- 不计算 P95、IQR、PASS/FAIL、排名。
- 有效窗口 FPS 写入 CSV/meta；UI 只显示最终平均，避免把 30 s 原始窗口与 1–30 s 窗口混为一谈。

---

## 8. UI 要求

产品口径（2026-10-21 更新）：前端只需要知道“正在跑 Benchmark / 已完成”和大致时长，内部轮次细节留在 CSV/meta。

ZONE 03 同一张性能测试卡内提供两个切换按钮：

- 快速测试：原有 ZONE 03，行为不变。
- 标准测试：固定视频的持续负载采集；隐藏视频画面，只显示进度与状态。

标准测试只显示：

- 状态“准备 Benchmark / Benchmark 进行中 / Benchmark 完成”，10 轮合计的总进度条与预计剩余时间。
- “终止 Benchmark”按钮；终止后保留已完成数据，允许下载，并可再次开始。
- 总时长提示（30 s ×10 约 5 分钟；2 s 短测约 30 秒，含加载准备）。
- 最终有效平均 FPS；若存在无效轮，显示“部分数据无效”。
- “下载数据包 ZIP”一个按钮，包内含 CSV 与 meta JSON；未跑过或正在跑时隐藏，完成/终止且有数据后显示。
- 隐私说明：本地视频、不调用摄像头、不上传、手动导出。

不要显示：

- 轮次编号 `n/10`、`cold/warm`、逐轮 FPS 列表、逐帧剔除细节。
- PASS/FAIL、P95、IQR、刷新率分层、设备排名。
- 摄像头入口、avatar 切换、模型切换。

快速测试保持原 ZONE 03 行为；标准测试通过卡片内按钮切换，`?bench=collect` 可直接打开标准测试。标准测试使用固定 `vrm-girl`，并隐藏视频画面与头像切换。

---

## 9. 实现顺序

1. `avatar.js`：让 `applyFrame`/`setBlendshapes` 返回 `mappingMs`，写入 `lastTiming`；确认 `rigMs` 与 `renderMs` 的边界不变。
2. `benchmark.js`：新增 `COLLECT_SCHEMA`、`COLLECT_HEADER`、`runCollectMode()`、`buildMeta()`、`downloadCsv()`、`downloadJson()`；保留现有 v2 代码路径。
3. `main.js`：解析 `?bench=collect`，强制 `vrm-girl`，加载固定视频，挂载采集 UI；默认路径不变。
4. `index.html`/样式：加采集面板容器和下载按钮；无新依赖。
5. 复制视频到 `assets/bench/`；记录 hash/size/duration。
6. bump 模块版本；更新 `showcase/README.md` 的采集说明。

---

## 10. 验收

### 10.1 2 s 短测

打开：

```text
http://127.0.0.1:8770/?bench=collect&seconds=2
```

必须满足：

- 10 轮全部跑完，每轮 `run_id` 不同。
- CSV 表头严格为 17 列，顺序与第 5 节一致。
- 每轮行数 > 0；`frame_index` 从 0 递增。
- `work_ms` 与 `perception+mapping+rig+render` 误差 < 0.01 ms。
- `video_time_ms` 在每轮内递增，循环时回绕。
- 第 1 轮按 `cold` 标记，第 2–10 轮 `warm`；cold 未由页面确认，分析时按 `repeat_index` 或自行剔除首轮。
- 能下载一个 ZIP，包内含合并 CSV 与 meta JSON；JSON 可解析。
- 默认 `http://127.0.0.1:8770/` 的 ZONE 03 行为不变。

### 10.2 30 s 正式采集

```text
http://127.0.0.1:8770/?bench=collect&seconds=30
```

- 每轮 30 s，合计约 5 分钟。
- 采集期间不切换标签页；若 hidden，该轮应标记无效。
- 10 轮结束后停止，不自动重跑；用户下载一个 ZIP 数据包。
- 记录 `valid_runs/10` 与平均 FPS。

### 10.3 回归

```bash
node --test showcase/frontend/tests/*.test.mjs
python -m pytest -q
```

现有 8 个前端工具测试与 42 个 pytest 用例应保持通过；采集模式不应改变默认 benchmark 的判定。

---

## 11. 隐私与上线

- 负责人已同意该视频用于测试；页面仍需注明“测试视频，非用户摄像头画面”。
- 不调用摄像头、不上传图像、不自动上传采集文件；用户手动下载后自行反馈。
- 只通过 `?bench=collect` 或隐藏入口开放，不默认展示 5 分钟采集流程。
- 论文中写“持续负载采集（sustained-load collection）”，不写“独立重复”“方差”“P95”“PASS/FAIL”“设备排名”。
- 环境项只写浏览器可得的 UA、GPU renderer、逻辑核、屏幕、DPR、刷新率；温度/功耗/降频/后台应用写“未测”。

---

## 12. 交付物

- 修改后的 `benchmark.js`、`avatar.js`、`main.js`、必要的 HTML/CSS。
- `assets/bench/single-face-30fps.mp4` 与 hash 记录。
- 2 s 短测的 CSV + meta 样例（可只保留 1–2 轮，避免仓库膨胀；正式数据不入库）。
- 一段 `showcase/README.md` 说明：如何进入采集模式、如何导出、如何解读。
- 不改后端、不改 quant、不做 git 提交。
