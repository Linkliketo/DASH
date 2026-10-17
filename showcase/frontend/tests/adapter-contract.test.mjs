import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_VERSION,
  blendshapeScores,
  hasOutput,
  neutralHeadEuler,
  normalizeBlendshapes,
} from "../src/adapters/adapter.js";
import { inferFrame } from "../src/adapters/infer.js";
import { normalizeKind, validateAdapter } from "../src/adapters/registry.js";

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

test("neutralHeadEuler returns a stable neutral value", () => {
  assert.deepEqual(neutralHeadEuler(null), { x: 0, y: 0, z: 0 });
  assert.deepEqual(neutralHeadEuler({ x: 1, y: 2, z: 3 }), { x: 1, y: 2, z: 3 });
});

test("blendshapeScores accepts object and array forms", () => {
  assert.deepEqual(blendshapeScores({ jawOpen: 0.4, smile: 0.2 }), {
    jawOpen: 0.4,
    smile: 0.2,
  });
  assert.deepEqual(blendshapeScores([{ categoryName: "jawOpen", score: 0.4 }]), {
    jawOpen: 0.4,
  });
});

test("inferFrame supports adapters that only implement infer", () => {
  const calls = [];
  const onlyInfer = {
    infer(source, ts) {
      calls.push(["infer", source, ts]);
      return { blendshapes: { jawOpen: 0.5 } };
    },
    detectForVideo() {
      calls.push(["detectForVideo"]);
      throw new Error("must not be called");
    },
  };
  assert.deepEqual(inferFrame(onlyInfer, "frame", 123), { blendshapes: { jawOpen: 0.5 } });
  assert.deepEqual(calls, [["infer", "frame", 123]]);
});

test("inferFrame prefers inferVideo and supports legacy conversion", () => {
  const video = { inferVideo: (source, ts) => ({ ts, source }) };
  assert.deepEqual(inferFrame(video, "frame", 7), { ts: 7, source: "frame" });
  const legacy = { detectForVideo: (source, ts) => ({ source, ts }) };
  assert.deepEqual(inferFrame(legacy, "frame", 8, (value) => ({ ...value, converted: true })), {
    source: "frame",
    ts: 8,
    converted: true,
  });
});

test("registry accepts the legacy perception kind and validates adapter methods", () => {
  assert.equal(normalizeKind({ kind: "perception" }), "mediapipe-task");
  const valid = {
    contractVersion: CONTRACT_VERSION,
    capabilities: {},
    init() {},
    infer() {},
    close() {},
  };
  assert.equal(validateAdapter(valid, { name: "test" }), valid);
  assert.throws(
    () => validateAdapter({ ...valid, init: undefined }, { name: "test" }),
    /missing init/,
  );
});
