# Model Adapter 接入约定

本目录只负责“模型 → CanonicalFrame”的适配，不负责视频播放、UI 或读数绘制。

## 默认模型

`mediapipe-task` 由 `mediapipeAdapter.js` 实现，保持当前 MediaPipe 行为：

- 478 landmarks
- 52 blendshapes
- headEuler
- 同一模型同时创建 VIDEO / IMAGE 两个实例

## 新模型接入

在 `models/manifest.json` 追加一条：

```json
{
  "name": "custom-face",
  "kind": "module",
  "module": "src/adapters/customAdapter.js",
  "url": "models/custom-face.onnx",
  "version": "0.1.0",
  "outputSchema": "canonical-face-v1",
  "default": false
}
```

新增 `src/adapters/customAdapter.js`，导出：

```js
export function createAdapter(entry, options = {}) {
  return {
    id: entry.name,
    version: entry.version,
    contractVersion: 1,
    capabilities: {
      landmarks: null,
      blendshapes: 52,
      headEuler: false,
      mesh: false,
      temporal: false,
    },
    async init() {},
    async infer(input, timestampMs) {},
    async close() {},
  };
}
```

`infer()` 返回：

```js
{
  timestampMs,
  landmarks: [{ x, y, z }],          // 可选
  blendshapes: [{ categoryName, score }], // 可选
  headEuler: { x, y, z }             // 可选
}
```

无检测结果返回 `null`。

## 约束

- `manifest.models[].name` 是主键；`id` 仅作可选别名，不参与缓存和切换。
- `contractVersion` 必须为 `1`；`outputSchema` 目前只支持 `canonical-face-v1`，否则 registry 直接拒绝。
- 不修改 `main.js`、`video/pipeline.js`、`readout.js`、`avatar.js` 即可接入新模型。
- `kind: "module"` 的 `module` 必须是同源相对路径。
- 有状态/时序模型需要实现 `reset()`，并声明 `capabilities.temporal = true`；pipeline 会在处理前调用。
- 新模型 `init()` 失败时，`main.js` 会尝试回退到 MediaPipe；切换失败时也会回退到 MediaPipe。
- 可选字段缺失时，UI 会降级：无 landmarks 隐藏网格，无 blendshapes 显示“该模型无表情输出”，无 headEuler 时头部回中性。
- 返回 `null`、`{}`、空数组时按无输出处理。
- 模型权重不要提交到仓库；用本地 `models/` 或独立分发。
