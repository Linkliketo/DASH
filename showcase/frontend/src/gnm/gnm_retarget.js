// GNM Phase 3：从 reference/retarget.ts 移植 per-frame expression + head pose solve。
import {
  applySimilarity,
  choleskySolve,
  fitSimilarity,
  landmarksToModelAxes,
  matrixToAxisAngle,
} from "./gnm_math.js";

const DEFAULTS = Object.freeze({
  ridge: 0.02,
  depthWeight: 0.1,
  limit: 3,
  smoothing: 0.45,
  gain: 1,
  regionBudget: Object.freeze({ lower_face_region: 4 }),
  regionGain: Object.freeze({ lower_face_region: 1.35 }),
});

function assertFiniteArray(values, label) {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error(`${label} contains NaN/Inf at ${i}`);
  }
}

export class FaceRetargeter {
  constructor(model, options = {}) {
    const correspondence = model.correspondence;
    if (!correspondence) throw new Error("GNM model has no correspondence");
    this.model = model;
    this.options = {
      ...DEFAULTS,
      ...options,
      regionBudget: { ...DEFAULTS.regionBudget, ...(options.regionBudget || {}) },
      regionGain: { ...DEFAULTS.regionGain, ...(options.regionGain || {}) },
    };
    const { smoothing } = this.options;
    if (!(smoothing >= 0 && smoothing < 1)) throw new Error("smoothing must be in [0,1)");

    const count = correspondence.landmarks.length;
    this.rigid = [];
    for (let i = 0; i < count; i++) if (correspondence.rigid[i]) this.rigid.push(i);
    this.allLandmarks = correspondence.landmarks;
    this.rigidLandmarks = Uint16Array.from(this.rigid.map((i) => correspondence.landmarks[i]));

    const budgeted = new Uint8Array(model.expressionDim);
    const perComponentGain = new Float64Array(model.expressionDim).fill(1);
    for (const [name, region] of Object.entries(model.expressionRegions || {})) {
      const budget = this.options.regionBudget[name] ?? region.count;
      const keep = Math.min(budget, region.count);
      for (let i = 0; i < keep; i++) budgeted[region.start + i] = 1;
      for (let i = keep; i < region.count; i++) budgeted[region.start + i] = 2;
      const regionGain = this.options.regionGain[name] ?? 1;
      for (let i = 0; i < region.count; i++) perComponentGain[region.start + i] = regionGain;
    }
    const active = [];
    for (let k = 0; k < model.expressionDim; k++) if (budgeted[k] !== 2) active.push(k);
    this.active = Uint16Array.from(active);
    this.gain = Float64Array.from(this.active, (k) => perComponentGain[k] * this.options.gain);

    this.dim = this.active.length;
    this.rows = count * 3;
    const stride = model.vertexCount * 3;
    this.design = new Float64Array(this.rows * this.dim);
    for (let i = 0; i < count; i++) {
      const vertex = correspondence.vertices[i];
      for (let axis = 0; axis < 3; axis++) {
        const row = i * 3 + axis;
        for (let k = 0; k < this.dim; k++) {
          this.design[row * this.dim + k] =
            model.expressionBasis[this.active[k] * stride + vertex * 3 + axis];
        }
      }
    }
    this.weights = new Float64Array(this.rows);
    for (let i = 0; i < count; i++) {
      this.weights[i * 3] = 1;
      this.weights[i * 3 + 1] = 1;
      this.weights[i * 3 + 2] = this.options.depthWeight;
    }
    this.normal = new Float64Array(this.dim * this.dim);
    for (let row = 0; row < this.rows; row++) {
      const w = this.weights[row];
      const base = row * this.dim;
      for (let a = 0; a < this.dim; a++) {
        const wa = w * this.design[base + a];
        if (wa === 0) continue;
        for (let b = a; b < this.dim; b++) this.normal[a * this.dim + b] += wa * this.design[base + b];
      }
    }
    for (let a = 0; a < this.dim; a++) {
      for (let b = 0; b < a; b++) this.normal[a * this.dim + b] = this.normal[b * this.dim + a];
    }
    let trace = 0;
    for (let a = 0; a < this.dim; a++) trace += this.normal[a * this.dim + a];
    const lambda = (this.options.ridge * trace) / this.dim;
    for (let a = 0; a < this.dim; a++) this.normal[a * this.dim + a] += lambda;

    this.base = new Float64Array(this.rows);
    this.observed = new Float64Array(this.rows);
    this.rigidObserved = new Float64Array(this.rigid.length * 3);
    this.rigidBase = new Float64Array(this.rigid.length * 3);
    this.aligned = new Float64Array(this.rows);
    this.rhs = new Float64Array(this.dim);
    this.smoothed = new Float32Array(model.expressionDim);
    this.smoothedRotation = new Float32Array(3);
    this.started = false;
    this.setIdentity(new Float32Array(model.identityDim));
  }

