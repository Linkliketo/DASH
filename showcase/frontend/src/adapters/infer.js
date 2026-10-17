// 统一的单帧推理入口：adapter 可以只实现 infer，不能假设有 detectForVideo。
export function inferFrame(landmarker, source, timestampMs, convert = (value) => value) {
  if (typeof landmarker?.inferVideo === "function") {
    return landmarker.inferVideo(source, timestampMs);
  }
  if (typeof landmarker?.infer === "function") {
    return landmarker.infer(source, timestampMs);
  }
  if (typeof landmarker?.detectForVideo === "function") {
    return convert(landmarker.detectForVideo(source, timestampMs));
  }
  throw new Error("landmarker 不支持 inferVideo/infer/detectForVideo");
}
