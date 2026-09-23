# S5 综述论文 — 各方向综合调研

> 按方向组织的综述论文汇总，用于全面了解领域现状

---

## 一、3D人体姿态估计

### 1. A Survey of the State of the Art in Monocular 3D Human Pose Estimation
- **出处**：Sensors (MDPI), 2025.04
- **链接**：https://www.mdpi.com/1424-8220/25/8/2409
- **覆盖**：方法分类、Benchmark、挑战、未来方向

### 2. A Survey on Deep 3D Human Pose Estimation
- **出处**：Artificial Intelligence Review (Springer), 2025 (Nov 2024接收)
- **链接**：https://link.springer.com/article/10.1007/s10462-024-11019-3
- **覆盖**：深度学习3D HPE全栈综述

### 3. Recovering 3D Human Mesh from Monocular Images: A Survey
- **出处**：arXiv:2203.01923v6 (持续更新至2024)
- **链接**：https://arxiv.org/html/2203.01923v6
- **覆盖**：SMPL/SMPL-X时代HMR方法全览（优化式→学习式→混合式）

### 4. A Survey on 3D Egocentric Human Pose Estimation
- **出处**：CVPR 2024 Workshop (RHOBIN)
- **链接**：https://openaccess.thecvf.com/content/CVPR2024W/Rhobin/papers/Azam_A_Survey_on_3D_Egocentric_Human_Pose_Estimation_CVPRW_2024_paper.pdf
- **覆盖**：第一人称视角(头戴设备)姿态估计

### 5. GitHub: HumanPoseSurvey
- **链接**：https://github.com/djzgroup/HumanPoseSurvey
- **覆盖**：持续更新的3D姿态估计论文清单（含代码链接）

---

## 二、面部表情分析

### 6. Advances in Facial Expression Recognition: A Survey
- **出处**：Information (MDPI), 2024
- **链接**：https://www.iti.gr/iti/wp-content/uploads/2024/10/advances-in-facial-expression-recognition-a-survey-ofmethods-benchmarks-models-and-datasets.pdf
- **覆盖**：FER全栈：预处理→特征提取→分类→深度学习→Transformer

### 7. A Survey on Facial Expression Recognition of Static and Dynamic Emotions
- **出处**：arXiv:2408.15777, 2024
- **链接**：https://arxiv.org/html/2408.15777v1
- **覆盖**：静态+动态表情，CLIP/ViT方法，多数据集对比

### 8. Advances in Facial Micro-Expression Detection and Recognition: A Comprehensive Review
- **出处**：Information (MDPI), 2025
- **链接**：https://www.mdpi.com/2078-2489/16/10/876
- **覆盖**：微表情检测+识别，3D-CNN/LSTM/Transformer/GNN

### 9. Deep Learning-based Facial Micro-Expression Analysis: A Survey
- **出处**：CTBEB, 2024
- **覆盖**：微表情数据集+算法综述，时序特征提取

### 10. Advances in Facial Expression Recognition Technologies for Emotion Analysis
- **出处**：Discover Computing (Springer), 2025
- **链接**：https://link.springer.com/article/10.1007/s10791-025-09699-8
- **覆盖**：轻量FER：Patt-lite, MobileNet, 混合CNN+SVM

### 11. Real-time Emotion Recognition Based on Facial Expressions Using AI Techniques: A Review
- **出处**：Multidisciplinary Reviews, 2025
- **链接**：https://malque.pub/ojs/index.php/mr/article/view/8626
- **覆盖**：实时表情识别综述

---

## 三、音频驱动面部动画

### 12. Audio-Driven Facial Animation with Deep Learning: A Survey
- **出处**：Information (MDPI), 2024
- **链接**：https://www.mdpi.com/2078-2489/15/11/675
- **覆盖**：DiffSpeaker, FaceTalk, GLDiTalker, EmoFace, JambaTalk 等2024最新方法

---

## 四、关键Benchmark与数据集

| 数据集 | 用途 | 规模 |
|--------|------|------|
| Human3.6M | 3D姿态评估 (MPJPE) | 360万帧, 11 subjects |
| 3DPW | 野外3D姿态 | 51K帧 |
| AMASS | SMPL-H/SMPL-X运动 | 40+小时 |
| EMDB | 野外全身运动 | — |
| UBody | 全身+面部+手 | — |
| DISFA | AU强度估计 | 27 subjects |
| BP4D | AU检测 | 41 subjects |
| AffWild2 | 野外AU+表情 | — |
| CASME II | 微表情 | — |
| SAMM-LV | 微表情 | — |
| AffectNet | 表情分类 | 450K images |
| RAF-DB | 表情分类 | 30K images |
| DFEW | 动态表情 | 16K clips |
