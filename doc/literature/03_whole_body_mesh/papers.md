# S1+S2 全身Mesh恢复 — 单目图像→SMPL-X/FLAME参数

> 关键词：Human Mesh Recovery (HMR), SMPL-X, FLAME, Whole-body, Real-time
>
> 这是DASH替代"MediaPipe→Kalman→SMPL-X拟合"技术路线的关键方向

---

## 一、DASH当前管线的替代方案

DASH当前：RGB → MediaPipe Holistic(543 kpts) → Kalman3D → SMPL-X拟合(L-BFGS,15ms) → BVH
可替代为：RGB → ViT Backbone → SMPL-X参数直接回归 (single forward, <10ms)

---

## 二、最强替代方案：PEAR

### 1. PEAR: Pixel-Aligned Expressive Human Mesh Recovery
- **出处**：SIGGRAPH 2026 (IDEA研究院)
- **链接**：https://arxiv.org/html/2601.22693v2 | 项目页: https://wujh2001.github.io/PEAR
- **方法**：单一ViT → SMPL-X + FLAME参数联合回归（无裁剪/无需预处理）
- **性能**：
  - RTX 4090: ~100 FPS (FP32)
  - RTX 3090: ~70 FPS
  - 端到端推理~0.01s
- **对比超越**：OSX, SMPLest-X, Multi-HMR
- **三大创新**：
  1. 统一ViT替代多分支架构
  2. 像素级监督补偿简化架构带来的细节损失
  3. 模块化伪标签数据增强策略
- **与DASH关联**：★★★ 最值得关注！100FPS SMPL-X+FLAME可直接替换DASH的MediaPipe+K+SMPL-X管线

---

## 三、TokenHMR

### 2. TokenHMR: Advancing Human Mesh Recovery with a Tokenized Pose Representation
- **出处**：CVPR 2024 (Max Planck Institute)
- **链接**：https://tokenhmr.is.tue.mpg.de | GitHub: saidwivedi/TokenHMR
- **方法**：两阶段——(a)连续姿态→离散token编码 (b)预训练decoder提供"姿态词汇表"
- **创新**：Tokenized pose representation解决回归中的姿态模糊性
- **阈值自适应损失(TALS)**：量化了错误2D/3D标注带来的精度损失
- **与DASH关联**：TALS损失设计思路可用于DASH训练

---

## 四、Multi-HMR

### 3. Multi-HMR: Multi-Person Whole-Body Human Mesh Recovery in a Single Shot
- **出处**：ECCV 2024 (NAVER Labs Europe)
- **链接**：https://arxiv.org/abs/2402.14654 | GitHub: naver/multi-hmr
- **方法**：ViT Backbone → 单人/多人SMPL-X（身体+手+面部）单次推理
- **关键设计**：
  - Human Prediction Head (HPH)：交叉注意力模块
  - CUFFS数据集：近距离全身上半身+手部细节
  - 可选相机内参编码
- **配置**：ViT-S + 448×448 → 快速版；ViT-L + 896×896 → 精度版
- **与DASH关联**：多人支持是其独有优势，但DASH可能只需单人

---

## 五、SAT-HMR

### 4. SAT-HMR: Real-Time Multi-Person 3D Mesh Estimation via Scale-Adaptive Tokens
- **出处**：CVPR 2025 (Oral可能)
- **方法**：Scale-Adaptive Tokens实现实时多人mesh估计
- **与DASH关联**：实时性直接匹配DASH需求

---

## 六、WHAM / 视频时序方法

### 4. Multi-HMR2: Multi-Person Camera-Centric Human Detection, Mesh Recovery and Tracking
- **出处**：arXiv:2606.14841, 2026 (NAVER Labs Europe) | GitHub: naver/multi-hmr2（权重自动下载）
- **方法**：Multi-HMR 升级版——检测+恢复3D mesh置于场景中+相机参数，输出逐人特征支持在线跟踪（仅用静止图像训练）
- **配置**：ViT，含多人支持，在线 demo 可用
- **与DASH关联**：★ B2 首选（PR v1.2 升级），与 PEAR 并列跑通对比；注意 license 为 NAVER 研究用途

### 5. OSX: One-Stage 3D Whole-Body Mesh Recovery with Component-Aware Transformer
- **出处**：ICCV 2023 (IDEA研究院) | GitHub: 官方开源
- **方法**：单阶段 component-aware Transformer → SMPL-X（身体+手+脸），PEAR 同机构前作
- **与DASH关联**：B2 候选之一；组件解耦注意力（body/hand/face 分支）设计可参考

### 6. WHAM: Reconstructing World-grounded Humans with Accurate 3D Motion
- **出处**：CVPR 2024
- **方法**：世界坐标系人体重建，额外估计全局运动轨迹
- **亮点**：处理相机运动+人体运动的联合估计
- **与DASH关联**：若DASH需要"世界坐标"运动（非相机坐标），可参考

### 6. DanceHMR: Hand-Aware Whole-Body Human Mesh Recovery from Monocular Videos
- **出处**：arXiv:2605.18102, 2025
- **方法**：视频时序一致性 + 手部注意力融合
- **亮点**：解决视频HMR的手部抖动问题
- **与DASH关联**：时序一致性对DASH的30fps连续推理很重要

---

## 七、工业方案

### 7. SAM 3D Body: Robust Full-Body Human Mesh Recovery
- **出处**：2026.01
- **方法**：基于SAM的全身体mesh恢复
- **亮点**：鲁棒性

### 8. Rokoko Vision / Move.ai / DeepMotion
- **类型**：商业AI动捕方案
- **方法**：单/双RGB摄像头→FBX/BVH
- **与DASH关联**：竞品分析参考

---

## 八、方法对比总结

| 方法 | 年份 | 全身 | 面部 | 手 | 实时 | FPS | 开源 |
|------|------|------|------|-----|------|-----|------|
| PEAR | 2026 | ✓ | ✓ | ✓ | ✓ | ~100 | ✓ |
| Multi-HMR2 | 2026 | ✓ | ✓ | ✓ | ✓ | ~ | ✓ |
| OSX | 2023 | ✓ | ✓ | ✓ | ✓ | ~ | ✓ |
| TokenHMR | 2024 | ✓ | ✗ | ✗ | ✓ | ~30 | ✓ |
| Multi-HMR | 2024 | ✓ | ✓ | ✓ | ✓ | ~20 | ✓ |
| SAT-HMR | 2024 | ✓ | ✗ | ✗ | ✓ | 实时 | ? |
| WHAM | 2024 | ✓ | ✗ | ✗ | ~ | ~ | ✓ |
| DASH(当前) | 2026 | ✓ | ✓(AUs) | ✓(21×2) | ✓ | 30+ | WIP |

**结论**：PEAR 与 Multi-HMR2 是 P1 需跑通并对比的两条 GPU 路线（同帧同卡按实测 performance 排序，见 PR v1.2 §六）；B1 三段式始终为主干基线。
