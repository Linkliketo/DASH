// GNM Phase 3：从 reference/fit.ts 移植的最小数学原语。
export function landmarksToModelAxes(landmarks, indices, aspect, out) {
  for (let i = 0; i < indices.length; i++) {
    const landmark = landmarks[indices[i]];
    out[i * 3] = landmark.x * aspect;
    out[i * 3 + 1] = -landmark.y;
    out[i * 3 + 2] = -landmark.z * aspect;
  }
  return out;
}

export function jacobiEigen(matrix, n) {
  const vectors = new Float64Array(n * n);
  for (let i = 0; i < n; i++) vectors[i * n + i] = 1;

  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += matrix[p * n + q] * matrix[p * n + q];
    }
    if (off < 1e-24) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = matrix[p * n + q];
        if (Math.abs(apq) < 1e-18) continue;
        const theta = (matrix[q * n + q] - matrix[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = matrix[k * n + p];
          const akq = matrix[k * n + q];
          matrix[k * n + p] = c * akp - s * akq;
          matrix[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = matrix[p * n + k];
          const aqk = matrix[q * n + k];
          matrix[p * n + k] = c * apk - s * aqk;
          matrix[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = vectors[k * n + p];
          const vkq = vectors[k * n + q];
          vectors[k * n + p] = c * vkp - s * vkq;
          vectors[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = matrix[i * n + i];
  return { values, vectors };
}

export function fitSimilarity(source, target) {
  if (source.length !== target.length) throw new Error("similarity source/target length mismatch");
  const count = source.length / 3;
  if (count < 3) throw new Error("Need at least 3 points to fit similarity");

  let sx = 0, sy = 0, sz = 0, tx = 0, ty = 0, tz = 0;
  for (let i = 0; i < count; i++) {
    sx += source[i * 3]; sy += source[i * 3 + 1]; sz += source[i * 3 + 2];
    tx += target[i * 3]; ty += target[i * 3 + 1]; tz += target[i * 3 + 2];
  }
  sx /= count; sy /= count; sz /= count;
  tx /= count; ty /= count; tz /= count;

  const m = new Float64Array(9);
  let sourceVariance = 0;
  for (let i = 0; i < count; i++) {
    const ax = source[i * 3] - sx;
    const ay = source[i * 3 + 1] - sy;
    const az = source[i * 3 + 2] - sz;
    const bx = target[i * 3] - tx;
    const by = target[i * 3 + 1] - ty;
    const bz = target[i * 3 + 2] - tz;
    m[0] += ax * bx; m[1] += ax * by; m[2] += ax * bz;
    m[3] += ay * bx; m[4] += ay * by; m[5] += ay * bz;
    m[6] += az * bx; m[7] += az * by; m[8] += az * bz;
    sourceVariance += ax * ax + ay * ay + az * az;
  }

  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = m;
  const n = Float64Array.from([
    xx + yy + zz, yz - zy, zx - xz, xy - yx,
    yz - zy, xx - yy - zz, xy + yx, zx + xz,
    zx - xz, xy + yx, -xx + yy - zz, yz + zy,
    xy - yx, zx + xz, yz + zy, -xx - yy + zz,
  ]);
  const { values, vectors } = jacobiEigen(n, 4);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  const qw = vectors[best];
  const qx = vectors[4 + best];
  const qy = vectors[8 + best];
  const qz = vectors[12 + best];

  const rotation = Float64Array.from([
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx),
    2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy),
  ]);

  let aligned = 0;
  for (let i = 0; i < count; i++) {
    const ax = source[i * 3] - sx;
    const ay = source[i * 3 + 1] - sy;
    const az = source[i * 3 + 2] - sz;
    aligned +=
      (target[i * 3] - tx) * (rotation[0] * ax + rotation[1] * ay + rotation[2] * az) +
      (target[i * 3 + 1] - ty) * (rotation[3] * ax + rotation[4] * ay + rotation[5] * az) +
      (target[i * 3 + 2] - tz) * (rotation[6] * ax + rotation[7] * ay + rotation[8] * az);
  }
  const scale = aligned / Math.max(sourceVariance, 1e-12);

  const translation = Float64Array.from([
    tx - scale * (rotation[0] * sx + rotation[1] * sy + rotation[2] * sz),
    ty - scale * (rotation[3] * sx + rotation[4] * sy + rotation[5] * sz),
    tz - scale * (rotation[6] * sx + rotation[7] * sy + rotation[8] * sz),
  ]);

  return { scale, rotation, translation };
}

export function applySimilarity(points, transform, out) {
  const { scale, rotation: r, translation: t } = transform;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    out[i] = scale * (r[0] * x + r[1] * y + r[2] * z) + t[0];
    out[i + 1] = scale * (r[3] * x + r[4] * y + r[5] * z) + t[1];
    out[i + 2] = scale * (r[6] * x + r[7] * y + r[8] * z) + t[2];
  }
  return out;
}

export function choleskySolve(matrix, rhs, n) {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i * n + j];
      for (let k = 0; k < j; k++) sum -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (sum <= 0) throw new Error("Normal matrix is not positive definite");
        l[i * n + j] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / l[j * n + j];
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = rhs[i];
    for (let k = 0; k < i; k++) sum -= l[i * n + k] * y[k];
    y[i] = sum / l[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i] * x[k];
    x[i] = sum / l[i * n + i];
  }
  return x;
}

export function axisAngleToRotationMatrix(rotations) {
  // rotations: (J,3) -> (J,9) row-major
  const count = rotations.length / 3;
  const out = new Float64Array(count * 9);
  for (let j = 0; j < count; j++) {
    const x = rotations[j * 3], y = rotations[j * 3 + 1], z = rotations[j * 3 + 2];
    const angle = Math.hypot(x, y, z);
    const ax = angle > 1e-12 ? x / angle : 0;
    const ay = angle > 1e-12 ? y / angle : 0;
    const az = angle > 1e-12 ? z / angle : 0;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const t = 1 - cos;
    const o = j * 9;
    out[o] = cos + ax * ax * t;
    out[o + 1] = ax * ay * t - az * sin;
    out[o + 2] = ax * az * t + ay * sin;
    out[o + 3] = ay * ax * t + az * sin;
    out[o + 4] = cos + ay * ay * t;
    out[o + 5] = ay * az * t - ax * sin;
    out[o + 6] = az * ax * t - ay * sin;
    out[o + 7] = az * ay * t + ax * sin;
    out[o + 8] = cos + az * az * t;
  }
  return out;
}

export function matrixToAxisAngle(r, out = new Float32Array(3)) {
  const trace = r[0] + r[4] + r[8];
  const cos = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const angle = Math.acos(cos);
  const sin = Math.sin(angle);
  if (Math.abs(sin) < 1e-6) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    return out;
  }
  const scale = angle / (2 * sin);
  out[0] = (r[7] - r[5]) * scale;
  out[1] = (r[2] - r[6]) * scale;
  out[2] = (r[3] - r[1]) * scale;
  return out;
}
