# DASH 展示前端设计规格（皮套人 Demo）

> 本文件是**纯设计描述**，不含实现代码。写给下一个会话（Window）：读完本文件应能**一次性**把这个前端实现出来，无需再提问。
> 若本文件与仓库实际文件冲突，以实际文件为准。最后更新：2026-09-25。
> 语言：中文；术语保留英文原词；任何环境一律不用 emoji。

---

## 0. 这个文件怎么用

- **目标读者**：下一个要实现这个前端的会话。你没有历史记忆，本文件自包含。
- **不要做的事**：不要问用户「要什么风格」「放哪」——本文件已定。依赖政策见 §9（动效与美观优先，默认零构建）。
- **要做的唯一一件事**：按本文件实现，并达到 §11 的验收标准。

---

## 1. 一句话目标

一个**纯浏览器**页面：用户对着摄像头（或丢入照片 / 视频），页面**实时**把表情提取出来，驱动一个 3D 皮套人（VRM 角色）模仿——以此证明「表情建模」这条管线真的能跑。

**这个页面的唯一任务（single job）**：让一个第一次打开它的人，在 10 秒内看到「我的脸 → 网格 → 皮套人」的完整过程，并立刻明白「模型在工作」。

---

## 2. 用户与场景

| 项 | 值 |
|---|---|
| 主要观众 | 项目导师（中文，技术背景） |
| 次要观众 | 大创评审、同学 |
| 主要场合 | 本地笔记本上演示（live demo） |
| 次要场合 | 部署成静态 URL 随时打开；录屏放进展报 |

**由此定的优先级**：live demo 必须**零故障**；同时因为是纯静态页面，部署成 URL 是免费附带的能力。录屏素材靠 demo 本身好看自然产生，不专门做导出功能。

---

## 3. 设计哲学（为什么长这样，不是套模板）

视觉基底：Figma 设计稿「video-to-3d-sticky-homepage」（溯源见 §14），由用户指定为本页面的设计（2026-09-25）。它的「世界」是**工作室钉板（studio pinboard）**：一张带桌面纹理的木桌，上面钉着素材卡、渲染卡、拍立得、便签、美纹纸胶带和图钉。

这个世界恰好就是动捕管线的世界——采集素材 → 处理 → 成片，钉板上的每张卡片就是管线上的一个工位：

| 决定 | 来自主题的什么 | 为什么不是默认模板 |
|---|---|---|
| 桌面纹理 + 米色纸卡 | 动捕工作室的工作台：素材、报告、照片都钉在板上 | 是「主题的真实材质」，不是随便选个浅色 |
| 输入卡米色 / 输出卡浅蓝 | 输入是「原材料」，输出是「蓝图（blueprint）」 | 两卡异色 = 数据发生了真实变换，不是装饰性配色 |
| ZONE 01 / 02 编号 | 管线**本来就是有顺序的** | 编号承载数据流向，不是装饰 |
| 衬线大标题 + 等宽小字 | 拍立得手写标注 + 仪器读数的混合气质 | 避开千篇一律的无衬线 SaaS 排版 |
| 动效是一等公民 | 动捕本身就是「运动的数据」 | 模板页只有静态排版；这个页面的核心数据（表情流）天然是动的，动效是内容不是装饰 |

**签名元素（signature）**：底部横条的**实时表情读数条**——占据 Figma 稿里 DemoStrip（拍立得横条）的位置，内容是我们的：52 个 BlendShape 里最活跃的前几个，「动画条 + 等宽数字」每帧滚动。它把「模型正在计算」这件平时被藏起来的事变成页面的一等主角；视觉上是一张长条纸卡，与桌面其他纸件同构。

**一次有理由的冒险**：把原始模型输出（数字、等宽字体、动画条）当作 hero 元素之一，而不是塞进角落。多数 demo 只给你看角色；这个页面偏要让你同时看到角色和支撑它的数据——因为这是一个「建模」demo，不是 VTuber 应用。

