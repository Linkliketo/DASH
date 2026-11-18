// GNM Phase 3：纯 JS forward，用于 golden 验收；不是 WebGL renderer。
import { axisAngleToRotationMatrix } from "./gnm_math.js";

function multiply4(a, b) {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

export function gnmBindPose(model, identity = null, expression = null) {
  const vertices = new Float32Array(model.vertexCount * 3);
  vertices.set(model.templateVertexPositions);
  if (identity) {
    for (let k = 0; k < model.identityDim; k++) {
      const c = identity[k] || 0;
      if (!c) continue;
      const base = k * model.vertexCount * 3;
      for (let i = 0; i < vertices.length; i++) vertices[i] += c * model.identityBasis[base + i];
    }
  }
  if (expression) {
    for (let k = 0; k < model.expressionDim; k++) {
      const c = expression[k] || 0;
      if (!c) continue;
      const base = k * model.vertexCount * 3;
      for (let i = 0; i < vertices.length; i++) vertices[i] += c * model.expressionBasis[base + i];
    }
  }
  return vertices;
}

export function gnmBindJoints(model, identity = null) {
  const joints = new Float32Array(model.jointCount * 3);
  joints.set(model.templateJointPositions);
  if (identity) {
    for (let k = 0; k < model.identityDim; k++) {
      const c = identity[k] || 0;
      if (!c) continue;
      const base = k * model.jointCount * 3;
      for (let i = 0; i < joints.length; i++) joints[i] += c * model.jointIdentityBasis[base + i];
    }
  }
  return joints;
}

export function gnmForward(model, {
  identity = null, expression = null, rotations = null, translation = null,
} = {}) {
  const vertices = gnmBindPose(model, identity, expression);
  const joints = gnmBindJoints(model, identity);
  const J = model.jointCount;
  const rot = rotations || new Float32Array(J * 3);
  const trans = translation || new Float32Array(3);
  const rotations9 = axisAngleToRotationMatrix(rot);
  const world = new Array(J);

  for (let j = 0; j < J; j++) {
    const local = new Float64Array(16);
    for (let i = 0; i < 9; i++) local[Math.floor(i / 3) * 4 + (i % 3)] = rotations9[j * 9 + i];
    if (j === 0) {
      local[3] = joints[0] + trans[0];
      local[7] = joints[1] + trans[1];
      local[11] = joints[2] + trans[2];
    } else {
      const parent = model.jointParentIndices[j];
      local[3] = joints[j * 3] - joints[parent * 3];
      local[7] = joints[j * 3 + 1] - joints[parent * 3 + 1];
      local[11] = joints[j * 3 + 2] - joints[parent * 3 + 2];
    }
    local[15] = 1;
    world[j] = j === 0 ? local : multiply4(world[model.jointParentIndices[j]], local);
  }

  const transforms = new Array(J);
  for (let j = 0; j < J; j++) {
    const t = new Float64Array(world[j]);
    t[3] -= world[j][0] * joints[j * 3] + world[j][1] * joints[j * 3 + 1] + world[j][2] * joints[j * 3 + 2];
    t[7] -= world[j][4] * joints[j * 3] + world[j][5] * joints[j * 3 + 1] + world[j][6] * joints[j * 3 + 2];
    t[11] -= world[j][8] * joints[j * 3] + world[j][9] * joints[j * 3 + 1] + world[j][10] * joints[j * 3 + 2];
    transforms[j] = t;
  }

  const out = new Float32Array(model.vertexCount * 3);
  for (let v = 0; v < model.vertexCount; v++) {
    const x = vertices[v * 3], y = vertices[v * 3 + 1], z = vertices[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let j = 0; j < J; j++) {
      const w = model.skinningWeights[j * model.vertexCount + v];
      if (!w) continue;
      const t = transforms[j];
      ox += w * (t[0] * x + t[1] * y + t[2] * z + t[3]);
      oy += w * (t[4] * x + t[5] * y + t[6] * z + t[7]);
      oz += w * (t[8] * x + t[9] * y + t[10] * z + t[11]);
    }
    out[v * 3] = ox;
    out[v * 3 + 1] = oy;
    out[v * 3 + 2] = oz;
  }
  return out;
}
