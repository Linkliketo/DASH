import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGnmModel } from "../src/gnm/gnm_model.js";
import { fitIdentity } from "../src/gnm/gnm_fit.js";
import { FaceRetargeter } from "../src/gnm/gnm_retarget.js";
import { gnmForward } from "../src/gnm/gnm_forward.js";

const root = new URL("../", import.meta.url);

async function loadModel() {
  const head = JSON.parse(await readFile(new URL("models/gnm/v3/gnm_head.json", root), "utf8"));
  const corr = JSON.parse(await readFile(new URL("models/gnm/v3/correspondence.json", root), "utf8"));
  const bin = await readFile(new URL("models/gnm/v3/gnm_head.bin", root));
  return parseGnmModel(head, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), corr);
}

function landmarksFromModelPoints(model, points, aspect = 1) {
  const out = new Array(478).fill({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < model.correspondence.landmarks.length; i++) {
    const idx = model.correspondence.landmarks[i];
    out[idx] = {
      x: points[i * 3] / aspect,
      y: -points[i * 3 + 1],
      z: -points[i * 3 + 2] / aspect,
    };
  }
  return out;
}

function referencePoints(model) {
  return Float32Array.from(model.correspondence.reference);
}

test("identity and retarget are finite on the neutral reference", async () => {
  const model = await loadModel();
  const points = referencePoints(model);
  const landmarks = landmarksFromModelPoints(model, points);
  const fit = fitIdentity(model, landmarks, 1);
  assert.equal(fit.identity.length, 64);
  assert.ok(fit.identity.every(Number.isFinite));
  assert.ok(Number.isFinite(fit.rmsAfter));
  assert.ok(fit.rmsAfter <= fit.rmsBefore + 1e-6);

  const retarget = new FaceRetargeter(model);
  retarget.setIdentity(new Float32Array(64));
  const solved = retarget.solve(landmarks, 1);
  assert.equal(solved.expression.length, 89);
  assert.deepEqual(Array.from(solved.headRotation).map((v) => Math.abs(v) < 1e-5), [true, true, true]);
  assert.ok(solved.expression.every(Number.isFinite));
  assert.ok(Number.isFinite(solved.rms));
});

test("identity fit and expression solve remain finite on synthetic motion", async () => {
  const model = await loadModel();
  const ref = referencePoints(model);
  const identity = new Float32Array(64);
  for (let k = 0; k < 8; k++) identity[k] = 0.05 * Math.sin(k + 1);
  const shape = Float32Array.from(ref);
  const stride = model.vertexCount * 3;
  for (let i = 0; i < model.correspondence.vertices.length; i++) {
    const vertex = model.correspondence.vertices[i];
    for (let k = 0; k < 24; k++) {
      for (let axis = 0; axis < 3; axis++) {
        shape[i * 3 + axis] += identity[k] * model.identityBasis[k * stride + vertex * 3 + axis];
      }
    }
  }
  const landmarks = landmarksFromModelPoints(model, shape);
  const fit = fitIdentity(model, landmarks, 1);
  assert.ok(fit.identity.every(Number.isFinite));
  assert.ok(fit.rmsAfter <= fit.rmsBefore + 1e-3);

  const expr = new Float32Array(89);
  expr[48] = 0.2;
  const moving = Float32Array.from(shape);
  for (let i = 0; i < model.correspondence.vertices.length; i++) {
    const vertex = model.correspondence.vertices[i];
    for (let axis = 0; axis < 3; axis++) {
      moving[i * 3 + axis] += expr[48] * model.expressionBasis[48 * stride + vertex * 3 + axis];
    }
  }
  const movingLandmarks = landmarksFromModelPoints(model, moving);
  const retarget = new FaceRetargeter(model);
  retarget.setIdentity(fit.identity);
  const solved = retarget.solve(movingLandmarks, 1);
  assert.ok(solved.expression.every(Number.isFinite));
  assert.ok(solved.headRotation.every(Number.isFinite));
  assert.ok(Number.isFinite(solved.rms));
});


test("camera mirror flips yaw/roll without reflecting 3D landmarks", async () => {
  const model = await loadModel();
  const rotations = new Float32Array(12);
  rotations[4] = 0.3; // head joint yaw
  const posed = gnmForward(model, { rotations });
  const points = new Float32Array(473 * 3);
  for (let i = 0; i < 473; i++) {
    const vertex = model.correspondence.vertices[i];
    points[i * 3] = posed[vertex * 3];
    points[i * 3 + 1] = posed[vertex * 3 + 1];
    points[i * 3 + 2] = posed[vertex * 3 + 2];
  }
  const landmarks = landmarksFromModelPoints(model, points);

  const normal = new FaceRetargeter(model);
  normal.setIdentity(new Float32Array(model.identityDim));
  const a = normal.solve(landmarks, 1);

  const camera = new FaceRetargeter(model);
  camera.setIdentity(new Float32Array(model.identityDim));
  const b = camera.solve(landmarks, 1, { mirror: true });

  assert.ok(Math.abs(a.headRotation[1] - 0.3) < 0.02);
  assert.ok(Math.abs(b.headRotation[1] + a.headRotation[1]) < 1e-5);
  assert.ok(Math.abs(b.headRotation[2] + a.headRotation[2]) < 1e-5);
  assert.ok(Math.abs(b.headRotation[0] - a.headRotation[0]) < 1e-5);
  assert.ok(b.expression.every(Number.isFinite));
});
