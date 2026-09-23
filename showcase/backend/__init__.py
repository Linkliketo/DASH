# DASH 展示 demo 的面部感知后端。
#
# 职责：照片 / 视频 / 摄像头三种输入 -> 52 维 BlendShape + 头部姿态，
# 以 miniface-frame 契约推给 fusion/server.mjs（见 contract.py），
# 从而替换第三方 miniface，前端 viewer 零改动。