  setIdentity(identity) {
    const correspondence = this.model.correspondence;
    const stride = this.model.vertexCount * 3;
    const count = correspondence.landmarks.length;
    for (let i = 0; i < count; i++) {
      const vertex = correspondence.vertices[i];
      for (let axis = 0; axis < 3; axis++) {
        let value = correspondence.reference[i * 3 + axis];
        for (let k = 0; k < identity.length; k++) {
          const c = identity[k];
          if (!c) continue;
          value += c * this.model.identityBasis[k * stride + vertex * 3 + axis];
        }
        this.base[i * 3 + axis] = value;
      }
    }
    for (let i = 0; i < this.rigid.length; i++) {
      const source = this.rigid[i] * 3;
      this.rigidBase[i * 3] = this.base[source];
      this.rigidBase[i * 3 + 1] = this.base[source + 1];
      this.rigidBase[i * 3 + 2] = this.base[source + 2];
    }
  }

  reset() {
    this.started = false;
    this.smoothed.fill(0);
    this.smoothedRotation.fill(0);
  }

  solve(landmarks, aspect, options = {}) {
    const mirror = !!options.mirror;
    landmarksToModelAxes(landmarks, this.allLandmarks, aspect, this.observed);
    landmarksToModelAxes(landmarks, this.rigidLandmarks, aspect, this.rigidObserved);
    const transform = fitSimilarity(this.rigidObserved, this.rigidBase);
    applySimilarity(this.observed, transform, this.aligned);

    this.rhs.fill(0);
    for (let row = 0; row < this.rows; row++) {
      const w = this.weights[row];
      const target = w * (this.aligned[row] - this.base[row]);
      if (target === 0) continue;
      const base = row * this.dim;
      for (let a = 0; a < this.dim; a++) this.rhs[a] += this.design[base + a] * target;
    }
    const solved = choleskySolve(this.normal, this.rhs, this.dim);
    const { limit, smoothing } = this.options;
    const alpha = this.started ? 1 - smoothing : 1;
    for (let k = 0; k < this.dim; k++) {
      const target = this.active[k];
      const value = Math.max(-limit, Math.min(limit, solved[k] * this.gain[k]));
      this.smoothed[target] += (value - this.smoothed[target]) * alpha;
    }

    const r = transform.rotation;
    const inverse = Float64Array.from([r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]);
    const rotation = matrixToAxisAngle(inverse, new Float32Array(3));
    // 摄像头预览是 CSS 水平镜像的，但 MediaPipe 输入的是原始帧。
    // 只翻转水平方向的 yaw/roll，不能镜像 3D landmark，否则 handedness 会被破坏。
    if (mirror) {
      rotation[1] = -rotation[1];
      rotation[2] = -rotation[2];
    }
    for (let i = 0; i < 3; i++) {
      this.smoothedRotation[i] += (rotation[i] - this.smoothedRotation[i]) * alpha;
    }
    this.started = true;

    let sum = 0;
    for (let row = 0; row < this.rows; row++) {
      let predicted = this.base[row];
      const base = row * this.dim;
      for (let k = 0; k < this.dim; k++) predicted += this.smoothed[this.active[k]] * this.design[base + k];
      const d = (this.aligned[row] - predicted) * 1000;
      sum += d * d;
    }
    const rms = Math.sqrt((sum * 3) / this.rows);
    assertFiniteArray(this.smoothed, "expression");
    assertFiniteArray(this.smoothedRotation, "headRotation");
    if (!Number.isFinite(rms)) throw new Error("GNM retarget rms is not finite");
    return {
      expression: this.smoothed,
      headRotation: this.smoothedRotation,
      rms,
      transform,
    };
  }
}
