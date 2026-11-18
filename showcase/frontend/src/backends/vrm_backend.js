// VRM backend：包装现有 Avatar，确保 Phase 1 行为不变。
import { AvatarBackend } from "../avatar_backend.js?v=26";

export class VrmBackend extends AvatarBackend {
  constructor(avatar) {
    super("vrm");
    if (!avatar) throw new Error("VrmBackend requires an Avatar instance");
    this.avatar = avatar;
  }

  async init() {
    return this.avatar;
  }

  update(frame, options = {}) {
    if (!frame) return;
    if (frame.blendshapes) this.avatar.setBlendshapes(frame.blendshapes, options);
    if (frame.headEuler) this.avatar.setHeadEuler(frame.headEuler, options);
  }

  render() {
    // Avatar owns its own animation loop; no extra render call.
  }

  resize() {
    // Avatar uses ResizeObserver; no public resize hook required.
  }

  reset() {
    this.avatar.resetPose?.();
  }

  dispose() {
    // Avatar currently owns WebGL resources for the page lifetime.
  }

  get ready() {
    return !!this.avatar?.ready;
  }

  get lastTiming() {
    return this.avatar?.lastTiming || { rigMs: 0, renderMs: 0, mappingMs: 0, totalMs: 0 };
  }

  get lastMappingMs() {
    return this.avatar?.lastMappingMs || 0;
  }

  get renderedFrames() {
    return this.avatar?.renderedFrames || 0;
  }
}