**反模式自查**：钉板风容易滑向「过度装饰的剪贴簿」。约束：每张纸件都必须承载功能（输入卡、渲染卡、读数条、状态条、指南便签）；纯装饰元素（图钉、胶带）只允许出现在卡片固定点，不进入内容区。

---

## 4. 用户流程与状态机

### 4.1 三种输入模式（同一管线，三种触发）

| 模式 | 输入源 | 输出形态 |
|---|---|---|
| **camera（默认 / hero）** | 摄像头实时流 | 皮套人实时模仿 |
| photo | 图片文件（点击选择或拖入） | 皮套人摆出该帧表情（静态） |
| video | 视频文件 | 皮套人逐帧模仿，带进度条 |

### 4.2 状态机

```
        ┌──────────┐
        │ landing  │  落地：三张输入卡 + 拖放区
        └────┬─────┘
   选摄像头/传照片/传视频
             ▼
        ┌──────────┐  模型未就绪时
        │ loading  │  「正在加载模型…」+ 进度
        └────┬─────┘
             ▼
        ┌──────────┐  主状态：双视图 + 读数条
        │  stage   │ ────────────────────────┐
        └────┬─────┘                          │
             │ 帧内无人脸（>0.5s）             │ 摄像头权限被拒 / 无 WebGL / 模型加载失败
             ▼                                ▼
        ┌──────────┐                    ┌──────────┐
        │ no-face  │  「把脸放进画面里」  │  error   │  具体原因 + 下一步动作
        └──────────┘                    └──────────┘
```

**任何状态都能回到 landing**（顶部「停止 / 重新选择」）。

### 4.3 关键行为规则

- camera 模式下人脸**短暂**消失（<0.5s）不清空皮套人，保持上一帧，避免闪烁；**持续**消失才进 no-face。
- 权限被拒时，**自动降级**到 photo 模式并提示「摄像头不可用，改用照片试试」——不让用户卡在错误页。
- 帧率 < 15 FPS 时**自动降级**：先把感知输入分辨率减半，再不行就隔帧处理（每 2 帧算 1 帧）。降级要在界面上可见（一个小的「已降分辨率以保帧率」提示），不能悄悄降。

---

## 5. 布局（ASCII 线框）

### 5.1 landing 态（静态稿 = Figma 主页面）

