import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGnmModel } from "../src/gnm/gnm_model.js";
import { gnmForward } from "../src/gnm/gnm_forward.js";

const root = new URL("../", import.meta.url);

async function loadAssets() {
  const head = JSON.parse(await readFile(new URL("models/gnm/v3/gnm_head.json", root), "utf8"));
  const corr = JSON.parse(await readFile(new URL("models/gnm/v3/correspondence.json", root), "utf8"));
  const bin = await readFile(new URL("models/gnm/v3/gnm_head.bin", root));
  const binBuffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  return parseGnmModel(head, binBuffer, corr);
}

test("GNM forward reproduces all golden cases", async () => {
  const model = await loadAssets();
  assert.equal(model.vertexCount, 17821);
  assert.equal(model.correspondence.landmarks.length, 473);
  assert.equal(model.correspondence.rigid.filter(Boolean).length, 166);

  const goldenMeta = JSON.parse(await readFile(new URL("../../model_v2/gnm_delivery/validation/golden.json", root), "utf8"));
  const goldenBin = await readFile(new URL("../../model_v2/gnm_delivery/validation/golden.bin", root));
  for (const c of goldenMeta.cases) {
    const got = gnmForward(model, {
      identity: Float32Array.from(c.identity),
      expression: Float32Array.from(c.expression),
      rotations: Float32Array.from(c.rotations.flat()),
      translation: Float32Array.from(c.translation),
    });
    const expected = new Float32Array(
      goldenBin.buffer,
      goldenBin.byteOffset + c.byteOffset,
      c.byteLength / 4,
    );
    let max = 0, sum = 0;
    for (let i = 0; i < got.length; i++) {
      const d = Math.abs(got[i] - expected[i]);
      max = Math.max(max, d);
      sum += d * d;
    }
    assert.ok(max < 1e-5, `${c.name}: max abs ${max}`);
    const rms = Math.sqrt(sum / got.length);
    assert.ok(rms < 1e-6, `${c.name}: rms ${rms}`);
  }
});
