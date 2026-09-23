# PEAR 深度分析

> **PEAR: Pixel-Aligned Expressive Human Mesh Recovery**
> 
> SIGGRAPH 2026 | IDEA研究院 | 24页
> 
> 论文PDF: `PEAR_Pixel_Aligned_Expressive_Human_Mesh_Recovery.pdf`
> 
> 项目页: https://wujh2001.github.io/PEAR

---

## 一、一句话总结

PEAR 是第一个同时回归 SMPL-X（身体+手）和 FLAME（面部）参数的单目人体Mesh恢复框架，**100FPS** 推理速度，无需任何预处理/裁剪，直接端到端输出可用动画参数。

---

## 二、核心创新点（3个）

### 1. EHM-s：SMPL-X + FLAME 统一参数化

PEAR 提出 **EHM-s (Expressive Human Model - simplified)**，回归参数：

| 参数组 | 符号 | 维度 | 含义 |
|--------|------|------|------|
| SMPL-X 身体姿态 | θ_b | 66D (22×3) | 身体关节旋转 |
| SMPL-X 身体形状 | β_b | 10D | 体型系数 |
| FLAME 头部姿态 | θ_h | 3D | 颈部-头部旋转 |
| FLAME 头部形状 | β_h | 100D | 头部形状系数 |
| FLAME 表情 | φ_h | 50D | 面部表情系数 |
| **全局头部缩放** | **s** | **3D** | **解耦头部-身体比例** |
| 相机参数 | π | 3D | 弱透视投影 |

**关键设计**：`s` 参数使模型能泛化到儿童、卡通角色等头部比例异常的个体。

### 2. 像素级监督（Two-Stage Training）

- **Stage 1**（粗网格）：ViT-B + 参数回归 + 关键点损失，200K iters
- **Stage 2**（精网格）：冻结粗网络 + 3DGS可微渲染器GUAVA提供像素级L1+LPIPS损失，20K iters
- **效果**：显著减少面部和手部的pixel misalignment

### 3. 模块化伪标签策略

不依赖现有SMPL-X预测管道（会继承其误差），而是**分模块独立标注**：
- **身体**：从SMPL标注微调（Δθ修正）
- **面部**：TEASER预测FLAME参数
- **手部**：HAMER预测SMPL-X手部参数
- **精化**：DWPose 2D关键点约束

---

## 三、性能指标

### 面部表情精度

| 方法 | UBody MLE↓ | UBody LVE↓ | 3DPW MLE↓ | 3DPW LVE↓ |
|------|-----------|-----------|-----------|-----------|
| SMIRK* | 2.81 | 8.02 | 4.25 | 2.77 |
| TEASER* | 1.92 | 4.23 | 3.95 | 5.60 |
| SMPLest-X | 8.93 | 15.6 | 13.3 | 9.38 |
| **PEAR** | **0.72** | **1.22** | **3.36** | **0.99** |

> MLE ×10⁻³m, LVE ×10⁻⁵m。PEAR 面部精度碾压所有SMPL-X方法！

### 身体姿态精度

| 方法 | COCO PCK@0.05↑ | 3DPW MPJPE↓ | AGORA MVE↓ |
|------|----------------|-------------|------------|
| OSX | 0.70 | 74.7 | 80.2 |
| Multi-HMR | 0.65 | 78.0 | 59.6 |
| SMPLest-X | 0.71 | 74.8 | 63.5 |
| **PEAR** | **0.81** | **71.3** | **59.3** |

### 手部姿态精度 (PA-PVE)

| 方法 | EHF↓ | UBody↓ |
|------|------|--------|
| OSX | 15.9 | 10.8 |
| Multi-HMR | 16.4 | 11.2 |
| **PEAR** | **12.8** | **9.8** |

### 推理速度

| GPU | EHM-s推理 | 动画 | 总计 | FPS |
|-----|----------|------|------|-----|
| L40S | 0.009s | 0.014s | 0.023s | ~43 |
| RTX 4090 | 0.011s | 0.019s | 0.030s | ~33 |
| RTX 3090 | 0.015s | 0.020s | 0.035s | ~28 |
| RTX 5090 | 0.010s | 0.016s | 0.026s | ~38 |