```
┌─────────────────────────── 桌面纹理背景 ───────────────────────────┐
│ [便签·新]   ┌────── TopStatusBar（浮动纸卡，胶带贴角）──────┐      │
│             │ DASH · 微表情皮套人  v0.1   钉板工作室 · ● 待机 │     │
│             └──────────────────────────────────────────────┘      │
│ ┌─ InputCard（米色纸卡，仅左下大圆角）─┐ ┌─ OutputCard（浅蓝纸卡，仅左上大圆角）─┐ │
│ │ [ ZONE 01 : 输入 ]                 │ │ [ ZONE 02 : 皮套人 ]                │ │
│ │ 把你的表情放上来                   │ │ 皮套人预览                          │ │
│ │ ┌─ Dropzone（虚线框）───────────┐ │ │ ┌─ RenderBox ──────────────────┐  │ │
│ │ │ 拖入照片 / 视频                │ │ │ │                              │  │ │
│ │ │ [ 用摄像头开始 ] [ 浏览文件 ]   │ │ │ │     待启动的 VRM 舞台          │  │ │
│ │ └───────────────────────────────┘ │ │ └──────────────────────────────┘  │ │
│ │ * 全程本地运行 · 不上传任何图像     │ │ 网格叠加: 开 ▾        [ 开始演示 ▶ ] │ │
│ └───────────────────────────────────┘ └────────────────────────────────────┘ │
│ ┌─ 示例横条（长纸卡，图钉×2）───────────────────────────────────────────────┐ │
│ │ 近期示例   [polaroid] [polaroid] [polaroid] [polaroid]                     │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 stage 态（camera，hero 状态；布局不变，纸件内容切换）

- **InputCard**：Dropzone 换成「实时画面 + 478 网格叠加」（video + canvas 同层），卡角等宽小字「● 28 FPS」。
- **OutputCard**：RenderBox 变成 three.js 画布，皮套人实时模仿；右上「后端: mediapipe-task ▾」随时热切换（走后端 `/api/backend`，不重启）。
- **底部横条**：示例拍立得切换为**实时表情读数条**——`jawOpen ▓▓▓▓▓░░ 0.62   眨眼·左 ▓▓░░░░ 0.31 …`（等宽数字，每帧更新）。
- **TopStatusBar**：状态变「● 运行中」，右侧出现 [ 停止 ]。

### 5.3 photo / video 态（stage 的变体，不另画整图）

- **photo**：InputCard 换成「照片 + 网格」（静态叠加），右卡的皮套人**定格**在该帧表情，读数条显示该帧的 52 值（静态）。卡下出现「换一张 / 对比原图」两个操作。
- **video**：与 camera 几乎相同，但状态条把「● FPS」换成「播放 / 暂停 + 进度条」，可拖动。

### 5.4 布局要点

- 桌面优先（这是 demo，不做移动端排版，但要能缩到 1280px 宽不破版）；Figma 原稿 1200×800，按此比例起稿。
- 两张主卡**等高、等宽**，大圆角相对（输入卡左下、输出卡左上），中间的留白就是「数据流向」。
- 读数条 / 示例横条**贯穿整宽**，是视觉上的「地基」。
- TopStatusBar 极薄（≤72px），只放：品牌、版本、状态、停止。
- 装饰物（图钉、胶带、便签）只钉在卡片边角，不进入内容区、不遮挡任何读数。

---

## 6. 设计 Token

### 6.1 颜色（11 个命名值，全部写进 CSS 变量）

| Token | 值 | 用途 |
|---|---|---|
| `--desk` | `#E6DEC4` | 桌面底色（上叠桌面纹理图） |
| `--paper` | `#FFFDF2` | 输入卡、通用纸卡 |
| `--paper-blue` | `#E0F2FE` | 输出卡（蓝图） |
| `--paper-line` | `#E2D9B8` | 纸卡描边、分隔线 |
| `--ink` | `#1E293B` | 主文字 |
| `--ink-soft` | `#475569` | 次级文字、卡副标题 |
| `--muted` | `#64748B` | 标注、脚注 |
| `--accent` | `#2563EB` | 主按钮、激活态 |
| `--accent-ink` | `#1E3A8A` | 蓝卡标题、深色强调 |
| `--marker` | `#0EA5E9` | 人脸网格、追踪点（在视频画面上要足够醒目） |
| `--tape` | `rgba(255,255,255,0.54)` | 美纹纸胶带（带 0.5px `#D1C7A5` 边） |

**对比度**：`--ink` 对 `--paper` ≥ 12:1；`--accent` / `--marker` 用于图形与强调，不用于长正文。

### 6.2 字体（3 个角色，与 Figma 原稿一致）

| 角色 | 字体栈 | 用途 |
|---|---|---|
| display | `"Instrument Serif", "Noto Serif SC", serif` | 大标题、卡片标题（手写标注感） |
| body | `Geist, system-ui, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif` | 正文、按钮、标签 |
| mono | `"Geist Mono", ui-monospace, "SF Mono", Consolas, monospace` | **所有数据**：BlendShape 读数、FPS、坐标、编号 |

**规则**：标题用 display（克制，只在大标题和卡标题上用）；**一切数值一律 mono**——Figma 原稿本身就是这个排法，与「仪器感」规则天然一致。

### 6.3 间距、圆角与阴影

