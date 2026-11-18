// AvatarBackend 的运行时契约。当前实现：VRM；GNM 后续接入。
// 一个 backend 只负责消费共享 FaceFrame，不创建 MediaPipe 或摄像头。
export class AvatarBackend {
  constructor(id) {
    this.id = id;
  }

  async init() {
    throw new Error("AvatarBackend.init() not implemented");
  }

  update(_frame, _options = {}) {
    throw new Error("AvatarBackend.update() not implemented");
  }

  render() {}

  resize(_width, _height) {}

  reset() {}

  dispose() {}

  get ready() {
    return false;
  }

  get lastTiming() {
    return { rigMs: 0, renderMs: 0, mappingMs: 0, totalMs: 0 };
  }

  get lastMappingMs() {
    return 0;
  }

  get renderedFrames() {
    return 0;
  }
}
