# S2 面部表情 — AU检测/表情识别/BlendShape生成

> 关键词：Facial Action Unit, AU Detection, Facial Expression Recognition, ARKit BlendShape
> 
> DASH 定位：从面部468关键点→AU Intensity→52 BlendShape→Unity/Unreal

---

## 一、核心工具包

### 1. LibreFace: An Open-Source Toolkit for Deep Facial Expression Analysis
- **出处**：WACV 2024 (USC ICT)
- **链接**：https://boese0601.github.io/libreface | GitHub: ihp-lab/LibreFace
- **论文**：https://openaccess.thecvf.com/content/WACV2024/papers/Chang_LibreFace_An_Open-Source_Toolkit_for_Deep_Facial_Expression_Analysis_WACV_2024_paper.pdf
- **方法**：MAE(ViT-B)教师 → 特征级知识蒸馏 → ResNet-18学生
- **性能**：DISFA PCC=0.63 (+7% vs OpenFace2.0)，推理速度2× OpenFace
- **更新**：LibreFace 2.0 (FG 2026) 加入合成数据+RepVGG，AU检测公平性提升
- **与DASH关联**：DASH当前选型技术，22.5M参数

### 2. OpenFace 3.0: A Lightweight Multitask System for Comprehensive Facial Behavior Analysis
- **出处**：IEEE FG 2025
- **链接**：https://arxiv.org/html/2506.02891v1
- **方法**：统一landmark检测+AU检测+视线估计+表情识别
- **对比**：与LibreFace、ME-GraphAU、SPIGA、MCGaze等全面对比
- **与DASH关联**：可作为LibreFace的替代/补充方案

### 3. OpenFace 2.0
- **出处**：IEEE TAC 2018
- **链接**：https://github.com/TadasBaltrusaitis/OpenFace
- **内容**：经典面部分析工具，landmark+AU+视线
- **缺点**：传统方法为主，速度较LibreFace慢

---

## 二、面部表情识别综述

### 4. A Survey on Facial Expression Recognition of Static and Dynamic Emotions
- **出处**：arXiv:2408.15777, 2024
- **链接**：https://arxiv.org/html/2408.15777v1
- **内容**：静态/动态表情识别全面综述，含CLIP-based方法（EmoCLIP, FineCLIPER）
- **基准**：DFEW, FERV39k, MAFW数据集

### 5. Advances in Facial Micro-Expression Detection and Recognition: A Comprehensive Review
- **出处**：Information (MDPI), 2025
- **链接**：https://www.mdpi.com/2078-2489/16/10/876
- **内容**：微表情检测与识别综述，3D-CNN/Transformer/GNN方法对比
- **与DASH关联**：DASH关注"微表情"，此文直接相关

### 6. Deep Learning-based Facial Micro-Expression Analysis: A Survey
- **出处**：Curr Trends Biomedical Eng & Biosci, 2024
- **链接**：https://juniperpublishers.com/ctbeb/pdf/CTBEB.MS.ID.556086.pdf
- **内容**：微表情数据集+算法综述

---

## 三、AU检测新方法

### 7. A Non-Invasive Approach for Facial Action Unit Extraction (2025)
- **出处**：PMC11851526
- **链接**：https://pmc.ncbi.nlm.nih.gov/articles/PMC11851526
- **方法**：仅用3D面部landmarks→轻量NN（2层128+8神经元）→AU检测
- **性能**：top-8 AU F1=79.25%，仅数千参数（vs ResNet50 25.6M）
- **与DASH关联**：极轻量方案，仅需landmarks不需要图像，适合DASH管线

### 8. ME-GraphAU
- **方法**：图网络建模AU间关系，多维边特征
- **参数**：67.4M（较重），但AU关系建模思路可参考

---

## 四、ARKit BlendShape相关

### 9. Real-Time Facial Animation of Gaussian Head Avatars via Mocap-to-BlendShape Mapping (2025)
- **链接**：https://openreview.net/pdf/5773a48cdb4c1207a556847965d096f03c51b5d8.pdf
- **方法**：ARKit BlendShape → FLAME表达参数映射（KNN/Ridge/MLP）
- **流程**：iPhone TrueDepth → 51维BlendShape → Expression Mapper → FLAME → Gaussian Head → 60FPS渲染
- **与DASH关联**：RBF映射的替代方案参考，三种回归器对比有价值

### 10. Express4D: Expressive 4D Facial Motion Generation Benchmark
- **出处**：arXiv:2508.12438, 2025
- **链接**：https://arxiv.org/html/2508.12438v1
- **方法**：iPhone TrueDepth → 52 ARKit BlendShape + 9旋转参数 (60Hz)
- **数据**：含情绪标签的面部运动数据集
- **与DASH关联**：可作为BlendShape ground truth采集方案参考

### 11. Audio2Face-3D: Audio-driven Realistic Facial Animation
- **出处**：arXiv:2508.16401, 2025
- **方法**：音频→面部运动delta→BlendShape求解器→ARKit兼容输出
- **亮点**：含MetaHuman兼容的BlendShape分解器

---

## 五、3D面部重建（表情方向）

### 12. EMOCA: Emotion Driven Monocular Face Capture and Animation
- **出处**：CVPR 2022 (Max Planck Institute)
- **链接**：https://emoca.is.tue.mpg.de | GitHub: radekd91/emoca
- **方法**：DECA扩展，加入情感一致性损失 → FLAME参数回归
- **参数**：334参数（100 shape + 50 expression + 6 pose + 100 detail + 50 texture + ...）
- **更新**：EMOCA v2 改进唇部和眼部对齐
- **与DASH关联**：将AU检测思路升级为直接FLAME回归的可能方向

### 13. Ig3D: Integrating 3D Face Representations in Facial Expression Inference
- **出处**：ECCV 2024
- **链接**：https://arxiv.org/html/2408.16907v1
- **方法**：融合EMOCA/SMIRK的3D FLAME编码→提升表情分类/valence-arousal
- **亮点**：验证了3D几何对表情理解的增益

### 14. FLAME-Universe
- **链接**：https://github.com/TimoBolkart/FLAME-Universe
- **内容**：FLAME 3D头部模型生态总结：代码/数据集/论文索引
- **亮点**：2024年大量FLAME相关新工作（GPAvatar, LightAvatar, SPARK等）

---

## 六、与DASH选型的直接对比

| 维度 | LibreFace (DASH选型) | OpenFace 3.0 | EMOCA | 仅Landmark方法 |
|------|---------------------|-------------|-------|---------------|
| 输入 | 面部图像 | 面部图像 | 面部图像 | 468 landmarks |
| 输出 | 17 AU | 18 AU + 视线 + 表情 | FLAME参数 | AU强度 |
| 模型大小 | 22.5M | ~70M | ~300M | <0.01M |
| 速度 | 2× OpenFace | 实时 | ~离线 | 极快 |
| DASH适用性 | ★★★★★ | ★★★★ | ★★★ | ★★★★ |
