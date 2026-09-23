
dashCoder: {

    V0 新增单视频源模式（负责人提议：一个视频喂 SysMocap+miniface 两路，无需双摄像头）
    1. tools/video_to_y4m.py：视频→y4m（默认取前5秒、不循环，5s≈67MB；已控制体积）
    2. face_from_video.bat：Chrome 假摄像头喂 miniface
    3. SysMocap 侧：原生支持「选择视频文件」（MocapTab 已有）
    4. 实测：模式4合成源通；视频→miniface 通（清晰人脸 face 3FPS）；openpose示例视频人脸太小检测不稳定
    文件：D:\DASH\V0FastTest\{tools/video_to_y4m.py, face_from_video.bat, V0测试报告.md}
}

dashCoder: {

    链条3 单视频源全链路已逐跳验证打通（视频→SysMocap关节+miniface面部→融合→viewer渲染）
    实测：body 10FPS + face 3FPS → fused 22FPS
    修复4坑：①SysMocap视频模式需设Vue状态 videoPath（非localStorage，否则alert阻塞）；②riggedPose真实结构四肢{ x,y,z }直存、仅Hips有.rotation、无Chest/Neck/Head；③viewer改 P[k].rotation||P[k]；④转发:8080仅动捕运行时监听
    文件：D:\DASH\V0FastTest\{V0测试报告.md, viewer/index.html}
}
