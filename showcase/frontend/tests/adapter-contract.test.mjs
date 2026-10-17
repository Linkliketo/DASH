import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_VERSION, hasOutput, normalizeBlendshapes } from "../src/adapters/adapter.js";

test("adapter contract version is stable", () => {
  assert.equal(CONTRACT_VERSION, 1);
});

test("normalizeBlendshapes accepts arrays", () => {
  const input = [{ categoryName: "jawOpen", score: 0.5 }];
  assert.equal(normalizeBlendshapes(input), input);
});

test("normalizeBlendshapes converts records", () => {
  assert.deepEqual(normalizeBlendshapes({ jawOpen: 0.5 }), [
    { categoryName: "jawOpen", score: 0.5 },
  ]);
});

test("normalizeBlendshapes handles empty input", () => {
  assert.equal(normalizeBlendshapes(null), null);
  assert.equal(normalizeBlendshapes(undefined), null);
});

test("hasOutput rejects empty frames", () => {
  assert.equal(hasOutput({}), false);
  assert.equal(hasOutput({ landmarks: [] }), false);
  assert.equal(hasOutput({ blendshapes: {} }), false);
});

test("hasOutput accepts each supported output", () => {
  assert.equal(hasOutput({ landmarks: [{ x: 0, y: 0, z: 0 }] }), true);
  assert.equal(hasOutput({ blendshapes: { jawOpen: 0.4 } }), true);
  assert.equal(hasOutput({ headEuler: { x: 0, y: 0, z: 0 } }), true);
});
