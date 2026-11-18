// GNM Phase 4：共享 FaceFrame 的 3DMM backend。
// 资产惰性加载；identity fit 显式开始；VRM 在 GNM ready 前保持可见。
import { AvatarBackend } from "../avatar_backend.js";
import { loadGnmAssets } from "../gnm/gnm_assets.js";
import { parseGnmModel } from "../gnm/gnm_model.js";
import { gnmForward } from "../gnm/gnm_forward.js";
import { fitIdentity } from "../gnm/gnm_fit.js";
import { FaceRetargeter } from "../gnm/gnm_retarget.js";
import { GnmRenderer } from "../gnm/gnm_renderer.js";

export class GnmBackend extends AvatarBackend {
  constructor(avatar) {
    super("gnm");
    this.avatar = avatar;
    this.model = null;
    this.renderer = null;
    this.retargeter = null;
    this.identity = null;
    this.state = "idle";
    this.lastFrame = null;
    this.captureStart = 0;
    this.captureFrames = 0;
    this._capturePromise = null;
    this._captureResolve = null;
    this._captureReject = null;
    this._captureTimer = null;
    this._lastTiming = { rigMs: 0, renderMs: 0, mappingMs: 0, totalMs: 0 };
    this.lastGnm = {
      gnm_load_ms: 0,
      gnm_identity_fit_ms: 0,
      gnm_solve_ms: 0,
      gnm_forward_ms: 0,
      gnm_render_ms: 0,
      gnm_frame_ms: 0,
      gnm_state: "idle",
      gnm_fallback: false,
    };
    this._renderedFrames = 0;
    this._active = false;
    this._raf = 0;
    this._lastMirror = false;
  }

  async init({ signal, onProgress } = {}) {
    this.state = "loading";
    const assets = await loadGnmAssets({ signal, onProgress });
    this.model = parseGnmModel(assets.headJson, assets.binBuffer, assets.correspondence);
    this.renderer = new GnmRenderer(this.avatar);
    this.renderer.setModel(this.model);
    this.retargeter = new FaceRetargeter(this.model);
    this.lastGnm.gnm_load_ms = assets.loadMs;
    this.lastGnm.gnm_asset_version = assets.version;
    this.lastGnm.gnm_asset_sha256 = assets.sha256;
    this.state = "loaded";
    return this;
  }

  startIdentityCapture({ durationMs = 1500 } = {}) {
    if (!this.model || !this.retargeter) throw new Error("GNM assets not loaded");
    if (this.state === "capturing" || this.state === "fitting") return this._capturePromise;
    this.state = "capturing";
    this.captureStart = performance.now();
    this.captureFrames = 0;
    this.lastFrame = null;
    this._capturePromise = new Promise((resolve, reject) => {
      this._captureResolve = resolve;
      this._captureReject = reject;
    });
    if (this._captureTimer) clearTimeout(this._captureTimer);
    this._captureTimer = setTimeout(() => this.finishIdentityCapture(), durationMs);
    return this._capturePromise;
  }

  captureFrame(frame) {
    if (this.state !== "capturing" || !frame?.landmarks) return;
    this.lastFrame = frame;
    this.captureFrames++;
    if (performance.now() - this.captureStart >= 1500 || this.captureFrames >= 45) {
      this.finishIdentityCapture();
    }
  }

  async finishIdentityCapture() {
    if (this.state !== "capturing") return;
    if (this._captureTimer) {
      clearTimeout(this._captureTimer);
      this._captureTimer = null;
    }
    this.state = "fitting";
    const t0 = performance.now();
    try {
      const frame = this.lastFrame;
      if (!frame?.landmarks) throw new Error("没有可用于 identity fit 的人脸帧");
      const fit = fitIdentity(this.model, frame.landmarks, frame.aspect || 1);
      this.identity = fit.identity;
      this.retargeter.setIdentity(this.identity);
      this.lastGnm.gnm_identity_fit_ms = Math.round((performance.now() - t0) * 10) / 10;
      this.state = "ready";
      const vertices = gnmForward(this.model, { identity: this.identity });
      this.renderer.setVertices(vertices);
      this._captureResolve?.(fit);
    } catch (error) {
      this.state = "failed";
      this._captureReject?.(error);
    } finally {
      this._captureResolve = null;
      this._captureReject = null;
    }
  }

  cancelIdentityCapture() {
    if (this._captureTimer) {
      clearTimeout(this._captureTimer);
      this._captureTimer = null;
    }
    if (this.state !== "capturing" && this.state !== "fitting") return;
    this.state = "loaded";
    this._captureReject?.(new Error("identity fit cancelled"));
    this._captureResolve = null;
    this._captureReject = null;
    this._captureTimer = null;
  }

  activate() {
    if (!this.ready) throw new Error("GNM is not ready");
    this._active = true;
    this.avatar.setRenderingEnabled(false);
    const loop = () => {
      if (!this._active) return;
      this.renderer.render();
      this._raf = requestAnimationFrame(loop);
    };
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(loop);
  }

  deactivate() {
    this._active = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.avatar.setRenderingEnabled(true);
  }

  update(frame, options = {}) {
    if (!this.ready || !this._active || !frame?.landmarks) return;
    const t0 = performance.now();
    try {
      const aspect = options.aspect || frame.aspect || 1;
      const mirror = !!options.mirror;
      this._lastMirror = mirror;
      const solved = this.retargeter.solve(frame.landmarks, aspect, { mirror });
      const t1 = performance.now();
      const rotations = new Float32Array(4 * 3);
      rotations.set(solved.headRotation, 3);
      const vertices = gnmForward(this.model, {
        identity: this.identity,
        expression: solved.expression,
        rotations,
        translation: new Float32Array(3),
      });
      const t2 = performance.now();
      this.renderer.setVertices(vertices);
      this.renderer.render();
      const t3 = performance.now();
      this.lastGnm = {
        ...this.lastGnm,
        gnm_solve_ms: Math.round((t1 - t0) * 10) / 10,
        gnm_forward_ms: Math.round((t2 - t1) * 10) / 10,
        gnm_render_ms: Math.round((t3 - t2) * 10) / 10,
        gnm_frame_ms: Math.round((t3 - t0) * 10) / 10,
        gnm_state: this.state,
        gnm_fallback: false,
      };
      this._lastTiming = {
        rigMs: 0,
        renderMs: t3 - t2,
        mappingMs: 0,
        totalMs: t3 - t0,
      };
      this._renderedFrames++;
    } catch (error) {
      this.state = "failed";
      this.lastGnm = { ...this.lastGnm, gnm_state: "failed", gnm_fallback: true };
      throw error;
    }
  }

  render() {
    if (this._active) this.renderer?.render();
  }

  resize() {
    this.renderer?.resize();
  }

  reset() {
    this.retargeter?.reset();
  }

  dispose() {
    this.deactivate();
    this.renderer?.dispose();
    this.renderer = null;
  }

  get ready() {
    return this.state === "ready";
  }

  get lastTiming() {
    return this._lastTiming;
  }

  get lastMappingMs() {
    return 0;
  }

  get renderedFrames() {
    return this._renderedFrames;
  }
}
