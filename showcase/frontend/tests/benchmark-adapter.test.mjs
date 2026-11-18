import test from "node:test";
import assert from "node:assert/strict";
import { fetchBenchmarkFrame } from "../src/benchmark.js";

test("benchmark frame path awaits async infer", async () => {
  const calls = [];
  const adapter = {
    async infer(source, timestampMs) {
      calls.push([source, timestampMs]);
      await Promise.resolve();
      return { timestampMs, blendshapes: { jawOpen: 0.4 } };
    },
  };
  const frame = await fetchBenchmarkFrame(adapter, "frame", 42);
  assert.deepEqual(calls, [["frame", 42]]);
  assert.equal(frame.timestampMs, 42);
  assert.deepEqual(frame.blendshapes, { jawOpen: 0.4 });
});
