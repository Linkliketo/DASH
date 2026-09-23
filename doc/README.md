# DASH 文档索引 / Documentation Index

本目录集中存放 DASH 项目的**说明性文档**。证据记录与组件说明保留在各自模块旁边，原因见第二节。

This directory holds the project's **narrative documentation**. Evidence records and
component-level notes stay next to the code that produces them; see section 2.

---

## 一、本目录内容 / Contents

| 文件 / File | 内容 / Content | 语言 / Language |
|---|---|---|
| `TECHNICAL_ROUTE_REPORT_EN.md` | 技术路线报告：项目范围、V0 验证、量化探针、实测数据、方法论发现 / Technical route report: scope, V0 validation, quantization probe, measured data, methodology findings | English |
| `TECHNICAL_ROUTE_REPORT_CN.md` | 同上，中文版 / Same document in Chinese | 中文 |
| `communication.md` | 协作与沟通过程记录 / Collaboration and communication log | 中文 |

**两份报告的章节一一对应，可直接对照阅读。**

The two reports have section-for-section parallel structure and can be read side by side.

---

## 二、为什么有些文档不在这里 / Documents kept elsewhere

| 位置 / Location | 文件 / Files | 为什么不移入 `doc/` |
|---|---|---|
| `quant/result/` | `bench_baseline.md`、`probe_unpack.md`、`probe_route_a.md`、`pairs_preview.png` | 这些是**脚本产出的证据**，由 `quant/*.py` 以硬编码路径写入。移动会打断「脚本 → 证据」的对应关系 |
| `deploy/README.md` | 部署组件说明 | **组件级 README**，按惯例与代码同目录 |
| `models/README.md` | 模型清单与下载说明 | 同上 |

> Evidence records under `quant/result/` are written by `quant/*.py` at hard-coded paths.
> Moving them would break the script-to-evidence mapping. Component READMEs stay with their
> components by convention.

---

## 三、建议阅读顺序 / Suggested reading order

### 想快速了解项目 / For a quick overview

```
1. TECHNICAL_ROUTE_REPORT_CN.md   第 1 节（项目定义）+ 第 4 节（实测数据汇总）
2. TECHNICAL_ROUTE_REPORT_CN.md   第 5 节（技术路线）
```

### 想了解实验怎么做的、踩过什么坑 / For methodology detail

```
3. TECHNICAL_ROUTE_REPORT_CN.md   第 3 节（量化探针：三个问题与证据）
4. TECHNICAL_ROUTE_REPORT_CN.md   第 6 节（方法论发现：含被推翻的早期结论）
5. quant/result/*.md               原始证据记录
```

### 想复现实验 / To reproduce

```
6. TECHNICAL_ROUTE_REPORT_CN.md   第 9.2 节（复现命令）
```

---

## 四、仓库外的文档 / Documentation outside this repository

以下是 DASH 项目的其他文档，**目前不在本 git 仓库内**（因此没有版本历史和备份）：

| 位置 / Location | 内容 / Content |
|---|---|
| `D:\DASH\notes\` | 阶段设计文档、实施计划、MediaPipe 踩坑总结 |
| `<project-root>\proposal\` | 路线与资源方案（v1.2、v1.3）、资源获取指南 |
| `<project-root>\literature_review\` | 文献综述（8 个专题，含逐篇分析） |
| `<project-root>\` | `PROJECT.md`、`testRoad.md`、申报书与任务书 |

**已知风险**：上述目录无版本控制、无备份。是否纳入本仓库待决定。

Known risk: the locations above have no version control and no backup. Whether to bring them
under this repository is an open decision.

---

## 五、本目录的变更记录 / Change log for this directory

| 日期 / Date | 变更 / Change |
|---|---|
| 2026-09-23 | 由 `V0测试报告.md` 与 `技术报告.md` 合并改写为双语技术路线报告；两份旧报告已移除（可经 git 历史 `29dbb2c` 取回）。根目录文档移入本目录 |
