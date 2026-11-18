import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  sha256Hex,
  validateGnmManifest,
  GnmAssetError,
} from "../src/gnm/gnm_assets.js";

const manifestPath = new URL("../models/gnm/v3/manifest.json", import.meta.url);

test("GNM manifest validates against the delivered schema", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(validateGnmManifest(manifest).name, "gnm_head_v3");
  assert.equal(manifest.assets.bin.sizeBytes, 18508211);
  assert.equal(manifest.assets.bin.sha256.length, 64);
});

test("GNM manifest rejects bad SHA and lazy=false", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const bad = structuredClone(manifest);
  bad.assets.bin.sha256 = "not-a-sha";
  assert.throws(() => validateGnmManifest(bad), (error) =>
    error instanceof GnmAssetError && error.code === "GNM_MANIFEST_INVALID");
  const notLazy = structuredClone(manifest);
  notLazy.lazy = false;
  assert.throws(() => validateGnmManifest(notLazy), /lazy=true/);
});

test("GNM SHA helper returns the known SHA-256", async () => {
  const bytes = new TextEncoder().encode("abc");
  assert.equal(
    await sha256Hex(bytes.buffer),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
