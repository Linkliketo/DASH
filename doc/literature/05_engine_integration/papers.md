# S4 引擎集成 — Unity/Unreal 实时动画驱动

> 关键词：BVH, ARKit BlendShape, Unity, Unreal Engine, Live Link, MetaHuman
>
> DASH 目标：BVH + BlendShape → Unity C# UDP / Unreal Live Link

---

## 一、工业级面部动画方案（竞品/参考）

### 1. MetaHuman Animator (Epic Games)
- **链接**：https://dev.epicgames.com/documentation/metahuman/metahuman-animator-in-unreal-engine
- **功能**：
  - 实时模式：任意单目摄像头（含webcam）→ MetaHuman面部动画
  - 离线模式：TrueDepth深度数据 → 高精度面部动画
  - 音频模式：纯音频 → 完整表情动画
- **亮点**：GPU/NPU处理，无需深度数据即可实时运行
- **与DASH关联**：DASH的核心竞品，展示了工业级单摄像头面部动画的可行性

### 2. NVIDIA Audio2Face
- **链接**：https://developer.nvidia.com/ace
- **方法**：音频→ARKit BlendShape (52维) → UE5 MetaHuman
- **输出**：含72 BlendShape（覆盖ARKit 52 + 额外）
- **2025更新**：已开源
- **与DASH关联**：DASH使用视频而非音频输入，但ARKit→引擎的集成方式可参考

### 3. NVIDIA ACE 平台
- **功能**：LLM + TTS + Audio2Face → 完整数字人交互
- **组件**：ACE Agent (对话) + Audio2Face (动画) + Nemotron (渲染)
- **与DASH关联**：DASH可定位为"视频驱动的ACE替代方案"

---

## 二、BVH/骨骼动画集成

### 4. Realtime_SMPLX_Unity (GitHub)
- **链接**：https://github.com/sangho0n/Realtime_SMPLX_Unity
- **方法**：实时SMPL-X姿态估计 → Unity骨骼动画
- **技术栈**：MediaPipe + Python Server + Unity UDP通信
- **局限**：ONNX-Barracuda转换存在精度问题
- **与DASH关联**：与DASH的S4方案几乎一致，可复现参考

### 5. Unity SMPL-X/SMPL+H Integration
- **链接**：https://smpl-x.is.tue.mpg.de (Downloads)
- **更新**：2026.06 — Unreal Engine SMPL-X集成已可用
- **内容**：官方SMPL-X/SMPL+H在Unity/Unreal的导入器+动画器

---

## 三、ARKit BlendShape 参考

### 6. The Ultimate Guide to Creating ARKit's 52 Facial Blendshapes
- **链接**：https://pooyadeperson.com/the-ultimate-guide-to-creating-arkits-52-facial-blendshapes
- **内容**：52个BlendShape与FACS AU的对应关系 + 解剖学参考
- **与DASH关联**：DASH中RBF映射（AU→BlendShape）的参考对照

### 7. Solving Blendshapes for ARKit
- **链接**：https://filmicworlds.com/blog/solving-face-scans-for-arkit
- **内容**：从3D扫描数据求解ARKit兼容BlendShape的实践经验
- **亮点**：解决"看起来不自然"问题的技术细节

---

## 四、实时通信协议

### 8. Live Link Face (Epic Games, iOS)
- **方法**：iPhone TrueDepth → 61参数（52 BlendShape + 3头部旋转 + 6眼部旋转）
- **协议**：OSC/UDP → UE5 Live Link
- **帧率**：60Hz

### 9. Rokoko Studio (实时动捕到引擎)
- **方法**：RGB视频→骨骼/BlendShape→FBX/BVH导出→Blender/Unity/Unreal
- **免费层**：15秒录制，实时预览

---

## 五、DASH S4 架构建议

```
S3推理输出 (BVH + BlendShape)
  │
  ├─→ Unity 路径
  │   └─ C# UDP Server
  │       └─ Humanoid Avatar Mapper (BVH → Mecanim)
  │       └─ BlendShape Controller (52 params → SkinnedMeshRenderer)
  │
  └─→ Unreal 路径
      └─ Live Link Plugin (C++)
          └─ BVH → Control Rig/IK Rig
          └─ BlendShape → MetaHuman Face Board
```

**关键注意事项**：
1. 时间戳对齐：BVH帧与BlendShape帧的PTS同步（DASH已有3帧Ring Buffer方案）
2. 骨骼重定向：SMPL-X 24关节 → Unity Humanoid / Unreal Mannequin 映射
3. 坐标系统：右手坐标系(Y-up) vs 左手坐标系(Z-up)转换
4. 网络延迟：UDP localhost <1ms，跨进程 ~2-5ms
