// 统一的单帧推理入口：adapter 可以只实现 async infer。
export function inferFrame(landmarker, source, timestampMs) {
  if (typeof landmarker?.inferVideo === "function") {
    return landmarker.inferVideo(source, timestampMs);
  }
  if (typeof landmarker?.infer === "function") {
    return landmarker.infer(source, timestampMs);
  }
  throw new Error("landmarker 不支持 inferVideo/infer");
}
