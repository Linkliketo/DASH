# DASH 文档索引 / Documentation Index

本目录集中存放 DASH 项目的全部说明性文档，自 2026-09-23 起纳入 git 版本控制。
This directory holds all narrative documentation for DASH, under version control since 2026-09-23.

---

## 一、目录结构 / Structure

```
doc/
├── README.md                    本文件：索引与阅读顺序
├── report/                      阶段报告
│   ├── TECHNICAL_ROUTE_REPORT_EN.md
│   ├── TECHNICAL_ROUTE_REPORT_CN.md
│   └── communication.md
├── design/                      设计与计划
│   ├── 2026-09-16-DASH下一阶段设计.md
│   ├── 2026-09-16-实施计划-阶段0-1.md
│   └── Python-MediaPipe-踩坑总结.md
├── proposal/                    项目方案
│   ├── PR_路线与资源方案.md
│   ├── PR_路线修订_v1.3_本地打基础阶段.md
│   └── 资源获取指南.md
└── literature/                  文献综述
    ├── README.md
    ├── 01_body_motion_capture/ ... 08_mediapipe_model_training/
    └── （论文 PDF 共 20 篇，约 140 MB，本地保留不入库）
```

---

## 二、内容清单 / Contents

### report/ 阶段报告

| 文件 / File | 内容 / Content |
|---|---|
| `TECHNICAL_ROUTE_REPORT_EN.md` | 技术路线报告（英文）：项目范围、V0 验证、量化探针、**全部实测数据**、方法论发现 |
| `TECHNICAL_ROUTE_REPORT_CN.md` | 同上，中文版。**两份报告章节一一对应，可对照阅读** |
| `communication.md` | 协作与沟通过程记录 |

### design/ 设计与计划

| 文件 / File | 内容 / Content |
|---|---|
| `2026-09-16-DASH下一阶段设计.md` | 阶段划分、决策门、模块结构与数据契约、状态归属表、风险清单 |
| `2026-09-16-实施计划-阶段0-1.md` | 第一批 Task 1–9 的可执行清单与验收标准 |
| `Python-MediaPipe-踩坑总结.md` | 已踩过的坑（格式：现象 → 原因 → 正确做法） |

### proposal/ 项目方案

| 文件 / File | 内容 / Content |
|---|---|
| `PR_路线修订_v1.3_本地打基础阶段.md` | **当前有效版本**：9 阶段完整路径 A–I、7 条技术发现、长周期并行项 |
| `PR_路线与资源方案.md` | v1.2，历史版本 |
| `资源获取指南.md` | 数据集与模型的申请路径 |

### literature/ 文献综述

8 个专题，每个专题一份 `papers.md` 汇总加逐篇分析。入口见 `literature/README.md`。

```
01_body_motion_capture        身体动捕（MocapNET、MoCapAnything、VideoPose3D、Holistic）
02_facial_expression          面部表情（LibreFace、OpenFace3、SMIRK、Express4D）
03_whole_body_mesh            全身网格（PEAR、SMPL-X、FLAME、OSX、AMASS、Multi-HMR）
04_inference_optimization     推理优化
05_engine_integration         引擎集成
06_surveys                    综述
07_key_papers_deep_dive       重点论文深读（含 P1-1 决策报告）
08_mediapipe_model_training   MediaPipe 模型训练相关（BlazePose / BlazeFace / Hands）
```

---

## 三、建议阅读顺序 / Suggested reading order

### 快速了解项目 / Quick overview

```
1. report/TECHNICAL_ROUTE_REPORT_CN.md   第 1 节（项目定义）+ 第 4 节（实测数据汇总）
2. report/TECHNICAL_ROUTE_REPORT_CN.md   第 5 节（技术路线）
```

### 了解实验方法与被推翻的早期结论 / Methodology

```
3. report/TECHNICAL_ROUTE_REPORT_CN.md   第 3 节（量化探针：三个问题与证据）
4. report/TECHNICAL_ROUTE_REPORT_CN.md   第 6 节（方法论发现）
5. quant/result/*.md                     原始证据记录
```

### 复现实验 / To reproduce

```
6. report/TECHNICAL_ROUTE_REPORT_CN.md   第 9.2 节（复现命令）
```

### 了解后续规划 / Forward plan

```
7. design/2026-09-16-DASH下一阶段设计.md  阶段划分与决策门
8. design/2026-09-16-实施计划-阶段0-1.md  当前批次的可执行清单
9. proposal/PR_路线修订_v1.3_本地打基础阶段.md  长周期路径与并行项
```

---

## 四、什么文件不入库 / What is not versioned

| 类别 / Category | 位置 / Location | 为什么不入库 |
|---|---|---|
| 论文 PDF（20 篇，约 140 MB） | `literature/**/*.pdf` | **参考资料，不是源码。** 入 git 会让仓库从 1.6 MB 膨胀到 140 MB，且永久留在历史中无法删除。已在 `.gitignore` 挡掉 |
| 模型与数据集 | `models/`、`quant/data/`、`quant/models/` | 同上：产物，不是源码 |
| 申报书与任务书（`.docx` / `.pdf`） | 仓库外（项目根目录） | 二进制、体积大、几乎不再改动 |

> **原则：源码与证据记录入库，参考资料与产物不入库。**
>
> 代价是这些本地文件**没有备份**。需要备份时应另选手段（外部硬盘、云盘），不要放进 git。

---

## 五、仓库外的文档 / Documentation outside this repository

以下文档仍在仓库外，**无版本控制、无备份**：

| 位置 / Location | 内容 / Content |
|---|---|
| `<项目根目录>\PROJECT.md` | 项目总述 |
| `<项目根目录>\testRoad.md` | 早期测试路线 |
| `<项目根目录>\暑期DASH项目总结.md` | 暑期阶段小结 |
| `<项目根目录>\申报书.docx`、`项目任务书.pdf` 等 | 官方申报材料（二进制） |
| `<项目根目录>\AGENTS.md` | 协作约定（**路径已更新指向本目录**） |
| `C:\Users\lings\pi-cwd-20260722\mitacs\interview_prep.md` | 面试缺口对照 |

> `<项目根目录>` = `C:\Users\lings\project\BodyandFicialExpressionModel\`

---

## 六、变更记录 / Change log

| 日期 / Date | 变更 / Change |
|---|---|
| 2026-09-23 | 由 `V0测试报告.md` 与 `技术报告.md` 合并改写为双语技术路线报告；两份旧报告移除（可经 git 历史 `29dbb2c` 取回） |
| 2026-09-23 | 根目录文档移入 `doc/`，并建立 `report/`、`design/`、`proposal/`、`literature/` 四个分区 |
| 2026-09-23 | `D:\DASH\notes\`、`proposal/`、`literature_review/` 三个仓库外目录并入本目录；论文 PDF 以 `.gitignore` 排除 |
