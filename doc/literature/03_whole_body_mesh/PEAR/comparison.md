# 全身Mesh恢复方法综合对比

> 覆盖 PEAR、TokenHMR、Multi-HMR 三大2024-2026年最新HMR方法

---

## 一、方法速览

| 方法 | 发表 | 机构 | 输入 | 输出 | 速度 | 开源 |
|------|------|------|------|------|------|------|
| **PEAR** | SIGGRAPH 2026 | IDEA | 256×256单图 | SMPL-X + FLAME | 100FPS | ✅ 已开源(2026-07核查) |
| TokenHMR | CVPR 2024 | MPI | 单图 | SMPL | ~30FPS | ✅ |
| Multi-HMR | ECCV 2024 | NAVER | 448-896单图 | SMPL-X | ~10-20FPS | ✅ |
| OSX | ICCV 2023 | IDEA | 256×192 | SMPL-X | ~20FPS | ✅ |
| SMPLest-X | TPAMI 2025 | — | 单图 | SMPL-X | ~20FPS | ✅ |

---

## 二、DASH当前管线 vs 各方案

### DASH当前

```
Camera → MediaPipe Holistic → Kalman3D → SMPL-X L-BFGS拟合 → BVH + BlendShape
  0ms        ~16ms            ~1ms           ~15ms              ~2ms
                                              总计: ~34ms (29FPS)
```

### 各方案对DASH的替代程度

| 方案 | 替代哪些模块 | 剩余需要 | 预计延迟 | FPS |
|------|------------|---------|---------|-----|
| PEAR | MediaPipe+K+SMPL-X全部 | BVH导出 + BlendShape | ~25ms | ~40 |
| TokenHMR | 替换SMPL-X拟合 | MediaPipe+K仍在 | ~25ms | ~40 |
| Multi-HMR | 全部替换(含多人) | BVH导出 + BlendShape | ~70ms | ~14 |
| MocapNET v4 | 全部替换 | 需评估精度 | ~33ms | ~30 |

---

## 三、精度对比

### 身体姿态 (3DPW)

| 方法 | MPJPE↓ | PA-MPJPE↓ | 备注 |
|------|--------|-----------|------|
| DASH (SMPL-X拟合) | ~未知 | ~未知 | 待实测 |
| PEAR | 71.3 | 45.3 | 最新SOTA |
| SMPLest-X | 74.8 | 45.8 | |
| Multi-HMR | 78.0 | 45.9 | |
| OSX | 74.7 | 45.1 | |

### 面部精度 (LVE↓)

| 方法 | UBody | 3DPW |
|------|-------|------|
| PEAR | **1.22** | **0.99** |
| SMPLest-X | 15.6 | 9.38 |
| SMIRK(专用面部) | 8.02 | 2.77 |

> PEAR面部精度压倒性优势！

---

## 四、架构选择对DASH的启示

### Backbone趋势

```
2023: CNN + 多分支 (OSX)
2024: ViT + 单分支但高分辨率 (Multi-HMR)
2025: ViT + 单分支 + 像素监督 (PEAR)  ← 最优范式
```

**启示**：DASH如果要做自己的HMR，ViT-B + 256×256 + 像素级监督是当前最佳性价比组合。

### 面部建模趋势

```
SMPL-X原生面部: 精度差 (LVE 9-15)
SMPL-X + FLAME联合: 精度好 (LVE 0.99-1.22) ← PEAR方案
专用面部方法(SMIRK/TEASER): 精度最好但需独立模型
```

**启示**：DASH当前的LibreFace+AU方案 和 PEAR的FLAME直接回归 是互补的两个方向——前者语义化(AU)，后者几何化(顶点)。

---

## 五、推荐行动方案

### P1-P2 (基础搭建阶段)

- ✅ Baseline：MediaPipe + Kalman + SMPL-X拟合 + LibreFace
- 📋 跑通MocapNET v4作为对比baseline
- 📋 下载Multi-HMR官方checkpoint测试DASH场景

### P3 (系统集成阶段)

- 📋 若PEAR开源：评估替换MediaPipe+K+SMPL-X的可能性
- 📋 实现PEAR FLAME 50D → ARKit 52D映射
- 📋 对比 DASH管线 vs PEAR管线 的端到端精度+延迟

### P4 (测试输出阶段)

- 📋 消融实验：DASH方案 vs PEAR方案 vs MocapNET方案
- 📋 定量评估报告 + 用户体验测试

---

## 六、风险提示

| 风险 | 概率 | 缓解 |
|------|------|------|
| PEAR不开源/延迟开源 | 中 | 已备选Multi-HMR+TokenHMR |
| PEAR精度在DASH场景下降 | 中 | 可用DASH自采集数据微调 |
| FLAME→BlendShape映射精度不够 | 低 | MLP映射在GaussianHead论文已验证可行 |
| ViT推理在消费级GPU太慢 | 低 | PEAR已证明RTX 3090可达28FPS |
