# S3 推理优化 — 量化/剪枝/编译/部署

> 关键词：INT8 Quantization, QAT, ONNX Runtime, Structured Pruning, torch.compile
>
> DASH 目标：5.8×加速，<2%精度损失，85%模型压缩

---

## 一、INT8量化核心技术

### 1. Quantization-Aware Training for Large Language Models with PyTorch
- **出处**：PyTorch 官方博客, 2024
- **链接**：https://pytorch.org/blog/quantization-aware-training
- **内容**：torchao QAT流程详解：Int8动态逐token激活 + Int4分组逐通道权重
- **方案**：prepare（插入伪量化op）→ 训练 → convert（伪量化→真量化）
- **与DASH关联**：DASH当前选型torchao QAT的直接参考

### 2. Achieving FP32 Accuracy for INT8 Inference Using QAT with TensorRT
- **出处**：NVIDIA Developer Blog
- **链接**：https://developer.nvidia.com/blog/achieving-fp32-accuracy-for-int8-inference-using-quantization-aware-training-with-tensorrt
- **内容**：TensorRT QAT工具包+Pytorch Quantization，ONNX Q/DQ算子导出
- **流程**：PyTorch QAT → ONNX (Q/DQ) → TensorRT 显式量化模式
- **关键**：Per-channel量化 (ONNX opset≥13) + do_constant_folding=True

### 3. INT8 Inference of Quantization-Aware trained models using ONNX-TensorRT
- **出处**：NVIDIA GTC 演讲
- **链接**：https://www.youtube.com/watch?v=WEqzbBDqs2I
- **内容**：端到端QAT工作流：TF2/Torch→ONNX→TensorRT INT8优化

---

## 二、ONNX Runtime部署

### 4. Optimizing and Deploying Transformer INT8 Inference with ONNX Runtime-TensorRT
- **出处**：Microsoft Open Source Blog, 2022
- **链接**：https://opensource.microsoft.com/blog/2022/05/02/optimizing-and-deploying-transformer-int8-inference-with-onnx-runtime-tensorrt-on-nvidia-gpus
- **内容**：ORT-TensorRT INT8部署完整流程
- **覆盖**：QAT→ONNX导出→ORT TensorRT EP→INT8推理

### 5. Deploying QAT models in INT8 using Torch-TensorRT
- **出处**：PyTorch/Torch-TensorRT文档
- **链接**：https://docs.pytorch.org/TensorRT/_notebooks/vgg-qat.html
- **内容**：VGG16 QAT→TorchScript→Torch-TensorRT INT8部署完整示例

---

## 三、轻量化/剪枝

### 6. torchao (Meta PyTorch, 2024)
- **出处**：PyTorch官方
- **链接**：https://github.com/pytorch/ao
- **内容**：PyTorch原生量化/剪枝/蒸馏工具箱
- **DASH用法**：INT8 QAT + L2结构化剪枝 + torch.compile

---

## 四、CPU推理加速

### 7. Quantize PyTorch Model in INT8 for Inference using Intel Neural Compressor
- **出处**：BigDL Nano文档
- **链接**：https://bigdl.readthedocs.io/en/v2.4.0/doc/Nano/Howto/Inference/PyTorch/quantize_pytorch_inference_inc.html
- **内容**：INC INT8 PTQ + ONNXRuntime加速，ResNet-18示例

### 8. Leaner LLM Inference with INT8 Quantization on AMD GPUs using PyTorch
- **出处**：AMD ROCm Blog, 2024
- **链接**：https://rocm.blogs.amd.com/artificial-intelligence/int8-quantization/README.html
- **内容**：PTQ vs QAT对比 + GPT-Fast基准：INT8比torch.compile提升25-45%

---

## 五、已知问题与解决方案

### 9. INT8 Quantization Model from torch to onnx slower than FP32 (GitHub Issue)
- **出处**：onnx/onnx#6030, 2024
- **链接**：https://github.com/onnx/onnx/issues/6030
- **问题**：简单CNN INT8 ONNX在CPU上比FP32慢（15.52s vs 10.28s）
- **原因**：CPU缺乏INT8指令优化时，Q/DQ节点反而增加开销
- **与DASH关联**：DASH的ONNX CPU路径(QNNPACK)需确认是否真正受益

### 10. Struggling with INT8 Quantization from PyTorch to ONNX
- **出处**：Reddit r/computervision
- **链接**：https://www.reddit.com/r/computervision/comments/1ixm3qk/
- **问题**：OpenCV dnn与ONNX INT8 Q/DQ节点兼容性问题
- **备选方案**：OpenVINO量化 / NNCF → 更易于部署

---

## 六、DASH推理优化管线对照

| 阶段 | DASH方案 | 替代/增强方案 | 参考 |
|------|---------|-------------|------|
| QAT | torchao INT8 | TensorRT QAT Toolkit (NVIDIA) | [2] |
| 剪枝 | L2 Norm 30% | 结构化+非结构化混合 | — |
| 编译 | torch.compile | torch.compile + TensorRT | [5] |
| CPU部署 | ONNX QNNPACK | Intel INC + ORT | [7] |
| GPU部署 | ONNX TensorRT | Torch-TensorRT / TRT Standalone | [4] |

**关键建议**：CPU路径(QNNPACK)的实际加速效果需要在目标硬件(i7-10750H)上实测验证，可能需要借助Intel INC或OpenVINO达到更好效果。
