# 深度阅读重点论文 — 与DASH最直接相关的关键工作

> 每篇论文都与DASH的某个核心模块直接对应，建议按优先级顺序阅读

---

## 优先级 #1：直接替换DASH管线

### PEAR: Pixel-Aligned Expressive Human Mesh Recovery
- **发表**：SIGGRAPH 2026
- **论文**：https://arxiv.org/html/2601.22693v2
- **代码**：https://github.com/Pixel-Talk/PEAR ✅（2026-07-24 核查：已开源，权重自动下载，训练数据未完整公开）
- **为什么重要**：
  - 单一模型实现SMPL-X + FLAME同时回归 → 可直接替代DASH的 MediaPipe→Kalman→SMPL-X拟合三段式管线
  - 100 FPS推理速度远超DASH的<30FPS目标
  - 像素级对齐精度优于现有所有方法
- **DASH可借鉴**：
  - 统一ViT架构替代多分支设计
  - 像素级监督提升细节精度
  - 模块化伪标签数据增强策略
  - 实时动画驱动（50 FPS Animation pipeline）

---

## 优先级 #2：直接竞争的轻量方案

### MoCapAnything: Unified 3D Motion Capture for Arbitrary Skeletons
- **发表**：CVPR 2026
- **论文**：https://arxiv.org/html/2512.10881v2
- **为什么重要**：
  - 直接输出BVH格式（DASH的最终输出格式）
  - 轻量IK拟合阶段（闭式解+可微优化）
  - 类别无关：支持任意骨骼拓扑
- **DASH可借鉴**：
  - IK拟合的混合策略（几何初始化+可微优化）
  - 帧间warm-start保证时序稳定

### MocapNET v4.0
- **代码**：https://github.com/FORTH-ModelBasedTracker/MocapNET
- **为什么重要**：
  - 已实现MediaPipe+身体+手+面部 → BVH 30Hz
  - 与DASH技术路线几乎一致
  - 可作为Baseline对比

---

## 优先级 #3：面部分析替代方案

### LibreFace (WACV 2024) + LibreFace 2.0 (FG 2026)
- **论文**：https://openaccess.thecvf.com/content/WACV2024/papers/Chang_LibreFace_An_Open-Source_Toolkit_for_Deep_Facial_Expression_Analysis_WACV_2024_paper.pdf
- **代码**：https://github.com/ihp-lab/LibreFace
- **为什么重要**：
  - DASH当前选型技术
  - 2.0版加入RepVGG、合成数据、AU检测公平性
  - 可直接pip安装使用

### OpenFace 3.0
- **论文**：https://arxiv.org/html/2506.02891v1
- **为什么重要**：
  - 多任务统一（landmark+AU+视线+表情）
  - 与LibreFace全面对比，可作为替代方案

### 仅Landmark的AU检测方法
- **论文**：PMC11851526, 2025
- **为什么重要**：
  - 仅需3D landmarks（DASH已从MediaPipe获得468点）
  - 数千参数（vs 22.5M LibreFace）
  - DASH可直接复用：MediaPipe landmarks → 轻量NN → AU

---

## 优先级 #4：推理优化核心参考

### PyTorch QAT Blog + NVIDIA TensorRT QAT Guide
- **PyTorch**：https://pytorch.org/blog/quantization-aware-training
- **NVIDIA**：https://developer.nvidia.com/blog/achieving-fp32-accuracy-for-int8-inference-using-quantization-aware-training-with-tensorrt
- **为什么重要**：
  - DASH的torchao QAT + ONNX Runtime方案的直接参考
  - 包含完整的PyTorch→ONNX→TensorRT QAT工作流

---

## 优先级 #5：竞品分析

### Rokoko Vision / DeepMotion / Move.ai
- **类型**：商业AI动捕方案
- **为什么重要**：
  - DASH的目标用户（独立游戏开发者）正在用的替代方案
  - 了解竞品的定价、精度、延迟指标
  - Rokoko Vision免费层：15秒录制
  - DeepMotion：云处理，按分钟计费

### MetaHuman Animator (Epic Games)
- **为什么重要**：
  - DASH的核心竞品
  - 已实现"单摄像头实时面部动画"
  - 需要了解其技术限制（是否需要GPU/NPU？离线精度 vs 实时精度？）

---

## 建议阅读顺序

```
第1周：PEAR + MocapNET (理解替代方案)
第2周：LibreFace 2.0 + OpenFace 3.0 (面部分析基线)
第3周：MoCapAnything (BVH生成 + IK)
第4周：QAT/ONNX部署文献 (推理优化实施)
```

## 与技术方案的差距分析

| DASH当前方案 | 最强替代 | 差距 |
|-------------|---------|------|
| MediaPipe+K+SMPL-X拟合 | PEAR (单次前向) | PEAR快~10×，精度更高 |
| LibreFace ResNet18 | OpenFace 3.0 / Landmark方法 | Landmark方法极轻量 |
| torchao QAT + ONNX | TensorRT QAT Toolkit | NVIDIA有更成熟的QAT管线 |
| RBF AU→BlendShape | MLP/KNN映射 (GaussianHead) | MLP可学习更复杂映射 |
| asyncio Pipeline | PEAR单模型统一 | 省去同步开销 |
