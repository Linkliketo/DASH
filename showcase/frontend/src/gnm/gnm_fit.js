// GNM Phase 3：从 reference/fit.ts 移植 identity fit。
import {
  applySimilarity,
  choleskySolve,
  fitSimilarity,
  landmarksToModelAxes,
} from "./gnm_math.js";

const DEFAULTS = Object.freeze({
  iterations: 4,
  components: 24,
  ridge: 0.06,
  depthWeight: 0.1,
  limit: 3,
  rigidOnly: true,
});

function assertFiniteArray(values, label) {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error(`${label} contains NaN/Inf at ${i}`);
  }
}

export function fitIdentity(model, landmarks, aspect, options = {}) {
  const correspondence = model.correspondence;
  if (!correspondence) throw new Error("GNM model has no correspondence");
  const { iterations, ridge, depthWeight, limit, rigidOnly, components } = {
    ...DEFAULTS,
    ...options,
  };

  const active = [];
  for (let i = 0; i < correspondence.rigid.length; i++) {
    if (!rigidOnly || correspondence.rigid[i]) active.push(i);
  }
  const count = active.length;
  const needed = Math.max(...correspondence.landmarks) + 1;
  if (landmarks.length < needed) {
    throw new Error(`correspondence indexes landmark ${needed - 1}, frame has ${landmarks.length}`);
  }

  const dim = Math.max(1, Math.min(components, model.identityDim));
  const rows = count * 3;
  const stride = model.vertexCount * 3;

  const basePoints = new Float64Array(rows);
  const design = new Float64Array(rows * dim);
  for (let i = 0; i < count; i++) {
    const corr = active[i];
    const vertex = correspondence.vertices[corr];
    for (let axis = 0; axis < 3; axis++) {
      const row = i * 3 + axis;
      basePoints[row] = correspondence.reference[corr * 3 + axis];
      for (let k = 0; k < dim; k++) {
        design[row * dim + k] = model.identityBasis[k * stride + vertex * 3 + axis];
      }
    }
  }

  const weights = new Float64Array(rows);
  for (let i = 0; i < count; i++) {
    weights[i * 3] = 1;
    weights[i * 3 + 1] = 1;
    weights[i * 3 + 2] = depthWeight;
  }

  const normal = new Float64Array(dim * dim);
  for (let row = 0; row < rows; row++) {
    const w = weights[row];
    if (w === 0) continue;
    const base = row * dim;
    for (let a = 0; a < dim; a++) {
      const wa = w * design[base + a];
      if (wa === 0) continue;
      for (let b = a; b < dim; b++) normal[a * dim + b] += wa * design[base + b];
    }
  }
  for (let a = 0; a < dim; a++) {
    for (let b = 0; b < a; b++) normal[a * dim + b] = normal[b * dim + a];
  }
  let trace = 0;
  for (let a = 0; a < dim; a++) trace += normal[a * dim + a];
  const lambda = (ridge * trace) / dim;
  for (let a = 0; a < dim; a++) normal[a * dim + a] += lambda;

  const observed = new Float64Array(rows);
  const indices = new Uint16Array(count);
  for (let i = 0; i < count; i++) indices[i] = correspondence.landmarks[active[i]];
  landmarksToModelAxes(landmarks, indices, aspect, observed);

  const identity = new Float64Array(dim);
  const current = new Float64Array(rows);
  const aligned = new Float64Array(rows);
  const rhs = new Float64Array(dim);

  const residualRms = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = (a[i] - b[i]) * 1000;
      sum += d * d;
    }
    return Math.sqrt((sum * 3) / a.length);
  };

  let transform = null;
  let rmsBefore = 0;
  let rmsAfter = 0;

  for (let iteration = 0; iteration < iterations; iteration++) {
    current.set(basePoints);
    for (let k = 0; k < dim; k++) {
      const c = identity[k];
      if (c === 0) continue;
      for (let row = 0; row < rows; row++) current[row] += c * design[row * dim + k];
    }
    transform = fitSimilarity(observed, current);
    applySimilarity(observed, transform, aligned);
    if (iteration === 0) rmsBefore = residualRms(aligned, basePoints);

    rhs.fill(0);
    for (let row = 0; row < rows; row++) {
      const w = weights[row];
      if (w === 0) continue;
      const target = w * (aligned[row] - basePoints[row]);
      const base = row * dim;
      for (let a = 0; a < dim; a++) rhs[a] += design[base + a] * target;
    }
    const solved = choleskySolve(normal, rhs, dim);
    for (let k = 0; k < dim; k++) identity[k] = Math.max(-limit, Math.min(limit, solved[k]));
  }

  current.set(basePoints);
  for (let k = 0; k < dim; k++) {
    const c = identity[k];
    if (c === 0) continue;
    for (let row = 0; row < rows; row++) current[row] += c * design[row * dim + k];
  }
  transform = fitSimilarity(observed, current);
  applySimilarity(observed, transform, aligned);
  rmsAfter = residualRms(aligned, current);

  let peak = 0;
  const result = new Float32Array(model.identityDim);
  for (let k = 0; k < dim; k++) {
    result[k] = identity[k];
    peak = Math.max(peak, Math.abs(identity[k]));
  }
  assertFiniteArray(result, "identity");
  return { identity: result, transform, points: count, components: dim, rmsBefore, rmsAfter, peak };
}
