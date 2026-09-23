# LibreFace 深度分析

> **LibreFace: An Open-Source Toolkit for Deep Facial Expression Analysis**
> 
> WACV 2024 | USC ICT | 11页
> 
> 论文PDF: `LibreFace_WACV2024.pdf`
> 
> GitHub: https://github.com/ihp-lab/LibreFace

---

## 一、一句话总结

LibreFace 是 DASH 当前选型的面部分析工具包，通过 **MAE教师→ResNet-18学生** 的特征级知识蒸馏，实现2×OpenFace速度 + 7%更高AU精度。

**最新更新**：LibreFace 2.0 (FG 2026) 已加入 RepVGG 和合成数据。

---

## 二、技术架构

### Pipeline

```
输入图像
  │
  ▼
MediaPipe Face Mesh（468 3D关键点 + 面部检测 + 对齐）
  │
  ▼
MAE ViT-B Encoder（教师，预训练+微调）
  │
  ├──→ Linear Regression Head → 12 AU Intensity (PCC回归)
  ├──→ Linear Classifier Head → 17 AU Detection (二分类)
  └──→ Linear Classifier Head → 8 Expression Classes
  │
  ▼  特征级知识蒸馏（MSE匹配）
ResNet-18 Encoder（学生，部署用）
  │
  ▼
AU强度 + AU检测 + 表情分类
```

### 支持的AU

| 类别 | AU列表 |
|------|--------|
| 强度估计(12) | AU1,2,4,5,6,9,12,15,17,20,25,26 |
| 检测(5) | AU7,10,14,23,24 |
| 共17个AU | — |

### 表情识别

8类基本表情：Neutral, Happy, Sad, Surprise, Fear, Disgust, Anger, Contempt

---

## 三、核心方法

### 1. 预训练策略（三步）

```
Step 1: MAE ViT-B在EmotionNet(975K)上自监督重建预训练
Step 2: MAE+分类器在AffectNet(1M)+FFHQ(70K)上表情分类预训练
Step 3: 在DISFA/BP4D上微调AU任务
```

**关键**：通用面部特征 → 任务特定微调，比从头训练效果更好。

### 2. 特征级知识蒸馏

不同于传统logit蒸馏：

```
L_total = L_Task + λ1·L_FM + λ2·L_KL

L_FM = ||f_teacher - I(f_student)||²  # 特征匹配（MSE）
L_KL  = KL(softmax(z_T/T), softmax(z_S/T))  # 软标签蒸馏
L_Task = MSE (AU回归) / CE (表情分类)
```

**为什么特征级更好**：教师(MAE ViT-B)的特征空间更丰富，学生(ResNet-18)直接学习中间表示。

---

## 四、性能指标

### AU强度估计 (DISFA, PCC↑)

| 方法 | AU1 | AU2 | AU4 | AU6 | AU12 | AU25 | AU26 | **Avg** |
|------|-----|-----|-----|-----|------|------|------|---------|
| OpenFace 2.0 | 0.64 | 0.50 | 0.70 | 0.59 | 0.85 | 0.85 | 0.67 | 0.59 |
| **LibreFace** | **0.63** | **0.72** | **0.78** | 0.59 | 0.85 | **0.94** | 0.68 | **0.63** |

> +7% PCC提升，AU2(+0.22), AU4(+0.08), AU25(+0.09)提升显著

### AU检测 (BP4D, F1↑)

| 方法 | Avg F1 |
|------|--------|
| ResNet-18 (无预训练) | 47.2 |
| MAE ViT-B (教师) | 63.2 |
| **LibreFace (蒸馏)** | **62.0** |

> 蒸馏仅损失1.2% F1，换来了巨大速度提升

### 推理速度

| 模式 | 时间(ms) | FPS | 模型大小 |
|------|---------|-----|---------|
| MAE ViT-B (教师) | 87.93 | 11.4 | 403MB |
| Swin-Tiny | 55.94 | 17.9 | 185MB |
| **ResNet-18 (学生)** | **37.20** | **26.9** | **43MB** |
| ResNet-18 (GPU) | 6.07 | 164.8 | 43MB |
| OpenFace 2.0 | 50.11 | 20.0 | — |

> 测试环境：i9-13900K + GTX1080, Windows 11

---

## 五、与DASH的关系

### DASH中的定位

```
DASH管线中LibreFace的位置:
MediaPipe 468 landmarks → LibreFace ResNet-18 → 17 AU → RBF → 52 BlendShape
```

### LibreFace 2.0 新特性 (FG 2026)

- **RepVGG** 作为额外学生模型：推理更快
- **合成数据训练**：提升跨人口统计的AU检测公平性
- **AU检测公平性**：在AffWild2上性别/种族F1标准差最低

### DASH的潜在改进

1. **直接用ResNet-18学生**：当前DASH方案已是最佳选择
2. **升级到LibreFace 2.0** (RepVGG)：更快的速度
3. **GPU模式**：GTX级别GPU可达164FPS，远超需求
4. **AU→BlendShape映射**：LibreFace只到AU，RBF映射是DASH自己加的

---

## 六、局限与改进方向

| 局限 | DASH改进方案 |
|------|-------------|
| 仅17 AU（vs 全52 BlendShape） | RBF插值弥合差距，但有信息损失 |
| 基于静态图像（非时序） | 可加时序平滑（已有Kalman在管道中） |
| CPU 27FPS（边界） | GPU模式164FPS绰绰有余 |
| 重度遮挡不鲁棒 | MediaPipe本身对面部遮挡也有退化 |
| 不支持微表情特殊检测 | CASME II数据集可单独微调模型 |

---

## 七、开源情况

- ✅ 代码开源（GitHub: ihp-lab/LibreFace）
- ✅ 预训练权重提供
- ✅ pip install 支持
- ✅ Windows GUI（通过OpenSense平台）
- ✅ LibreFace 2.0 已更新（2026.05）