- 基础间距单位 8px（8 / 16 / 24 / 32 / 48）。
- 圆角：纸卡 4px + **单角 36px**（输入卡左下、输出卡左上，两卡大圆角相对）；按钮 6px；便签 / 胶带 / 拍立得 2px。**不要全站一个圆角值**。
- 阴影：允许，且是材质的一部分——纸卡用偏移「提起感」阴影（基准 `4px 12px 20px rgba(45,35,25,.24)`，输出卡镜像为 `-4px`），再叠一条 `inset` 高光；不用弥散发光阴影。

### 6.4 签名元素（再强调一次）

底部**实时表情读数条**：横向贯穿，列出当前最活跃的前 6–8 个 BlendShape，每条 = `名称 + 横向动画条 + mono 数值`。**每帧更新**。这是页面被记住的那一处。

### 6.5 动效（与颜色 / 字体同级的 Token，不是事后补的修饰）

| Token | 值 | 用途 |
|---|---|---|
| `--dur-fast` | 120ms | hover、按钮反馈 |
| `--dur-base` | 240ms | 面板进出、卡片交互 |
| `--dur-slow` | 480ms | 状态切换（landing → stage）、overlay 淡入 |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | 默认出场曲线（easeOutExpo） |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 皮套人入场、卡片回弹 |

规则：

- 只动画 `transform` 与 `opacity`（硬件加速属性）；读数条的宽度变化用 `transform: scaleX`，**不动 `width`**。
- 每个状态切换至少一处动效：landing 卡片 hover 抬升、进入 stage 时皮套人从下方淡入弹起、读数条数值变化有过渡。
- 摄像头画面上的网格点每帧实时绘制（§8.5），不走 CSS 动效——它的「动」来自数据本身。
- 多元素依次入场等复杂编排用 GSAP 时间线，不手写 `setTimeout` 链。
- 纸卡入场要有「被钉上板」的感觉：±1° 的轻微随机旋转 + 图钉落下（translateY + 回弹），不要生硬的淡入。

---

## 7. 组件清单（前端视图层）

| 组件 | 职责 | 对应状态 |
|---|---|---|
| `TopBar` | 品牌、输入源切换下拉、FPS / 播放控制、停止按钮 | 所有 |
| `LandingView` | 三张输入卡 + 拖放区 | landing |
| `StageView` | 布局容器：左 `SourcePanel` + 右 `AvatarPanel` + 底部 `ReadoutStrip` | stage |
| `SourcePanel` | 显示 camera/photo/video 帧 + 在其上叠加 478 网格（2D canvas） | stage |
| `AvatarPanel` | three.js WebGL 画布，渲染 VRM 皮套人 | stage |
| `ReadoutStrip` | 签名元素：top-N BlendShape 动画条 | stage |
| `Overlay` | loading / no-face / error 的整页提示 | 各异常态 |

**文案口径（write from the user's side）**：
- 按钮说动作：「用摄像头开始」「换一张」「停止」，不说「提交」。
- 错误说原因和下一步：「摄像头没权限。点这里改用照片。」不道歉、不含糊。
- 空态是邀请：landing 的拖放区写「把照片或视频拖到这里」。

---

## 8. 数据流与技术映射（实现层）

### 8.1 模块划分（纯 JS，无框架）

| 模块 | 职责 | 输入 → 输出 |
|---|---|---|
| `input.js` | 三种来源统一为「帧序列」 | 摄像头流 / 图片 / 视频 → 逐帧 `HTMLVideoElement` 或 `ImageBitmap` |
| `perception.js` | MediaPipe FaceLandmarker 推理 | 帧 → `{ landmarks: (478,3), blendshapes: (52,) }` |
| `mesh.js` | 网格叠加绘制 | landmarks → 2D canvas 点线 |
| `avatar.js` | 皮套人驱动 | blendshapes → VRM expression |
| `readout.js` | 读数条 | blendshapes → top-N 排序 + 动画 |
| `main.js` | 状态机 + 组装（§4.2） | 用户操作 → 切换状态 |

