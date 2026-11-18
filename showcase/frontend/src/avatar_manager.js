// AvatarManager：选择当前 avatar backend，并暴露与 Avatar 兼容的只读指标。
// GNM 接入时 register("gnm", backend)；失败回退由 setActive/fallback 统一处理。
export class AvatarManager {
  constructor({ backends = {}, onChange = null } = {}) {
    this.backends = new Map();
    this.activeId = null;
    this.onChange = onChange;
    for (const [id, backend] of Object.entries(backends)) this.register(id, backend);
  }

  register(id, backend) {
    if (!backend) throw new Error(`avatar backend ${id} is missing`);
    this.backends.set(id, backend);
  }

  has(id) {
    return this.backends.has(id);
  }

  async setActive(id) {
    const backend = this.backends.get(id);
    if (!backend) throw new Error(`unknown avatar backend: ${id}`);
    this.activeId = id;
    this.onChange?.(id, backend);
    return backend;
  }

  get active() {
    return this.activeId ? this.backends.get(this.activeId) : null;
  }

  get activeBackendId() {
    return this.activeId;
  }

  get ready() {
    return !!this.active?.ready;
  }

  get lastTiming() {
    return this.active?.lastTiming || { rigMs: 0, renderMs: 0, mappingMs: 0, totalMs: 0 };
  }

  get lastMappingMs() {
    return this.active?.lastMappingMs || 0;
  }

  get renderedFrames() {
    return this.active?.renderedFrames || 0;
  }

  get lastGnm() {
    return this.active?.lastGnm || null;
  }

  update(frame, options = {}) {
    this.active?.update(frame, options);
  }

  render() {
    this.active?.render();
  }

  resize(width, height) {
    this.active?.resize(width, height);
  }

  reset() {
    this.active?.reset();
  }

  dispose() {
    for (const backend of this.backends.values()) backend.dispose?.();
  }

  fallback() {
    if (this.has("vrm") && this.activeId !== "vrm") return this.setActive("vrm");
    return this.active;
  }
}
