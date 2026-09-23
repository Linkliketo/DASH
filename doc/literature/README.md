# DASH 项目文献调研

> 面向游戏数字人的轻量化动作-微表情联合建模方法研究
>
> 调研时间：2026年7月
>
> 按 DASH 项目 5 个子系统（S1-S5）分类整理

---

## 目录结构

```
literature/
├── README.md                          ← 本文档：调研总览 + PDF 索引
├── 01_body_motion_capture/            ← S1 身体动捕
│   ├── papers.md                      # 单目视频→3D姿态/BVH
│   ├── MediaPipe_Holistic/            # 📄 MediaPipe Holistic (arXiv 2020)
│   ├── MoCapAnything/                 # 📄 MoCapAnything (CVPR 2026)
│   ├── MocapNET/                      # 📝 MocapNET 分析笔记
│   └── VideoPose3D/                   # 📄 VideoPose3D (CVPR 2019)
├── 02_facial_expression/              ← S2 面部表情
│   ├── papers.md                      # AU检测/表情识别/BlendShape
│   ├── Express4D/                     # 📄 Express4D (arXiv 2025)
│   ├── landmark_AU/                   # 📄 仅Landmark AU检测 (Bioengineering 2025)
│   ├── LibreFace/                     # 📄 LibreFace (WACV 2024) + EMOCA (CVPR 2022)
│   ├── OpenFace3/                     # 📄 OpenFace 3.0 (FG 2025)
│   └── SMIRK/                         # 📄 SMIRK (arXiv 2024)
├── 03_whole_body_mesh/                ← S1+S2 全身Mesh恢复
│   ├── papers.md                      # SMPL-X/FLAME/TokenHMR等
│   ├── AMASS/                         # 📄 AMASS (CVPR 2019)
│   ├── FLAME/                         # 📄 FLAME (SIGGRAPH Asia 2017)
│   ├── Multi-HMR2/                    # 📄 Multi-HMR2 (arXiv 2026)
│   ├── OSX/                           # 📄 OSX (ICCV 2023)
│   ├── PEAR/                          # 📄 PEAR (SIGGRAPH 2026) + Multi-HMR + TokenHMR
│   └── SMPL-X/                        # 📄 SMPL-X (CVPR 2019)
├── 04_inference_optimization/         ← S3 推理优化
│   └── papers.md                      # INT8量化/ONNX/剪枝/部署
├── 05_engine_integration/             ← S4 引擎集成
│   └── papers.md                      # Unity/Unreal/BVH/实时驱动
├── 06_surveys/                        ← 综述论文
│   └── papers.md                      # 各方向综述/benchmark
└── 07_key_papers_deep_dive/           ← 深度阅读的重点论文
    ├── papers.md                      # 与DASH最相关的关键论文
    └── P1-1_PEAR_vs_三段式管线_决策报告.md
└── 08_mediapipe_model_training/       ← 底层 CNN 模型训练论文（BlazePose/BlazeFace/Hands）
    ├── papers.md                      # 训练策略要点 + 与DASH关系
    ├── BlazePose_arXiv2020.pdf
    ├── BlazeFace_arXiv2019.pdf
    └── MediaPipe_Hands_arXiv2020.pdf
```

## PDF 论文索引（已下载 17 篇）

> 📄 = 本地 PDF；📝 = 分析笔记；标注日期 2026-08-11（随 PR v1.2 更新）

### S1 身体动捕 + 全身 Mesh