### 8.2 感知（perception）

- 用 **MediaPipe Tasks Vision** 的 `FaceLandmarker`（**JS 版**，在浏览器里跑，与 deploy/ 的 Python 版是同一模型）。
- 配置：`outputFaceBlendshapes: true`、`outputFacialTransformationMatrixes: true`（可选，用于头部姿态）、`numFaces: 1`、camera 用 `runningMode: "VIDEO"`、photo 用 `"IMAGE"`。
- 模型文件：`face_landmarker.task`（**仓库已有**，3.6 MB，直接拷过来用）。
- 产出：每帧 478 个关键点（含 x/y/z）+ 52 个 BlendShape 分数（含 `categoryName` 与 `score`）。

### 8.3 BlendShape → VRM 映射表（**直接照搬，已验证**）

以下映射来自仓库 `viewer/index.html` 的 `applyFace`，已实测能驱动 VRM，**逐条照抄，不要重造**：

| VRM expression | 计算（从 52 个 ARKit BlendShape） |
|---|---|
| `blink` | `max(eyeBlinkLeft, eyeBlinkRight)` |
| `aa` | `jawOpen` |
| `joy` | `max(mouthSmileLeft, mouthSmileRight)` |
| `sorrow` | `max(mouthFrownLeft, mouthFrownRight)` |
| `angry` | `max(browDownLeft, browDownRight)` |
| `surprise` | `browUp*0.6 + jawOpen*0.4`，其中 `browUp = max(browInnerUp, browOuterUpLeft, browOuterUpRight)` |
| `lookUp` | `eyeLookUpLeft` |
| `lookDown` | `eyeLookDownLeft` |
| `lookLeft` | `eyeLookOutLeft` |
| `lookRight` | `eyeLookOutRight` |

每个值 `clamp(0,1)` 后用 `vrm.expressionManager.setValue(name, value)` 设置，并 `try/catch` 包裹（有的 VRM 缺某些 expression）。

### 8.4 VRM 加载与场景（**照搬 viewer/index.html 的已验证设置**）

- 加载：`GLTFLoader` + `VRMLoaderPlugin`，取 `gltf.userData.vrm`。
- `vrm.scene.rotation.y = Math.PI`（让角色面向镜头）。
- 灯光：`HemisphereLight(0xffffff, 0x888888, 1.8)` + `DirectionalLight(0xffffff, 1.4)`（位置 (2,3,3)）。
- 相机：`PerspectiveCamera(30, aspect, 0.1, 20)`，位置约 `(0, 1.2, 1.8)`，`lookAt(0, 1.0, 0)`。
- `renderer.outputColorSpace = THREE.SRGBColorSpace`；`setPixelRatio(min(devicePixelRatio, 2))`。
- 每帧 `vrm.update(dt)`。
- 背景色用 `--ink`，**不要**加 GridHelper（那是调试用，正式版去掉）。

### 8.5 网格叠加（mesh.js）

- 在 `SourcePanel` 的 `<video>`/`<img>` 上叠一层同尺寸 `<canvas>`。
- 把 478 个关键点按归一化坐标 × 帧宽高画成点（`--marker`，半径 1–1.5px），连线可选（默认只画点，太密的线显乱）。
- 坐标系：MediaPipe 的 y 向下，与 canvas 一致，**不要翻转**；只有发现左右镜像不对时，翻转 x（摄像头通常要镜像，照片/视频不要）。

### 8.6 读数条（readout.js）

- 每帧取 52 个值，按当前值降序取前 6–8 个。
- 名称做**中英缩写映射**（如 `jawOpen` → 「张嘴」，`eyeBlinkLeft` → 「眨眼·左」），括号里保留英文原名，方便对照。
- 平滑：显示值 = 0.6 × 旧值 + 0.4 × 新值（避免每帧狂跳）。

---

## 9. 资产与依赖（精确路径，全部现成）

