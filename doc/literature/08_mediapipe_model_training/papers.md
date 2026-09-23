# MediaPipe 底层 CNN 模型训练论文

> DASH 使用的三个感知模型（身体/面部/手部）底层都是 Google MediaPipe 的 CNN。
> 注意：**训练代码未公开**，权重是 Google 内部训练的；本目录收录的是描述训练策略与架构的论文。

---

## 1. BlazePose: On-device Real-time Body Pose Tracking

- **文件**：`BlazePose_arXiv2020.pdf`
- **出处**：arXiv 2006.10204（CVPRW 2020）
- **模型**：身体 33 关键点 CNN（heatmap + 回归混合头）
- **训练策略要点**：
  - 数据集：真人标注 + 大量合成渲染数据（合成数据占比大）
  - 损失：关键点回归损失 + heatmap 损失，heatmap 按可见性加权
  - 增强：镜像、遮挡、随机旋转
  - 特点：先回归人体中心/旋转，再预测局部关键点（对齐裁剪），提升鲁棒性

## 2. BlazeFace: Sub-millisecond Neural Face Detection on Mobile GPUs

- **文件**：`BlazeFace_arXiv2019.pdf`
- **出处**：arXiv 1907.05047（CVPRW 2019）
- **模型**：单阶段人脸检测 CNN（SSD 风格），供 Face Mesh 前处理
- **训练策略要点**：
  - 单阶段检测，anchor 设计针对手机端小脸优化
  - 数据增强 + 困难负样本挖掘
  - 极轻量，专为 GPU/移动端延迟优化

## 3. MediaPipe Hands: On-device Real-time Hand Tracking

- **文件**：`MediaPipe_Hands_arXiv2020.pdf`
- **出处**：arXiv 2006.10214（CVPRW 2020）
- **模型**：手部 21 关键点 CNN
- **训练策略要点**：
  - 合成数据（大量）+ 真人标注混合训练
  - 先手部检测（palm detector）再关键点回归的两阶段管线
  - 关键点回归含 3D 相对深度

---

## 与 DASH 的关系

| 模型 | DASH 用途 | 是否训练 |
|------|----------|---------|
| BlazePose | S1 身体关键点（SMPL-X 拟合输入） | ❌ 冻结推理 |
| BlazeFace + Face Mesh | S2 面部 468 关键点（AU/BlendShape 输入） | ❌ 冻结推理 |
| MediaPipe Hands | S1 手部 21 关键点 | ❌ 冻结推理 |

**结论**：这三个模型在 DASH 中都是"冻结推理"，官方权重直接可用（见 `V0FastTest/models/`）。DASH 真正需要训练的是 LibreFace 微调、AU→BlendShape MLP、landmark-AU 网络、QAT 重训——那些才有公开训练代码。

---

## 官方 Model Card（训练数据/指标补充参考，网页）

- BlazePose: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- Face Landmarker: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
- Hand Landmarker: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
