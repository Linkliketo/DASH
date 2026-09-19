# benchmark record

## single image benchmark

### information

* date: 2026/09/18 16:50
* model: models/face_landmarker.task
* data: deploy/assets/test_single.jpg
* mode: IMAGE
* n_warnup/n_runs: 10/100
* mean_ms/p95_ms/p50_ms/min_ms: 11.916166000883095 /13.980785015155561 /11.7372999957297 /10.30309998895973
* output: "the latency is 11.916166000883095 ms, the p95_ms is 13.980785015155561 ms, the p50_ms is 11.7372999957297 ms, the min_ms is 10.30309998895973 ms"
* hardwave: CPU only intel Ultra5 255h on Huawei laptop, win11 version

### comment

for some reason, the benchmark is just on IMAGE mode which is not the same mode compare to running mode
however, they can indicate with each other on the efficiency dimension 
the output can instruct you to choose the video frame rates

Inference at 12 ms corresponds to a theoretical upper limit of ~83 FPS, far above the camera's 30 FPS cap. 
Therefore, the current bottleneck is on the capture side, and the gains from quantization optimization will only materialize in scenarios with higher resolution or running multiple models simultaneously.