| 依赖 | 来源 | 怎么用 |
|---|---|---|
| three.js + three-vrm（**vendored，免 npm**） | `D:\DASH\V0FastTest\viewer\vendor\`（`three.module.js`、`three-vrm.module.js`、`jsm\`） | **整个 `vendor\` 拷到项目里**，import map 指向它 |
| VRM 角色（7 选 1） | `D:\DASH\V0FastTest\SysMocap\models\*.vrm` | 挑一个（推荐 `three-vrm-girl.vrm`，已验证），拷进 `assets\` |
| 感知模型 | `D:\DASH\V0FastTest\models\face_landmarker.task` | 拷进 `models\` |
| MediaPipe Tasks Vision（JS） | CDN `@mediapipe/tasks-vision` | 用其 `FilesetResolver.forVisionTasks()` 加载 WASM |
| GSAP（动效编排，**vendored ESM**） | 官方 ES module 构建版，拷进 `vendor/` | 状态切换、入场编排（§6.5） |
| 字体（Instrument Serif / Geist / Geist Mono） | Google Fonts（OFL） | 部署 URL 用 CDN；本地演示 vendor woff2 进 `assets/fonts/` |
| 设计稿资产（桌面纹理 / 拍立得 / 图标） | Figma 导出，已下载 | `showcase/frontend/assets/img/`（溯源见 §14） |

**已验证的 import map 写法**（来自 viewer/index.html，把 `/viewer/vendor/` 改成你的相对路径）：

```json
{"imports":{
  "three": "./vendor/three.module.js",
  "three/addons/": "./vendor/jsm/",
  "@pixiv/three-vrm": "./vendor/three-vrm.module.js"
}}
```

**依赖政策（2026-09-24 修订，用户拍板：动效与美观优先）**：

- **鼓励**为视觉效果引入库：GSAP / anime.js（动效编排）、three.js 后处理（UnrealBloomPass、暗角）、自定义 GLSL shader、粒子、CSS transition / keyframes / backdrop-filter。华丽是这个页面的目标，不是奢侈。
- **唯一硬约束**：演示现场**双击即跑**——所有依赖一律 vendored 进项目（下载 ES module 构建版放进 `vendor/`），运行时不连 npm、不要构建步骤。GSAP、anime.js 都有官方 ESM 构建，直接可用。
- React / Vue / webpack / vite 不是被禁，而是**没有必要**：它们不提供任何视觉能力，只增加现场故障面。若某个具体效果确实非构建工具不可，先向用户说明理由，获准后再引入。

---

## 10. 状态与错误处理（逐条）

| 情况 | 界面表现 | 下一步动作 |
|---|---|---|
| 模型加载中 | 整页 Overlay：「正在加载模型…」+ 进度条 | 自动 |
| 摄像头权限被拒 | toast「摄像头没权限」+ 自动切到 photo 模式 | 「改用照片」 |
| 无 WebGL | 整页错误：「这个浏览器不支持 WebGL，换 Chrome / Edge 试试」 | — |
| 模型加载失败 | 整页错误：「模型没加载成功：<原因>」+「重试」 | 重试按钮 |
| 帧内无人脸（>0.5s） | 左视图角标「把脸放进画面里」 | 自动恢复 |
| 帧率 < 15 | 顶部状态条旁小字「已降分辨率以保帧率」 | 自动 |
| 视频拖入非视频文件 | toast「这不是视频文件」 | 留在 landing |

**隐私文案（必须在 landing 可见）**：「全程本地运行 · 不上传任何图像」。这是人脸 demo，必须让人放心。

---

## 11. 验收标准（实现完成 = 全部满足）

| # | 标准 | 怎么验 |
|---|---|---|
| 1 | camera 模式：看到自己的脸 + 网格实时跟随，皮套人同步模仿表情 | 亲测 |
| 2 | 帧率 ≥ 15 FPS（未降级时） | 顶部 FPS 读数 |
| 3 | 读数条随表情实时变化，数值为 mono 字体 | 亲测 |
| 4 | photo 模式：丢入一张人脸照片，皮套人摆出该表情 | 用仓库 `deploy/assets/` 的测试图 |
| 5 | video 模式：丢入一段人脸视频，皮套人逐帧模仿，可暂停/拖动 | 亲测 |
| 6 | 断网 / 无摄像头时按 §10 降级，不卡死 | 拔掉摄像头测 |
| 7 | 无构建步骤：一个静态服务器（或 `npx serve`）即可运行 | `npx serve` 验证 |
| 8 | 不发起任何外发请求（除 CDN 加载 MediaPipe 运行时） | DevTools Network 面板确认 |
| 9 | 设计符合 §6 Token（颜色/字体/间距），读数条签名元素存在 | 对照 §6 |
| 10 | 动效符合 §6.5：状态切换与入场有编排动效（GSAP 或等价），读数条数值过渡平滑，交互反馈 ≤ `--dur-fast` | 亲测 |

---

## 12. 明确不做的事（YAGNI）

| 不做 | 原因 |
|---|---|
| 身体 / 手势 | 导师本次只要脸部 |
| 多人脸 | demo 不需要 |
| 后端 / 账号 / 数据库 | 纯前端即可，后端是另一个 session 的事 |
| 录制 / 导出视频 | v1 不需要，录屏用系统工具 |
| 可旋转的 3D 网格视图 | v2 增强，v1 用 2D 叠加即可 |
| 移动端精细排版 | 桌面 demo |
| 量化 / INT8 | 那是底层线的活，与展示 demo 无关 |

---

## 13. 与仓库其他部分的关系

- **本 demo 独立于量化线**（第一批计划 Task 6–9 是另一回事，见 `doc/HANDOFF.md` §4）。
- **复用不重造**：three.js vendor、VRM 映射表、face_landmarker.task 都来自仓库现有文件（§8、§9 已给出处）。
- **代码位置**：`V0FastTest\showcase\frontend\`（2026-09-25 定：与后端 `showcase\backend\` 同库同目录，随 PR 纳入 git；取代早前「独立目录」的设想）。

---

## 14. Figma 设计稿溯源（2026-09-25 起为视觉基底）

- 源文件：<https://www.figma.com/design/UmZ5elUqjlDP2gicoPNZsg/Untitled?node-id=4-4>（fileKey `UmZ5elUqjlDP2gicoPNZsg`，根节点 `4:4`，画框 1200×800）。
- 通过 Figma MCP（Framelink）拉取结构并导出资产，拉取日期 2026-09-25。
- **功能差异说明**：原稿是「视频 → 3D 网格」工具，本页面只采用其**视觉系统**（钉板、纸卡、字体、配色、装饰件），功能定义仍以 §1 / §4 为准。

节点 → 组件映射：

| Figma 节点 | 本页面组件 |
|---|---|
| `TopStatusBar` #4:28 | TopBar（品牌 / 版本 / 状态 / 停止） |
| `InputCard` #4:40（ZONE 01） | SourcePanel + 输入选择（landing 的 Dropzone） |
| `OutputCard` #4:57（ZONE 02） | AvatarPanel（RenderBox 位置 = three.js 画布） |
| `DemoStrip` #4:73 + `PolaroidRow` #4:77 | 底部横条：landing 放示例拍立得，stage 切换为 ReadoutStrip |
| `Pushpin` / `MaskingTape` / `ScrapNew` / `InstructionScrap` / `ScrapArrow` | 装饰件与便签（只取视觉语言，文案换我们的） |

已导出资产（`showcase/frontend/assets/img/`）：`desk-texture.png`（2400×1600 桌面纹理）、`polaroid-*.png`×4（拍立得占位图，正式版换成我们自己的 demo 截图）、`icon-*.svg`×5（upload-cloud / axis-3d / cpu / settings / arrow-right）。
