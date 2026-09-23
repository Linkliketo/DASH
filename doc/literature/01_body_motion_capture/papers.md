# S1 身体动捕 — 单目视频→3D人体姿态估计

> 关键词：Monocular 3D Human Pose Estimation, 2D-to-3D Lifting, Real-time, Lightweight

---

## 一、核心综述

### 1. A Survey of the State of the Art in Monocular 3D Human Pose Estimation: Methods, Benchmarks, and Challenges
- **出处**：Sensors (MDPI), 2025.04
- **链接**：https://www.mdpi.com/1424-8220/25/8/2409
- **内容**：全面综述单目3D人体姿态估计方法、benchmark和挑战，覆盖2D-to-3D lifting、Transformer、Mamba等最新架构
- **与DASH关联**：直接覆盖S1子系统完整技术路线

### 2. A Survey on Deep 3D Human Pose Estimation
- **出处**：Artificial Intelligence Review (Springer), 2025
- **链接**：https://link.springer.com/article/10.1007/s10462-024-11019-3
- **内容**：深度学习3D姿态估计综述，涵盖自监督、域适应、多视角融合
- **亮点**：分类整理了全监督/弱监督/自监督方法

### 3. GitHub: HumanPoseSurvey
- **链接**：https://github.com/djzgroup/HumanPoseSurvey
- **内容**：持续更新的3D人体姿态估计论文收集，含分类标签

---

## 二、2D-to-3D Lifting 方法

### 4. Toward a Real-Time Framework for Accurate Monocular 3D Human Pose Estimation with Geometric Priors
- **出处**：ICRA 2025 Workshop, arXiv:2507.16850
- **链接**：https://arxiv.org/abs/2507.16850
- **方法**：实时2D关键点检测 + 几何感知2D-to-3D lifting，利用已知相机内参和人体解剖先验
- **与DASH关联**：与DASH的MediaPipe+K+SMPL-X管线高度相似，可参考其几何先验设计

### 5. G2O-Pose: Real-Time Monocular 3D Human Pose Estimation Based on General Graph Optimization
- **出处**：Sensors (MDPI), 2022
- **链接**：https://www.mdpi.com/1424-8220/22/21/8335
- **方法**：将3D姿态视为图优化问题，多约束（骨骼比例/朝向分类/关节矫正）实时求解
- **亮点**：无需深度信息，纯2D关键点→3D，适合轻量化

### 6. PoseMamba / Pose Magic / SMGNFORMER (2024-2025)
- **方法**：基于Mamba状态空间模型/GCN的3D姿态估计
- **亮点**：Mamba架构在长序列建模上比Transformer更高效

---

## 三、视频→BVH 直接转换

### 7. video_to_bvh (GitHub)
- **链接**：https://github.com/Dene33/video_to_bvh
- **方法**：视频→图像→OpenPose 2D→HMR 3D→Blender BVH（402 stars）
- **技术栈**：Keras OpenPose + HMR + Blender脚本

### 8. video2bvh (GitHub)
- **链接**：https://github.com/KevinLTT/video2bvh
- **方法**：OpenPose 2D + VideoPose3D/3D-pose-baseline → BVH（655 stars）
- **亮点**：MIT License，含Blender重定向教程

### 9. MocapNET (v4.0, 2025更新)
- **链接**：https://github.com/FORTH-ModelBasedTracker/MocapNET
- **方法**：2D关键点 → BVH 实时输出，2025版已支持MediaPipe+身体+手+面部
- **性能**：Lenovo笔记本可达30Hz全身推理
- **与DASH关联**：与DASH目标几乎一致！可参考其SNN Ensemble设计

### 10. MoCapAnything: Unified 3D Motion Capture for Arbitrary Skeletons from Monocular Videos
- **出处**：CVPR 2026
- **链接**：https://arxiv.org/html/2512.10881v2
- **方法**：任意骨骼BVH输出，含轻量IK拟合阶段
- **三大模块**：Reference Prompt Encoder + Video Feature Extractor + IK Fitting
- **与DASH关联**：其"类别无关动捕"思路可参考，IK拟合轻量化设计值得借鉴

---

## 四、轻量化实时方案

### 11. Mo2Cap2: Real-time Mobile 3D Motion Capture with a Cap-mounted Fisheye Camera
- **出处**：IEEE TVCG
- **链接**：https://vcai.mpi-inf.mpg.de/projects/wxu/Mo2Cap2
- **方法**：棒球帽+鱼眼摄像头→60Hz 3D姿态，消费级GPU
- **亮点**：轻量硬件创新

### 12. Real-Time Live Streaming Framework for Cultural Heritage Using Multi-Camera 3D Motion Capture (2025)
- **出处**：Applied Sciences (MDPI)
- **链接**：https://www.mdpi.com/2076-3417/15/22/12208
- **方法**：边缘端姿势估计→中心端融合→骨架数据流（64Kbps）驱动虚拟化身
- **亮点**：带宽压缩1Gbps→64Kbps

---

## 五、与DASH直接相关的基础工作

| 工作 | 年份 | 关键贡献 |
|------|------|---------|
| MediaPipe Holistic (Google) | 2020 | 543关键点实时检测，BlazeNet骨干 |
| BlazePose (Google) | 2020 | 设备端33点身体姿态，轻量 |
| OpenPose (CMU) | 2017 | 多人2D关键点检测先驱 |
| VideoPose3D (Facebook) | 2019 | 时序卷积2D→3D lifting |
| 3D-pose-baseline | 2017 | 简单FCN 2D→3D lifting基线 |

## 六、已知限制与改进方向

- MediaPipe Holistic手部ROI预测在非理想角度下精度下降（Moryossef et al., 2024，已有修复方案）
- 单人假设 vs 多人场景 → Multi-HMR可补充
- 2D-to-3D模糊性 → 几何先验/时序一致性/多视角约束