> 论文声称 >100FPS 指的是仅推理阶段（0.009-0.015s），加上动画驱动仍可达 28-43FPS

---

## 四、架构设计

```
Input Image (256×256)
  │
  ▼
ViT-B Encoder + Decoder (统一backbone)
  │
  ├── SMPL-X Head: θ_b (66D), β_b (10D)
  ├── FLAME Head:  θ_h (3D), β_h (100D), φ_h (50D), s (3D)
  └── Camera Head: π (3D)
  │
  ▼
EHM-s Model (SMPL-X body + FLAME head with scale)
  │
  ├── Body Joints → 3D/2D keypoint supervision
  ├── Facial Keypoints → 2D projection supervision
  └── Pixel-level: GUAVA Neural Renderer → L1 + LPIPS
```

### 与其他方法的架构对比

| 方法 | Backbone | 输入分辨率 | 分支 | FPS |
|------|----------|----------|------|-----|
| OSX | ViT-L/16 | 256×192 | 多分支 | ~20 |
| Multi-HMR | ViT-B/14 | 896×896 | 单分支(粗) | ~10 |
| SMPLest-X | ViT | 高分辨率 | 多分支 | ~20 |
| **PEAR** | **ViT-B/16** | **256×192** | **单分支** | **~100** |

---

## 五、训练配置

| 阶段 | 迭代 | Batch | GPU | 时间 |
|------|------|-------|-----|------|
| Stage 1 (粗) | 200K | 40 | 8×A6000 | ~10天 |
| Stage 2 (精) | 20K | 2 | 8×A6000 | ~1天 |
| 训练数据 | 6M+ 图像 (Part1 3M + Part2 3M) | | | |

---

## 六、与DASH的关系分析

### DASH当前管线 vs PEAR

```
DASH: Camera → MediaPipe(16ms) → Kalman(1ms) → SMPL-X拟合(15ms) → BVH+BS(2ms)
      总计: ~34ms (29FPS), 3个独立模块

PEAR: Camera → ViT-B(9-15ms) → EHM-s参数 → 动画(13-20ms)
      总计: 23-35ms (28-43FPS), 单一模型
```

### 如果DASH采用PEAR

**优势**：
1. ✅ 省去MediaPipe + Kalman + SMPL-X拟合三个模块
2. ✅ 面部精度远超当前方案（LVE 1.22 vs 依赖LibreFace AU间接评估）
3. ✅ 端到端可微，可针对特定场景微调
4. ✅ 支持部分身体输入（仅头部/上半身/全身）

**劣势**：
1. ❌ 需要GPU（ViT-B），CPU无法运行
2. ❌ FLAME输出是50D表情参数，不是52D ARKit BlendShape，需要额外映射
3. ❌ BVH仍需从SMPL-X关节计算
4. ❌ 8×A6000训练，DASH算力有限

### 建议策略

**短期（P1-P3）**：维持DASH当前MediaPipe+SMPL-X拟合管线，PEAR作为P4对比baseline

**长期（后续研究）**：若PEAR开源代码成熟，可考虑：
1. 将PEAR的EHM-s推理替换MediaPipe+K+SMPL-X三段
2. FLAME 50D表情 → ARKit 52D BlendShape 映射（训练MLP）
3. SMPL-X关节旋转 → BVH导出（已有方案）

---

## 七、消融实验关键发现

| 实验 | 结果 |
|------|------|
| 加像素损失 (w/ L_photo) | MLE↓ 7.92→7.19, PA-PVE↓ 13.3→12.8 |
| 加Part2训练数据 | 身体精度↑ 但手部退化 (12.8 vs 9.5) |

**启示**：像素级监督对手部和面部精度至关重要，但训练数据增加有trade-off。

---

## 八、局限

1. 极端遮挡和复杂交互场景仍有困难
2. 暗光/模糊图像未充分测试
3. FLAME表情参数不如ARKit BlendShape在游戏引擎中直接可用
4. 训练资源需求高（8×A6000）
