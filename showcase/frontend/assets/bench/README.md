# Benchmark 固定输入

- 文件：`single-face-30fps.mp4`
- 来源：`deploy/imgage_test/single_face_vedio_every_position.mp4`（项目负责人本人素材，已同意用于本项目测试）
- 规格：1280×720，30 FPS，9.47 s，701 KB
- SHA-256：`587d6a16500976db5bbaaa143275ca25483df4f0eb4e6323c8bce1b2cce14ad9`
- 用途：仅 `?bench=collect` 持续负载采集；不调用摄像头，不上传，不默认展示。
- 视频文件按 `.gitignore`（`*.mp4`）不入库；部署采集环境时需单独上传。
