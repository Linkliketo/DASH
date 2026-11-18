// GNM Phase 3：解析 gnm_head.json + gnm_head.bin + correspondence.json。
// float16 仅用于存储；所有计算在 float32/float64 中完成。

const DTYPE_SIZE = { float32: 4, float16: 2, uint16: 2, uint8: 1 };

function f16ToF32(h) {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * Math.pow(2, -24);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * Math.pow(2, exp - 15);
}

function readView(buffer, view) {
  const size = DTYPE_SIZE[view.dtype];
  if (!size) throw new Error(`unsupported GNM dtype ${view.dtype}`);
  const count = view.byteLength / size;
  if (!Number.isInteger(count)) throw new Error(`GNM view ${view.byteLength} not aligned`);
  const offset = view.byteOffset;
  if (offset % size !== 0) throw new Error(`GNM view byteOffset ${offset} not aligned`);
  if (offset + view.byteLength > buffer.byteLength) throw new Error("GNM view out of range");
  if (view.dtype === "float32") return new Float32Array(buffer, offset, count);
  if (view.dtype === "float16") {
    const source = new Uint16Array(buffer, offset, count);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = f16ToF32(source[i]);
    return out;
  }
  if (view.dtype === "uint16") return new Uint16Array(buffer, offset, count);
  return new Uint8Array(buffer, offset, count);
}

function flatten2D(rows) {
  const out = new Float32Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    out[i * 3] = rows[i][0];
    out[i * 3 + 1] = rows[i][1];
    out[i * 3 + 2] = rows[i][2];
  }
  return out;
}

export function parseGnmModel(headJson, binBuffer, correspondenceJson) {
  if (!headJson?.arrays) throw new Error("GNM head JSON missing arrays");
  const arrays = {};
  for (const [name, view] of Object.entries(headJson.arrays)) {
    arrays[name] = readView(binBuffer, view);
  }

  const vertexCount = headJson.model?.vertexCount;
  const jointCount = headJson.model?.jointCount;
  if (vertexCount !== 17821 || jointCount !== 4) {
    throw new Error(`GNM model shape ${vertexCount}/${jointCount} not supported`);
  }
  const identityDim = headJson.identity?.count;
  const expressionDim = headJson.expression?.count;
  if (identityDim !== 64 || expressionDim !== 89) {
    throw new Error(`GNM identity/expression dim ${identityDim}/${expressionDim} not supported`);
  }

  const landmarkIndices = Uint16Array.from(correspondenceJson.landmark_indices);
  const vertexIndices = Uint16Array.from(correspondenceJson.vertex_indices);
  const rigid = Uint8Array.from(correspondenceJson.rigid, (v) => (v ? 1 : 0));
  const reference = flatten2D(correspondenceJson.reference_landmarks);
  if (landmarkIndices.length !== 473 || vertexIndices.length !== 473 ||
      rigid.length !== 473 || reference.length !== 473 * 3) {
    throw new Error("GNM correspondence arrays must be 473");
  }

  return {
    manifest: headJson,
    arrays,
    vertexCount,
    jointCount,
    identityDim,
    expressionDim,
    templateVertexPositions: arrays.template_vertex_positions,
    identityBasis: arrays.identity_basis,
    expressionBasis: arrays.expression_basis,
    templateJointPositions: arrays.template_joint_positions,
    jointIdentityBasis: arrays.joint_identity_basis,
    skinningWeights: arrays.skinning_weights,
    triangles: arrays.triangles,
    jointParentIndices: headJson.model.jointParentIndices,
    jointNames: headJson.model.jointNames,
    expressionRegions: headJson.expression.regions,
    correspondence: {
      landmarks: landmarkIndices,
      vertices: vertexIndices,
      rigid,
      reference,
    },
  };
}