| 论文 | 出处 | 本地文件 | 对应路线 |
|------|------|---------|---------|
| **SMPL-X** | CVPR 2019 (arXiv:1812.10171) | `03_whole_body_mesh/SMPL-X/` | B1/B2/B3 参数化模型，必读 |
| **FLAME** | SIGGRAPH Asia 2017 (arXiv:1707.06749) | `03_whole_body_mesh/FLAME/` | F4/F5 + PEAR 资产 |
| **PEAR** | SIGGRAPH 2026 | `03_whole_body_mesh/PEAR/PEAR_*` | B3 一级候选，必读 |
| **Multi-HMR2** | arXiv 2026 (2606.14841) | `03_whole_body_mesh/Multi-HMR2/` | B2 首选，必读 |
| **Multi-HMR** | ECCV 2024 | `03_whole_body_mesh/PEAR/Multi-HMR_ECCV2024.pdf` | B2 前作 |
| **TokenHMR** | CVPR 2024 | `03_whole_body_mesh/PEAR/TokenHMR_CVPR2024.pdf` | B2 候选 |
| **OSX** | ICCV 2023 (arXiv:2303.16160) | `03_whole_body_mesh/OSX/` | B2 候选 |
| **MoCapAnything** | CVPR 2026 (arXiv:2512.10881) | `01_body_motion_capture/MoCapAnything/` | B6 任意骨骼 |
| **MediaPipe Holistic** | arXiv 2020 (2006.10204) | `01_body_motion_capture/MediaPipe_Holistic/` | B1 感知层 |
| **VideoPose3D** | CVPR 2019 (arXiv:1811.11742) | `01_body_motion_capture/VideoPose3D/` | B5 lifting |
| **AMASS** | CVPR 2019 (arXiv:1804.03226) | `03_whole_body_mesh/AMASS/` | 运动数据/时序训练 |

### S2 面部表情

| 论文 | 出处 | 本地文件 | 对应路线 |
|------|------|---------|---------|
| **LibreFace** | WACV 2024 | `02_facial_expression/LibreFace/LibreFace_WACV2024.pdf` | F1 主干，必读 |
| **EMOCA** | CVPR 2022 | `02_facial_expression/LibreFace/EMOCA_CVPR2022.pdf` | F4 FLAME 回归 |
| **OpenFace 3.0** | FG 2025 | `02_facial_expression/OpenFace3/` | F2 对照 |
| **仅 Landmark AU** | Bioengineering 2025 (PMC11851526) | `02_facial_expression/landmark_AU/` | F3 极限轻量 |
| **SMIRK** | arXiv 2024 (2412.13197) | `02_facial_expression/SMIRK/` | F4 候选 |
| **Express4D** | arXiv 2025 (2508.12438) | `02_facial_expression/Express4D/` | 映射训练数据 |

### 待补（未公开/需手动获取）

- **Gaussian Head Avatars (2025)**：AU→BlendShape 映射参考（KNN/Ridge/MLP）。openreview PDF 403（未正式发布），仅 `02_facial_expression/papers.md` 有链接
- **MocapNET v4.0**：仅 `01_body_motion_capture/MocapNET/MocapNET_analysis.md` 分析笔记（无 PDF，工具类论文）

## 快速导航

| DASH 子系统 | 对应文献目录 | 关键词 |
|------------|------------|--------|
| S1 身体动捕 | 01_body_motion_capture + 03_whole_body_mesh | MediaPipe, Kalman3D, SMPL-X, BVH |
| S2 面部表情 | 02_facial_expression | LibreFace, AU Detection, ARKit BlendShape, EMOCA |
| S3 推理优化 | 04_inference_optimization | INT8 QAT, ONNX Runtime, torchao, 剪枝 |
| S4 引擎集成 | 05_engine_integration | Unity, Unreal, BVH, Live Link, MetaHuman |
| S5 验证评估 | 06_surveys | Benchmark, 数据集, 评估指标 |

## 最重要发现（Top Picks）

1. **PEAR (2026)** — 100FPS SMPL-X+FLAME统一推理，实时全身动画，可直接替代DASH的拟合管线
2. **SAT-HMR (2024)** — 实时多人3D Mesh估计，ViT轻量架构
3. **OpenFace 3.0 (2025)** — 轻量多任务面部分析工具包，AU+表情+视线
4. **MoCapAnything (CVPR 2026)** — 任意骨骼BVH生成，含IK拟合
5. **MocapNET (2025更新)** — 2D→BVH实时转换，已支持MediaPipe+身体+手+面部
