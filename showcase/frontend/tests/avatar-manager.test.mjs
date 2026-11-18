import test from "node:test";
import assert from "node:assert/strict";
import { AvatarManager } from "../src/avatar_manager.js";

function fake(id, ready = true) {
  return {
    id,
    ready,
    updates: [],
    renders: 0,
    resets: 0,
    disposed: 0,
    update(frame, options) { this.updates.push({ frame, options }); },
    render() { this.renders++; },
    resize() {},
    reset() { this.resets++; },
    dispose() { this.disposed++; },
    lastTiming: { rigMs: 1, renderMs: 2, mappingMs: 3, totalMs: 6 },
    lastMappingMs: 3,
    renderedFrames: 42,
  };
}

test("AvatarManager selects and updates the active backend", () => {
  const vrm = fake("vrm");
  const gnm = fake("gnm");
  const manager = new AvatarManager({ backends: { vrm, gnm } });
  manager.setActive("vrm");
  assert.equal(manager.activeBackendId, "vrm");
  assert.equal(manager.ready, true);
  manager.update({ blendshapes: [] }, { snap: true });
  assert.equal(vrm.updates.length, 1);
  assert.equal(gnm.updates.length, 0);
  manager.setActive("gnm");
  manager.update({ landmarks: [] });
  assert.equal(vrm.updates.length, 1);
  assert.equal(gnm.updates.length, 1);
});

test("AvatarManager exposes active backend telemetry", () => {
  const manager = new AvatarManager({ backends: { vrm: fake("vrm") } });
  manager.setActive("vrm");
  assert.deepEqual(manager.lastTiming, { rigMs: 1, renderMs: 2, mappingMs: 3, totalMs: 6 });
  assert.equal(manager.lastMappingMs, 3);
  assert.equal(manager.renderedFrames, 42);
});

test("AvatarManager falls back to VRM and disposes all backends", () => {
  const vrm = fake("vrm");
  const gnm = fake("gnm");
  const manager = new AvatarManager({ backends: { vrm, gnm } });
  manager.setActive("gnm");
  manager.fallback();
  assert.equal(manager.activeBackendId, "vrm");
  manager.dispose();
  assert.equal(vrm.disposed, 1);
  assert.equal(gnm.disposed, 1);
});

test("AvatarManager rejects unknown backend", async () => {
  const manager = new AvatarManager({ backends: { vrm: fake("vrm") } });
  await assert.rejects(() => manager.setActive("gnm"), /unknown avatar backend/);
});
